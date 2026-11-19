import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { guard, me } from '../lib/auth.js';
import { asyncHandler, dateRange, HttpError, pageParams, parse } from '../lib/http.js';
import { audit, notify, sendMessage } from '../lib/notify.js';
import { getDeliveryFee, setDeliveryFee } from '../lib/settings.js';
import { cancelOrder, short } from '../services/orders.js';
import { emailField, nameField, password, phoneField, publicUser } from './auth.js';
import { orderInclude, shapeOrder } from './orders.js';

export const adminRouter = Router();
adminRouter.use(guard('ADMIN'));

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function uniqueConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new HttpError(409, 'Email or phone is already in use', { email: 'Email or phone is already in use' });
  }
  throw e;
}

const userInclude = { farmerProfile: true } as const;
const shapeUser = (u: Prisma.UserGetPayload<{ include: typeof userInclude }>) => ({
  ...publicUser(u),
  blockReason: u.blockReason,
  createdAt: u.createdAt,
  farmerProfile: u.farmerProfile,
});

// =====================================================================
// Users (US-31, US-32, US-33, US-40)
// =====================================================================
adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip, take } = pageParams(req.query, 20);
    const role = str(req.query.role);
    const status = str(req.query.status);
    const q = str(req.query.search);
    const where: Prisma.UserWhereInput = {
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }, { farmerProfile: { farmName: { contains: q } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, include: userInclude, orderBy: { createdAt: 'desc' }, skip, take }),
    ]);
    res.json({ items: rows.map(shapeUser), total, page, pageSize });
  }),
);

adminRouter.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const u = await prisma.user.findUnique({ where: { id: String(req.params.id) }, include: userInclude });
    if (!u) throw new HttpError(404, 'User not found');
    res.json({ user: shapeUser(u) });
  }),
);

adminRouter.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(
      z.object({
        name: nameField.optional(),
        email: emailField.optional(),
        phone: phoneField.optional(),
        address: z.string().trim().min(8).max(300).optional(),
        farmName: z.string().trim().min(2).max(100).optional(),
        farmLocation: z.string().trim().min(3).max(200).optional(),
      }),
      req.body,
    );
    const id = String(req.params.id);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, 'User not found');
    const { farmName, farmLocation, ...userFields } = d;
    try {
      await prisma.$transaction(async (tx) => {
        if (Object.keys(userFields).length) await tx.user.update({ where: { id }, data: userFields });
        if (target.role === 'FARMER' && (farmName || farmLocation)) await tx.farmerProfile.update({ where: { userId: id }, data: { farmName, farmLocation } });
      });
    } catch (e) {
      uniqueConflict(e);
    }
    await audit(a.id, 'USER_EDITED', `user:${id}`, Object.keys(d).join(','));
    res.json({ user: shapeUser(await prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude })) });
  }),
);

adminRouter.post(
  '/users/:id/block',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(z.object({ reason: z.string().trim().min(3, 'A reason is required').max(300) }), req.body);
    const id = String(req.params.id);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, 'User not found');
    if (target.role === 'ADMIN') throw new HttpError(403, 'Administrator accounts cannot be blocked here');
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { status: 'BLOCKED', blockReason: d.reason } }),
      prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }), // blocked users cannot keep using a live session
    ]);
    await audit(a.id, 'USER_BLOCKED', `user:${id}`, d.reason);
    res.json({ user: shapeUser(await prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude })) });
  }),
);

// reversible (US-40)
adminRouter.post(
  '/users/:id/unblock',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const id = String(req.params.id);
    const target = await prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!target) throw new HttpError(404, 'User not found');
    if (target.status !== 'BLOCKED') throw new HttpError(409, 'This account is not blocked');
    const status = target.role === 'FARMER' && target.farmerProfile?.verification !== 'APPROVED' ? 'PENDING' : 'ACTIVE';
    await prisma.user.update({ where: { id }, data: { status, blockReason: null } });
    await audit(a.id, 'USER_UNBLOCKED', `user:${id}`);
    res.json({ user: shapeUser(await prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude })) });
  }),
);

// =====================================================================
// Farmer verification (US-34)
// =====================================================================
adminRouter.get(
  '/farmers/pending',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.user.findMany({ where: { role: 'FARMER', status: 'PENDING' }, include: userInclude, orderBy: { createdAt: 'asc' } });
    res.json({ items: rows.map(shapeUser) });
  }),
);

