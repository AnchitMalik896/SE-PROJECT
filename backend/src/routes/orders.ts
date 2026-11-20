import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, guard, me, type AuthUser } from '../lib/auth.js';
import { asyncHandler, HttpError, pageParams, parse, dateRange } from '../lib/http.js';
import { audit, notify } from '../lib/notify.js';
import { getDeliveryFee } from '../lib/settings.js';
import { assertTransition, cancelOrder, short } from '../services/orders.js';
import { paymentProvider } from '../services/payments.js';

export const orderInclude = {
  items: true,
  farmer: { select: { id: true, name: true, farmerProfile: { select: { farmName: true, farmLocation: true } } } },
  consumer: { select: { id: true, name: true } },
  delivery: { include: { deliveryPerson: { select: { id: true, name: true, phone: true } } } },
  refunds: true,
  ratings: { select: { productId: true, stars: true } },
} satisfies Prisma.OrderInclude;

type OrderFull = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function shapeOrder(o: OrderFull, viewer: Pick<AuthUser, 'id' | 'role'>) {
  const isConsumer = viewer.role === 'CONSUMER';
  const isAdmin = viewer.role === 'ADMIN';
  const d = o.delivery;
  const outForDelivery = d && (d.status === 'PICKED_UP' || d.status === 'ON_THE_WAY');
  return {
    id: o.id,
    ref: short(o.id),
    groupId: o.groupId,
    status: o.status,
    paymentStatus: o.paymentStatus,
    payoutStatus: isConsumer ? undefined : o.payoutStatus,
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    total: o.total,
    deliveryAddress: viewer.role === 'FARMER' ? null : o.deliveryAddress,
    cancelReason: o.cancelReason,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    items: o.items.map((i) => ({ productId: i.productId, name: i.name, unit: i.unit, unitPrice: i.unitPrice, quantity: i.quantity })),
    farmer: {
      id: o.farmer.id,
      name: o.farmer.name,
      farmName: o.farmer.farmerProfile?.farmName ?? o.farmer.name,
      farmLocation: o.farmer.farmerProfile?.farmLocation ?? '',
    },
    consumer: isConsumer ? undefined : { id: o.consumer.id, name: o.consumer.name },
    deliveryOtp: isConsumer && o.status === 'DISPATCHED' ? o.deliveryOtp : undefined,
    refunded: o.refunds.reduce((s, r) => s + r.amount, 0),
    ratedProductIds: o.ratings.map((r) => r.productId),
    delivery: d
      ? {
          id: d.id,
          status: d.status,
          assignedTo: d.deliveryPerson ? { name: d.deliveryPerson.name, phone: d.deliveryPerson.phone } : null,
          readyAt: d.createdAt,
          updatedAt: d.updatedAt,
          completedAt: d.completedAt,
          failureReason: isConsumer ? undefined : d.failureReason,
          location: (isConsumer || isAdmin) && outForDelivery && d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng, updatedAt: d.locationUpdatedAt } : null,
        }
      : null,
  };
}

async function loadOrder(id: string) {
  const o = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!o) throw new HttpError(404, 'Order not found');
  return o;
}

export const ordersRouter = Router();

