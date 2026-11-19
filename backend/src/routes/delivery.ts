import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { guard, me } from '../lib/auth.js';
import { asyncHandler, HttpError, parse } from '../lib/http.js';
import { audit, notify, notifyAdmins } from '../lib/notify.js';
import { short } from '../services/orders.js';

export const deliveryRouter = Router();
deliveryRouter.use(guard('DELIVERY'));

const include = {
  order: {
    include: {
      items: true,
      farmer: { select: { name: true, farmerProfile: { select: { farmName: true } } } },
    },
  },
} satisfies Prisma.DeliveryInclude;
type DeliveryFull = Prisma.DeliveryGetPayload<{ include: typeof include }>;

/**
 * US-26: addresses and phone numbers are revealed only for deliveries assigned to the caller.
 * Unassigned deliveries show the farm's pickup area only.
 */
function shape(d: DeliveryFull, viewerId: string) {
  const mine = d.deliveryPersonId === viewerId;
  return {
    id: d.id,
    orderId: d.orderId,
    orderRef: short(d.orderId),
    status: d.status,
    farmName: d.order.farmer.farmerProfile?.farmName ?? d.order.farmer.name,
    itemCount: d.order.items.reduce((s, i) => s + i.quantity, 0),
    items: mine ? d.order.items.map((i) => `${i.quantity} × ${i.name}`) : undefined,
    pickupAddress: d.pickupAddress,
    dropAddress: mine ? d.dropAddress : null,
    pickupPhone: mine ? d.pickupPhone : null,
    dropPhone: mine ? d.dropPhone : null,
    orderTotal: d.order.total,
    paymentNote: 'Prepaid online — do not collect cash',
    lat: mine ? d.lat : null,
    lng: mine ? d.lng : null,
    locationUpdatedAt: mine ? d.locationUpdatedAt : null,
    failureReason: d.failureReason,
    createdAt: d.createdAt,
    completedAt: d.completedAt,
    mine,
  };
}

async function mineOrThrow(id: string, userId: string) {
  const d = await prisma.delivery.findFirst({ where: { id, deliveryPersonId: userId }, include });
  if (!d) throw new HttpError(404, 'Delivery not found');
  return d;
}

// US-24 (pool): packed orders nobody has taken yet, minus ones I declined
deliveryRouter.get(
  '/available',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const rows = await prisma.delivery.findMany({
      where: { status: 'UNASSIGNED', deliveryPersonId: null, order: { status: 'PACKED' }, declines: { none: { userId: u.id } } },
      include,
      orderBy: { createdAt: 'asc' },
    });
    res.json({ items: rows.map((r) => shape(r, u.id)) });
  }),
);

// US-24: my deliveries, active vs completed shown separately
deliveryRouter.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const state = req.query.state === 'completed' ? 'completed' : 'active';
    const rows = await prisma.delivery.findMany({
      where: {
        deliveryPersonId: u.id,
        status: state === 'completed' ? { in: ['DELIVERED', 'FAILED'] } : { in: ['ASSIGNED', 'PICKED_UP', 'ON_THE_WAY'] },
      },
      include,
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ items: rows.map((r) => shape(r, u.id)) });
  }),
);

deliveryRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const u = me(req);
    res.json({ delivery: shape(await mineOrThrow(String(req.params.id), u.id), u.id) });
  }),
);

// US-25: accept — atomic claim so two couriers can't both get it
deliveryRouter.post(
  '/:id/accept',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const id = String(req.params.id);
    const claimed = await prisma.delivery.updateMany({
      where: { id, status: 'UNASSIGNED', deliveryPersonId: null, order: { status: 'PACKED' } },
      data: { status: 'ASSIGNED', deliveryPersonId: u.id },
    });
    if (claimed.count !== 1) throw new HttpError(409, 'Someone else already took this delivery');
    const d = await mineOrThrow(id, u.id);
    await notify(d.order.farmerId, 'DELIVERY', `${u.name} will pick up order #${short(d.orderId)}.`);
    await notify(d.order.consumerId, 'ORDER', `A delivery partner has been assigned to your order #${short(d.orderId)}.`);
    res.json({ delivery: shape(d, u.id) });
  }),
);

// US-25: decline an unassigned request — it returns to the pool for others
deliveryRouter.post(
  '/:id/decline',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const d = await prisma.delivery.findFirst({ where: { id: String(req.params.id), status: 'UNASSIGNED' } });
    if (!d) throw new HttpError(404, 'Delivery not available');
    await prisma.deliveryDecline.upsert({
      where: { deliveryId_userId: { deliveryId: d.id, userId: u.id } },
      update: {},
      create: { deliveryId: d.id, userId: u.id },
    });
    res.json({ message: 'Declined. It stays available for other delivery partners.' });
  }),
);

// FR-15 assignment rejection after accepting: only before pickup; goes back to the pool
deliveryRouter.post(
  '/:id/release',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const d = parse(z.object({ reason: z.string().trim().min(3, 'Please give a reason').max(200) }), req.body);
    const cur = await mineOrThrow(String(req.params.id), u.id);
    if (cur.status !== 'ASSIGNED') throw new HttpError(409, 'You can only give up a delivery before picking it up');
    await prisma.$transaction([
      prisma.delivery.update({ where: { id: cur.id }, data: { status: 'UNASSIGNED', deliveryPersonId: null } }),
      prisma.deliveryDecline.upsert({ where: { deliveryId_userId: { deliveryId: cur.id, userId: u.id } }, update: {}, create: { deliveryId: cur.id, userId: u.id } }),
    ]);
    await audit(u.id, 'DELIVERY_RELEASED', `delivery:${cur.id}`, d.reason);
    res.json({ message: 'Delivery released back to the pool.' });
  }),
);