adminRouter.post(
  '/farmers/:id/approve',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const id = String(req.params.id);
    const f = await prisma.user.findFirst({ where: { id, role: 'FARMER' }, include: userInclude });
    if (!f) throw new HttpError(404, 'Farmer not found');
    if (f.status === 'BLOCKED') throw new HttpError(409, 'Unblock this account first');
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } }),
      prisma.farmerProfile.update({ where: { userId: id }, data: { verification: 'APPROVED', rejectionReason: null, verifiedAt: new Date() } }),
    ]);
    sendMessage({ to: f.email, channel: 'email', subject: 'Your farmer account is approved', body: 'You can now log in and list your produce.' });
    await notify(id, 'VERIFICATION', 'Your farmer account has been approved. You can start selling!');
    await audit(a.id, 'FARMER_APPROVED', `user:${id}`);
    res.json({ user: shapeUser(await prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude })) });
  }),
);

adminRouter.post(
  '/farmers/:id/reject',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(z.object({ reason: z.string().trim().min(3, 'Give the farmer a reason').max(300) }), req.body);
    const id = String(req.params.id);
    const f = await prisma.user.findFirst({ where: { id, role: 'FARMER' } });
    if (!f) throw new HttpError(404, 'Farmer not found');
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { status: 'REJECTED' } }),
      prisma.farmerProfile.update({ where: { userId: id }, data: { verification: 'REJECTED', rejectionReason: d.reason } }),
      prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    sendMessage({ to: f.email, channel: 'email', subject: 'Your farmer registration was not approved', body: `Reason: ${d.reason}` });
    await audit(a.id, 'FARMER_REJECTED', `user:${id}`, d.reason);
    res.json({ user: shapeUser(await prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude })) });
  }),
);

// =====================================================================
// Delivery personnel (US-33)
// =====================================================================
adminRouter.post(
  '/delivery',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(z.object({ name: nameField, email: emailField, phone: phoneField, password }), req.body);
    try {
      const u = await prisma.user.create({
        data: { name: d.name, email: d.email, phone: d.phone, role: 'DELIVERY', status: 'ACTIVE', passwordHash: await bcrypt.hash(d.password, 10) },
        include: userInclude,
      });
      await audit(a.id, 'DELIVERY_PERSON_ADDED', `user:${u.id}`);
      res.status(201).json({ user: shapeUser(u) });
    } catch (e) {
      uniqueConflict(e);
    }
  }),
);

adminRouter.delete(
  '/delivery/:id',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const id = String(req.params.id);
    const u = await prisma.user.findFirst({ where: { id, role: 'DELIVERY' } });
    if (!u) throw new HttpError(404, 'Delivery person not found');
    const used = await prisma.delivery.count({ where: { deliveryPersonId: id } });
    if (used > 0) {
      // keep history intact: deactivate instead of delete
      await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { status: 'BLOCKED', blockReason: 'Removed by administrator' } }),
        prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      await audit(a.id, 'DELIVERY_PERSON_REMOVED', `user:${id}`, 'deactivated (has delivery history)');
      return res.json({ message: 'This person has delivery history, so the account was deactivated instead of deleted.', deactivated: true });
    }
    await prisma.user.delete({ where: { id } });
    await audit(a.id, 'DELIVERY_PERSON_REMOVED', `user:${id}`, 'deleted');
    res.json({ message: 'Delivery person removed.', deactivated: false });
  }),
);

adminRouter.get(
  '/deliveries',
  asyncHandler(async (req, res) => {
    const status = str(req.query.status);
    const rows = await prisma.delivery.findMany({
      where: status ? { status } : {},
      include: { deliveryPerson: { select: { id: true, name: true, phone: true } }, order: { select: { id: true, status: true, farmer: { select: { name: true } } } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    res.json({
      items: rows.map((d) => ({
        id: d.id,
        orderId: d.orderId,
        orderRef: short(d.orderId),
        status: d.status,
        orderStatus: d.order.status,
        farmerName: d.order.farmer.name,
        deliveryPerson: d.deliveryPerson,
        pickupAddress: d.pickupAddress,
        dropAddress: d.dropAddress,
        failureReason: d.failureReason,
        updatedAt: d.updatedAt,
      })),
    });
  }),
);

adminRouter.post(
  '/deliveries/:id/assign',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(z.object({ deliveryPersonId: z.string() }), req.body);
    const person = await prisma.user.findFirst({ where: { id: d.deliveryPersonId, role: 'DELIVERY', status: 'ACTIVE' } });
    if (!person) throw new HttpError(400, 'Choose an active delivery person', { deliveryPersonId: 'Choose an active delivery person' });
    const upd = await prisma.delivery.updateMany({ where: { id: String(req.params.id), status: { in: ['UNASSIGNED', 'ASSIGNED'] }, order: { status: 'PACKED' } }, data: { status: 'ASSIGNED', deliveryPersonId: person.id } });
    if (upd.count !== 1) throw new HttpError(409, 'This delivery can no longer be assigned');
    await notify(person.id, 'DELIVERY', 'An administrator assigned you a delivery.');
    await audit(a.id, 'DELIVERY_ASSIGNED', `delivery:${String(req.params.id)}`, `to=${person.id}`);
    res.json({ ok: true });
  }),
);

// =====================================================================
// Categories + product moderation (US-35)
// =====================================================================
adminRouter.post(
  '/categories',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(z.object({ name: z.string().trim().min(2, 'Enter a category name').max(40) }), req.body);
    try {
      const c = await prisma.category.create({ data: { name: d.name } });
      await audit(a.id, 'CATEGORY_ADDED', `category:${c.id}`, d.name);
      res.status(201).json({ category: c });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new HttpError(409, 'That category already exists', { name: 'That category already exists' });
      throw e;
    }
  }),
);