const checkoutBody = z.object({
  deliveryAddress: z.string().trim().min(8, 'Enter a full delivery address').max(300).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

async function replayCheckout(consumerId: string, key: string) {
  const orders = await prisma.order.findMany({
    where: { consumerId, idempotencyKey: { startsWith: `${key}#` } },
    include: orderInclude,
  });
  if (!orders.length) return null;
  const payment = await prisma.payment.findUnique({ where: { groupId: orders[0].groupId } });
  return { groupId: orders[0].groupId, orders: orders.map((o) => shapeOrder(o, { id: consumerId, role: 'CONSUMER' })), payment, replayed: true };
}

ordersRouter.post(
  '/checkout',
  guard('CONSUMER'),
  asyncHandler(async (req, res) => {
    const user = me(req);
    const d = parse(checkoutBody, req.body);
    const key = d.idempotencyKey ?? req.header('idempotency-key') ?? undefined;
    if (key) {
      const replay = await replayCheckout(user.id, key);
      if (replay) return res.json(replay);
    }
    const profile = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const address = d.deliveryAddress ?? profile.address;
    if (!address) throw new HttpError(400, 'Add a delivery address first', { deliveryAddress: 'Delivery address is required' });
    const deliveryFee = await getDeliveryFee();

    try {
      const created = await prisma.$transaction(async (tx) => {
        const cart = await tx.cartItem.findMany({ where: { userId: user.id }, include: { product: { include: { farmer: true } } }, orderBy: { id: 'asc' } });
        if (!cart.length) throw new HttpError(400, 'Your cart is empty');

        for (const c of cart) {
          const p = c.product;
          if (!p.active || p.takenDownReason || p.farmer.status !== 'ACTIVE') throw new HttpError(409, `"${p.name}" is no longer available. Remove it from your cart.`);
          const upd = await tx.product.updateMany({ where: { id: p.id, stock: { gte: c.quantity } }, data: { stock: { decrement: c.quantity } } });
          if (upd.count !== 1) throw new HttpError(409, `Not enough stock for "${p.name}". Please reduce the quantity.`);
        }

        const byFarmer = new Map<string, typeof cart>();
        for (const c of cart) byFarmer.set(c.product.farmerId, [...(byFarmer.get(c.product.farmerId) ?? []), c]);

        const groupId = crypto.randomUUID();
        const orders = [];
        let amount = 0;
        for (const [farmerId, lines] of byFarmer) {
          const subtotal = lines.reduce((s, l) => s + l.product.price * l.quantity, 0);
          const total = subtotal + deliveryFee;
          amount += total;
          const order = await tx.order.create({
            data: {
              groupId,
              consumerId: user.id,
              farmerId,
              subtotal,
              deliveryFee,
              total,
              deliveryAddress: address,
              idempotencyKey: key ? `${key}#${farmerId}` : null,
              items: {
                create: lines.map((l) => ({ productId: l.productId, name: l.product.name, unit: l.product.unit, unitPrice: l.product.price, quantity: l.quantity })),
              },
            },
            include: orderInclude,
          });
          orders.push(order);
        }
        const intent = paymentProvider.createIntent({ groupId, amount });
        const payment = await tx.payment.create({ data: { groupId, consumerId: user.id, amount, gatewayRef: intent.gatewayRef } });
        await tx.cartItem.deleteMany({ where: { userId: user.id } });
        await audit(user.id, 'CHECKOUT', `group:${groupId}`, `orders=${orders.length}; amount=${amount}`, tx);
        return { groupId, orders, payment };
      });
      res.status(201).json({ groupId: created.groupId, orders: created.orders.map((o) => shapeOrder(o, user)), payment: created.payment });
    } catch (e) {
      if (key && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const replay = await replayCheckout(user.id, key);
        if (replay) return res.json(replay);
      }
      throw e;
    }
  }),
);

ordersRouter.get(
  '/',
  guard('CONSUMER'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip, take } = pageParams(req.query, 20);
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    const where = { consumerId: me(req).id, ...(status ? { status } : {}) };
    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, skip, take }),
    ]);
    res.json({ items: rows.map((o) => shapeOrder(o, me(req))), total, page, pageSize });
  }),
);

ordersRouter.get(
  '/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const u = me(req);
    const o = await loadOrder(String(req.params.id));
    const allowed = u.role === 'ADMIN' || (u.role === 'CONSUMER' && o.consumerId === u.id) || (u.role === 'FARMER' && o.farmerId === u.id);
    if (!allowed) throw new HttpError(404, 'Order not found');
    res.json({ order: shapeOrder(o, u) });
  }),
);

ordersRouter.post(
  '/:id/cancel',
  guard('CONSUMER'),
  asyncHandler(async (req, res) => {
    const u = me(req);
    const d = parse(z.object({ reason: z.string().trim().max(200).optional() }), req.body);
    const o = await loadOrder(String(req.params.id));
    if (o.consumerId !== u.id) throw new HttpError(404, 'Order not found');
    const result = await cancelOrder(o.id, d.reason || 'Cancelled by customer', 'CONSUMER', u.id);
    res.json({ message: result.refunded ? 'Order cancelled. Your refund has been started.' : 'Order cancelled.', order: shapeOrder(await loadOrder(o.id), u) });
  }),
);

ordersRouter.post(
  '/:id/rate',
  guard('CONSUMER'),
  asyncHandler(async (req, res) => {
    const u = me(req);
    const d = parse(
      z.object({ productId: z.string(), stars: z.number().int().min(1, 'Choose 1–5 stars').max(5, 'Choose 1–5 stars'), comment: z.string().trim().max(500).optional() }),
      req.body,
    );
    const o = await loadOrder(String(req.params.id));
    if (o.consumerId !== u.id) throw new HttpError(404, 'Order not found');
    if (o.status !== 'DELIVERED') throw new HttpError(409, 'You can rate products once the order is delivered');
    if (!o.items.some((i) => i.productId === d.productId)) throw new HttpError(400, 'That product is not part of this order');
    try {
      const r = await prisma.rating.create({
        data: { orderId: o.id, productId: d.productId, consumerId: u.id, farmerId: o.farmerId, stars: d.stars, comment: d.comment },
      });
      res.status(201).json({ rating: r });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new HttpError(409, 'You already rated this product for this order');
      throw e;
    }
  }),
);