// US-28: picked up -> on the way (-> delivered via OTP confirm) or failed
deliveryRouter.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const d = parse(z.object({ status: z.enum(['PICKED_UP', 'ON_THE_WAY', 'FAILED']), reason: z.string().trim().max(200).optional() }), req.body);
    const cur = await mineOrThrow(String(req.params.id), u.id);
    const legal: Record<string, string[]> = { ASSIGNED: ['PICKED_UP'], PICKED_UP: ['ON_THE_WAY', 'FAILED'], ON_THE_WAY: ['FAILED'] };
    if (!(legal[cur.status] ?? []).includes(d.status)) throw new HttpError(409, `A delivery that is ${cur.status.toLowerCase().replace('_', ' ')} cannot be set to ${d.status.toLowerCase().replace('_', ' ')}`);
    if (d.status === 'FAILED' && (!d.reason || d.reason.length < 3)) throw new HttpError(400, 'Please explain what went wrong', { reason: 'A reason is required' });

    await prisma.$transaction(async (tx) => {
      if (d.status === 'PICKED_UP') {
        const otp = String(crypto.randomInt(0, 10_000)).padStart(4, '0');
        const upd = await tx.order.updateMany({ where: { id: cur.orderId, status: 'PACKED' }, data: { status: 'DISPATCHED', deliveryOtp: otp } });
        if (upd.count !== 1) throw new HttpError(409, 'This order cannot be picked up right now');
        await tx.delivery.update({ where: { id: cur.id }, data: { status: 'PICKED_UP' } });
        await notify(cur.order.consumerId, 'ORDER', `Your order #${short(cur.orderId)} is out for delivery. Share OTP ${otp} with the delivery partner at handover.`, tx);
        await notify(cur.order.farmerId, 'ORDER', `Order #${short(cur.orderId)} was picked up.`, tx);
      } else if (d.status === 'ON_THE_WAY') {
        await tx.delivery.update({ where: { id: cur.id }, data: { status: 'ON_THE_WAY' } });
        await notify(cur.order.consumerId, 'ORDER', `Your order #${short(cur.orderId)} is on the way.`, tx);
      } else {
        // failed delivery: escalate to an administrator, keep the order for their decision
        await tx.delivery.update({ where: { id: cur.id }, data: { status: 'FAILED', failureReason: d.reason, lat: null, lng: null } });
        await notifyAdmins('DELIVERY', `Delivery for order #${short(cur.orderId)} failed: ${d.reason}`, tx);
        await notify(cur.order.consumerId, 'ORDER', `We could not deliver order #${short(cur.orderId)}. Support has been notified.`, tx);
        await audit(u.id, 'DELIVERY_FAILED', `delivery:${cur.id}`, d.reason, tx);
      }
    });
    res.json({ delivery: shape(await mineOrThrow(cur.id, u.id), u.id) });
  }),
);

// US-29: live location, only while out for delivery
deliveryRouter.post(
  '/:id/location',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const d = parse(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }), req.body);
    const cur = await mineOrThrow(String(req.params.id), u.id);
    if (cur.status !== 'PICKED_UP' && cur.status !== 'ON_THE_WAY') throw new HttpError(409, 'Location is only shared while delivering');
    await prisma.delivery.update({ where: { id: cur.id }, data: { lat: d.lat, lng: d.lng, locationUpdatedAt: new Date() } });
    res.json({ ok: true });
  }),
);

// US-30: confirm with the consumer's OTP — releases the farmer's payout
deliveryRouter.post(
  '/:id/confirm',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const d = parse(z.object({ otp: z.string().trim().regex(/^\d{4}$/, 'Enter the 4-digit code from the customer') }), req.body);
    const cur = await mineOrThrow(String(req.params.id), u.id);
    if (cur.status !== 'PICKED_UP' && cur.status !== 'ON_THE_WAY') throw new HttpError(409, 'Pick the order up before confirming delivery');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: cur.orderId } });
    const a = Buffer.from(order.deliveryOtp ?? '----');
    const b = Buffer.from(d.otp);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(400, "That code doesn't match. Ask the customer to check their order page.", { otp: 'Incorrect code' });

    await prisma.$transaction(async (tx) => {
      const upd = await tx.order.updateMany({ where: { id: order.id, status: 'DISPATCHED', payoutStatus: 'HELD' }, data: { status: 'DELIVERED', payoutStatus: 'RELEASED', deliveryOtp: null } });
      if (upd.count !== 1) throw new HttpError(409, 'This delivery was already confirmed');
      await tx.delivery.update({ where: { id: cur.id }, data: { status: 'DELIVERED', completedAt: new Date(), lat: null, lng: null } }); // sharing stops, location cleared
      await tx.transaction.create({ data: { userId: order.farmerId, orderId: order.id, type: 'EARNING', amount: order.subtotal } });
      await notify(order.consumerId, 'ORDER', `Order #${short(order.id)} was delivered. You can now rate your products.`, tx);
      await notify(order.farmerId, 'PAYMENT', `Order #${short(order.id)} delivered. ₹${(order.subtotal / 100).toFixed(2)} has been added to your earnings.`, tx);
      await audit(u.id, 'DELIVERY_CONFIRMED', `order:${order.id}`, undefined, tx);
    });
    res.json({ delivery: shape(await mineOrThrow(cur.id, u.id), u.id) });
  }),
);