adminRouter.patch(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(z.object({ name: z.string().trim().min(2).max(40) }), req.body);
    try {
      const c = await prisma.category.update({ where: { id: String(req.params.id) }, data: { name: d.name } });
      await audit(a.id, 'CATEGORY_EDITED', `category:${c.id}`, d.name);
      res.json({ category: c });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new HttpError(409, 'That category already exists', { name: 'That category already exists' });
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new HttpError(404, 'Category not found');
      throw e;
    }
  }),
);

adminRouter.delete(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const id = String(req.params.id);
    await prisma.$transaction([prisma.product.updateMany({ where: { categoryId: id }, data: { categoryId: null } }), prisma.category.delete({ where: { id } })]).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new HttpError(404, 'Category not found');
      throw e;
    });
    await audit(a.id, 'CATEGORY_REMOVED', `category:${id}`);
    res.json({ message: 'Category removed. Its products are now uncategorised.' });
  }),
);

adminRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip, take } = pageParams(req.query, 20);
    const q = str(req.query.search);
    const status = str(req.query.status); // taken_down | active
    const where: Prisma.ProductWhereInput = {
      active: true,
      ...(status === 'taken_down' ? { takenDownReason: { not: null } } : status === 'active' ? { takenDownReason: null } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { farmer: { name: { contains: q } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({ where, include: { category: true, farmer: { select: { id: true, name: true, farmerProfile: { select: { farmName: true } } } } }, orderBy: { createdAt: 'desc' }, skip, take }),
    ]);
    res.json({ items: rows, total, page, pageSize });
  }),
);

adminRouter.post(
  '/products/:id/takedown',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(z.object({ reason: z.string().trim().min(3, 'A reason is required').max(300) }), req.body);
    const id = String(req.params.id);
    const p = await prisma.product.findUnique({ where: { id } });
    if (!p) throw new HttpError(404, 'Product not found');
    await prisma.$transaction([prisma.product.update({ where: { id }, data: { takenDownReason: d.reason } }), prisma.cartItem.deleteMany({ where: { productId: id } })]);
    await notify(p.farmerId, 'PRODUCT', `Your listing "${p.name}" was taken down: ${d.reason}`);
    await audit(a.id, 'PRODUCT_TAKEN_DOWN', `product:${id}`, d.reason);
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/products/:id/restore',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const id = String(req.params.id);
    const p = await prisma.product.findUnique({ where: { id } });
    if (!p) throw new HttpError(404, 'Product not found');
    await prisma.product.update({ where: { id }, data: { takenDownReason: null } });
    await notify(p.farmerId, 'PRODUCT', `Your listing "${p.name}" is live again.`);
    await audit(a.id, 'PRODUCT_RESTORED', `product:${id}`);
    res.json({ ok: true });
  }),
);