export const farmerOrdersRouter = Router();
farmerOrdersRouter.use(guard('FARMER'));

farmerOrdersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip, take } = pageParams(req.query, 20);
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    const where = { farmerId: me(req).id, paymentStatus: { in: ['PAID', 'REFUNDED'] }, ...(status ? { status } : {}) };
    const [total, rows] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, skip, take }),
    ]);
    res.json({ items: rows.map((o) => shapeOrder(o, me(req))), total, page, pageSize });
  }),
);

farmerOrdersRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const d = parse(z.object({ status: z.enum(['ACCEPTED', 'PACKED', 'CANCELLED']), reason: z.string().trim().max(200).optional() }), req.body);
    const o = await prisma.order.findFirst({ where: { id: String(req.params.id), farmerId: u.id }, include: { consumer: true, farmer: { include: { farmerProfile: true } } } });
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.paymentStatus !== 'PAID') throw new HttpError(409, "This order is waiting for the customer's payment");

    if (d.status === 'CANCELLED') {
      if (!d.reason || d.reason.length < 3) throw new HttpError(400, 'Please give a reason', { reason: 'A reason is required to cancel' });
      await cancelOrder(o.id, d.reason, 'FARMER', u.id);
      return res.json({ order: shapeOrder(await loadOrder(o.id), u) });
    }
    assertTransition(o.status, d.status);

    await prisma.$transaction(async (tx) => {
      const upd = await tx.order.updateMany({ where: { id: o.id, status: o.status }, data: { status: d.status } });
      if (upd.count !== 1) throw new HttpError(409, 'This order was just updated. Refresh and try again.');
      if (d.status === 'PACKED') {
        await tx.delivery.create({
          data: {
            orderId: o.id,
            pickupAddress: o.farmer.farmerProfile?.farmLocation ?? o.farmer.name,
            dropAddress: o.deliveryAddress,
            pickupPhone: o.farmer.phone,
            dropPhone: o.consumer.phone,
          },
        });
        const couriers = await tx.user.findMany({ where: { role: 'DELIVERY', status: 'ACTIVE' }, select: { id: true } });
        if (couriers.length) {
          await tx.notification.createMany({
            data: couriers.map((c) => ({ userId: c.id, type: 'DELIVERY', message: `New delivery available from ${o.farmer.farmerProfile?.farmName ?? o.farmer.name}.` })),
          });
        }
      }
      const msg = d.status === 'ACCEPTED' ? 'was accepted by the farmer' : 'is packed and ready for pickup';
      await notify(o.consumerId, 'ORDER', `Your order #${short(o.id)} ${msg}.`, tx);
    });
    res.json({ order: shapeOrder(await loadOrder(o.id), u) });
  }),
);

export const farmerMiscRouter = Router();
farmerMiscRouter.use(guard('FARMER'));

farmerMiscRouter.get(
  '/earnings',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const range = dateRange(req.query);
    const txns = await prisma.transaction.findMany({
      where: { userId: u.id, ...(range ? { createdAt: range } : {}) },
      include: { order: { select: { id: true, items: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const pending = await prisma.order.aggregate({
      where: { farmerId: u.id, paymentStatus: 'PAID', payoutStatus: 'HELD', status: { not: 'CANCELLED' } },
      _sum: { subtotal: true },
      _count: true,
    });
    res.json({
      total: txns.reduce((s, t) => s + t.amount, 0),
      pendingPayout: pending._sum.subtotal ?? 0,
      pendingOrders: pending._count,
      items: txns.map((t) => ({
        id: t.id,
        orderId: t.orderId,
        orderRef: short(t.orderId),
        amount: t.amount,
        createdAt: t.createdAt,
        items: t.order.items.map((i) => `${i.quantity} × ${i.name}`),
      })),
    });
  }),
);

farmerMiscRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const [byStatus, lowStock, earnings] = await Promise.all([
      prisma.order.groupBy({ by: ['status'], where: { farmerId: u.id, paymentStatus: { in: ['PAID', 'REFUNDED'] } }, _count: true }),
      prisma.product.findMany({ where: { farmerId: u.id, active: true, stock: { lte: 5 } }, select: { id: true, name: true, stock: true, unit: true }, orderBy: { stock: 'asc' } }),
      prisma.transaction.aggregate({ where: { userId: u.id }, _sum: { amount: true } }),
    ]);
    res.json({
      orders: Object.fromEntries(byStatus.map((b) => [b.status, b._count])),
      lowStock,
      totalEarnings: earnings._sum.amount ?? 0,
    });
  }),
);