// =====================================================================
// Order + payment monitoring (US-36, US-37)
// =====================================================================
const MIN = 60_000;
type OrderForFlags = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** Problems an admin should look at: stuck/delayed orders (US-36), failed deliveries, silent couriers (FR-15). */
export function orderFlags(o: OrderForFlags, now = Date.now()): string[] {
  const flags: string[] = [];
  const age = (now - o.updatedAt.getTime()) / MIN;
  if (o.status === 'PLACED' && o.paymentStatus === 'PAID' && age > 120) flags.push('Not accepted for over 2 hours');
  if (o.status === 'ACCEPTED' && age > 24 * 60) flags.push('Not packed for over 24 hours');
  if (o.status === 'PACKED' && age > 240 && (!o.delivery || o.delivery.status === 'UNASSIGNED')) flags.push('No delivery partner for over 4 hours');
  if (o.status === 'DISPATCHED' && age > 360) flags.push('Out for delivery for over 6 hours');
  const d = o.delivery;
  if (d && d.status === 'FAILED' && o.status !== 'CANCELLED') flags.push('Delivery failed — needs a decision');
  if (d && (d.status === 'PICKED_UP' || d.status === 'ON_THE_WAY')) {
    const last = d.locationUpdatedAt?.getTime() ?? d.updatedAt.getTime();
    if ((now - last) / MIN > 10) flags.push('No location update for over 10 minutes');
  }
  return flags;
}

adminRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip, take } = pageParams(req.query, 20);
    const status = str(req.query.status);
    const paymentStatus = str(req.query.paymentStatus);
    const q = str(req.query.search);
    const where: Prisma.OrderWhereInput = {
      ...(status ? { status } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(q ? { OR: [{ id: { endsWith: q.toLowerCase() } }, { consumer: { name: { contains: q } } }, { farmer: { name: { contains: q } } }] } : {}),
    };
    const shape = (o: OrderForFlags) => ({ ...shapeOrder(o, { id: 'admin', role: 'ADMIN' }), flags: orderFlags(o) });

    if (req.query.stuck === 'true') {
      const all = await prisma.order.findMany({ where: { ...where, status: { in: ['PLACED', 'ACCEPTED', 'PACKED', 'DISPATCHED'] } }, include: orderInclude, orderBy: { updatedAt: 'asc' } });
      const flagged = all.map(shape).filter((o) => o.flags.length);
      return res.json({ items: flagged.slice(skip, skip + take), total: flagged.length, page, pageSize });
    }
    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, skip, take }),
    ]);
    res.json({ items: rows.map(shape), total, page, pageSize });
  }),
);

// admin override: cancel + refund (e.g. failed delivery). Allowed up to DISPATCHED.
adminRouter.post(
  '/orders/:id/cancel-refund',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(z.object({ reason: z.string().trim().min(3, 'A reason is required').max(300) }), req.body);
    const result = await cancelOrder(String(req.params.id), d.reason, 'ADMIN', a.id);
    res.json(result);
  }),
);

adminRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip, take } = pageParams(req.query, 20);
    const status = str(req.query.status); // PENDING | SUCCESS | FAILED
    const refunded = req.query.refunded === 'true';
    const range = dateRange(req.query);
    const where: Prisma.PaymentWhereInput = { ...(status ? { status } : {}), ...(refunded ? { refunds: { some: {} } } : {}), ...(range ? { createdAt: range } : {}) };
    const [total, rows] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({ where, include: { refunds: true }, orderBy: { createdAt: 'desc' }, skip, take }),
    ]);
    const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.consumerId) } }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    const orders = await prisma.order.findMany({ where: { groupId: { in: rows.map((r) => r.groupId) } }, select: { id: true, groupId: true } });
    res.json({
      items: rows.map((p) => ({
        id: p.id,
        groupId: p.groupId,
        consumerName: names.get(p.consumerId) ?? 'Unknown',
        amount: p.amount,
        status: p.status,
        failureReason: p.failureReason,
        attempts: p.attempts,
        refundedAmount: p.refunds.reduce((s, r) => s + r.amount, 0),
        orderRefs: orders.filter((o) => o.groupId === p.groupId).map((o) => short(o.id)),
        createdAt: p.createdAt,
      })),
      total,
      page,
      pageSize,
    });
  }),
);

// =====================================================================
// Complaints & disputes (US-38)
// =====================================================================
adminRouter.get(
  '/complaints',
  asyncHandler(async (req, res) => {
    const status = str(req.query.status);
    const rows = await prisma.complaint.findMany({
      where: status ? { status } : {},
      include: { filedBy: { select: { id: true, name: true, role: true } }, against: { select: { id: true, name: true, role: true } }, order: { select: { id: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ items: rows.map((c) => ({ ...c, orderRef: c.order ? short(c.order.id) : null })) });
  }),
);

adminRouter.post(
  '/complaints/:id/resolve',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(z.object({ notes: z.string().trim().min(5, 'Record how this was resolved').max(1000) }), req.body);
    const id = String(req.params.id);
    const c = await prisma.complaint.findUnique({ where: { id } });
    if (!c) throw new HttpError(404, 'Complaint not found');
    if (c.status === 'RESOLVED') throw new HttpError(409, 'Already resolved');
    await prisma.complaint.update({ where: { id }, data: { status: 'RESOLVED', resolutionNotes: d.notes, resolvedAt: new Date() } });
    const msg = `Complaint "${c.subject}" was resolved: ${d.notes}`;
    await notify(c.filedById, 'COMPLAINT', msg);
    if (c.againstId) await notify(c.againstId, 'COMPLAINT', msg); // both parties are told the outcome
    await audit(a.id, 'COMPLAINT_RESOLVED', `complaint:${id}`, d.notes);
    res.json({ ok: true });
  }),
);

// ---------- ratings moderation ----------
adminRouter.get(
  '/ratings',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.rating.findMany({
      include: { consumer: { select: { name: true } }, farmer: { select: { name: true } }, product: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ items: rows.map((r) => ({ id: r.id, stars: r.stars, comment: r.comment, hidden: r.hidden, consumerName: r.consumer.name, farmerName: r.farmer.name, productName: r.product.name, createdAt: r.createdAt })) });
  }),
);

adminRouter.post(
  '/ratings/:id/hide',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(z.object({ hidden: z.boolean() }), req.body);
    await prisma.rating.update({ where: { id: String(req.params.id) }, data: { hidden: d.hidden } }).catch(() => {
      throw new HttpError(404, 'Rating not found');
    });
    await audit(a.id, d.hidden ? 'RATING_HIDDEN' : 'RATING_RESTORED', `rating:${String(req.params.id)}`);
    res.json({ ok: true });
  }),
);

// =====================================================================
// Analytics (US-39), logs (US-41), settings (D8)
// =====================================================================
adminRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const range = dateRange(req.query) ?? { gte: new Date(Date.now() - 30 * 86_400_000) };
    const [usersByRole, orders, paid, income, sessions] = await Promise.all([
      prisma.user.groupBy({ by: ['role'], _count: true }),
      prisma.order.findMany({ where: { createdAt: range }, select: { status: true, createdAt: true, total: true, paymentStatus: true } }),
      prisma.order.aggregate({ where: { createdAt: range, paymentStatus: 'PAID' }, _sum: { total: true, subtotal: true }, _count: true }),
      prisma.transaction.aggregate({ where: { createdAt: range }, _sum: { amount: true } }),
      prisma.session.findMany({ where: { createdAt: range }, select: { userId: true }, distinct: ['userId'] }),
    ]);
    const byStatus: Record<string, number> = {};
    const perDay = new Map<string, { orders: number; revenue: number }>();
    for (const o of orders) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      const day = o.createdAt.toISOString().slice(0, 10);
      const cur = perDay.get(day) ?? { orders: 0, revenue: 0 };
      cur.orders += 1;
      if (o.paymentStatus === 'PAID') cur.revenue += o.total;
      perDay.set(day, cur);
    }
    res.json({
      range: { from: range.gte ?? null, to: ('lte' in range ? range.lte : null) ?? null },
      users: Object.fromEntries(usersByRole.map((u) => [u.role, u._count])),
      activeUsers: sessions.length,
      orders: { total: orders.length, byStatus },
      revenue: paid._sum.total ?? 0, // paid order totals (refunded orders excluded)
      sales: paid._sum.subtotal ?? 0, // produce value, excluding delivery fees
      farmerIncome: income._sum.amount ?? 0,
      series: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    });
  }),
);

adminRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip, take } = pageParams(req.query, 30);
    const q = str(req.query.search); // matches user name/email or action
    const range = dateRange(req.query);
    const where: Prisma.AuditLogWhereInput = {
      ...(range ? { createdAt: range } : {}),
      ...(q ? { OR: [{ action: { contains: q.toUpperCase() } }, { detail: { contains: q } }, { actor: { name: { contains: q } } }, { actor: { email: { contains: q } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, include: { actor: { select: { name: true, email: true, role: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
    ]);
    res.json({ items: rows, total, page, pageSize });
  }),
);

adminRouter.get('/settings', asyncHandler(async (_req, res) => res.json({ deliveryFee: await getDeliveryFee() })));

adminRouter.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const a = me(req);
    const d = parse(z.object({ deliveryFee: z.number().int('Whole paise only').min(0).max(100_000) }), req.body);
    await setDeliveryFee(d.deliveryFee);
    await audit(a.id, 'SETTINGS_CHANGED', 'setting:deliveryFee', String(d.deliveryFee));
    res.json({ deliveryFee: d.deliveryFee });
  }),
);
