import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { signPayload } from '../src/services/payments.js';
import { expireUnpaidOrders } from '../src/services/orders.js';
import { api, auth, createAdmin, createApprovedFarmer, createConsumer, createCourier, createProduct, payOrder, placeOrder } from './helpers.js';

let admin: Awaited<ReturnType<typeof createAdmin>>;
beforeAll(async () => {
  admin = await createAdmin();
});

const stockOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).stock;

describe('Marketplace & checkout', () => {
  it('only shows verified, in-stock, active products; supports search + price filters', async () => {
    const farmer = await createApprovedFarmer();
    const tomato = await createProduct(farmer.token, { name: 'ZzUniqueTomato', price: 3000, stock: 5 });
    const empty = await createProduct(farmer.token, { name: 'ZzUniqueEmpty', stock: 0 });

    const found = await api().get('/api/products').query({ search: 'ZzUnique' });
    const ids = found.body.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(tomato.id);
    expect(ids).not.toContain(empty.id); // out-of-stock hidden from search

    const cheap = await api().get('/api/products').query({ search: 'ZzUnique', maxPrice: 2000 });
    expect(cheap.body.items).toHaveLength(0);

    // removed products leave search
    await api().delete(`/api/farmer/products/${tomato.id}`).set(auth(farmer.token));
    expect((await api().get('/api/products').query({ search: 'ZzUnique' })).body.items).toHaveLength(0);
  });

  it('validates product input', async () => {
    const farmer = await createApprovedFarmer();
    const r = await api().post('/api/farmer/products').set(auth(farmer.token)).send({ name: 'X', price: 5, unit: '', stock: -1 });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.fields)).toEqual(expect.arrayContaining(['name', 'price', 'unit', 'stock']));
  });

  it('cart cannot exceed available stock', async () => {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token, { stock: 3 });
    expect((await api().post('/api/cart').set(auth(consumer.token)).send({ productId: p.id, quantity: 3 })).status).toBe(201);
    const more = await api().post('/api/cart').set(auth(consumer.token)).send({ productId: p.id, quantity: 1 });
    expect(more.status).toBe(409);
    expect((await api().patch(`/api/cart/${p.id}`).set(auth(consumer.token)).send({ quantity: 4 })).status).toBe(409);
    const ok = await api().patch(`/api/cart/${p.id}`).set(auth(consumer.token)).send({ quantity: 2 });
    expect(ok.body.total).toBe(2 * 4000);
  });

  it('checkout reduces stock, splits orders per farmer and keeps one payment', async () => {
    const f1 = await createApprovedFarmer();
    const f2 = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p1 = await createProduct(f1.token, { stock: 10, price: 5000 });
    const p2 = await createProduct(f2.token, { stock: 10, price: 3000 });
    await api().post('/api/cart').set(auth(consumer.token)).send({ productId: p1.id, quantity: 2 });
    await api().post('/api/cart').set(auth(consumer.token)).send({ productId: p2.id, quantity: 1 });
    const res = await api().post('/api/orders/checkout').set(auth(consumer.token)).send({});
    expect(res.status).toBe(201);
    expect(res.body.orders).toHaveLength(2);
    const fee = res.body.orders[0].deliveryFee;
    expect(res.body.payment.amount).toBe(2 * 5000 + 3000 + 2 * fee);
    expect(await stockOf(p1.id)).toBe(8);
    expect(await stockOf(p2.id)).toBe(9);
    // cart emptied
    expect((await api().get('/api/cart').set(auth(consumer.token))).body.items).toHaveLength(0);
  });

  it('never oversells: concurrent checkouts for the last unit — exactly one wins', async () => {
    const farmer = await createApprovedFarmer();
    const p = await createProduct(farmer.token, { stock: 1 });
    const [c1, c2] = [await createConsumer(), await createConsumer()];
    await api().post('/api/cart').set(auth(c1.token)).send({ productId: p.id, quantity: 1 });
    await api().post('/api/cart').set(auth(c2.token)).send({ productId: p.id, quantity: 1 });
    const results = await Promise.all([c1, c2].map((c) => api().post('/api/orders/checkout').set(auth(c.token)).send({})));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await stockOf(p.id)).toBe(0);
  });

  it('retrying checkout with the same idempotency key does not create a duplicate order', async () => {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token, { stock: 10 });
    const key = 'idem-key-12345678';
    const first = await placeOrder(consumer.token, p.id, 2, { idempotencyKey: key });
    expect(first.status).toBe(201);
    const second = await api().post('/api/orders/checkout').set(auth(consumer.token)).send({ idempotencyKey: key });
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.groupId).toBe(first.body.groupId);
    expect(await stockOf(p.id)).toBe(8); // decremented once
    expect(await prisma.order.count({ where: { groupId: first.body.groupId } })).toBe(1);
  });

  it('rejects checkout of an empty cart', async () => {
    const consumer = await createConsumer();
    expect((await api().post('/api/orders/checkout').set(auth(consumer.token)).send({})).status).toBe(400);
  });
});

describe('Payments (AT-07, idempotency, signatures)', () => {
  it('AT-07: a failed payment is never treated as success; retry then succeeds', async () => {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token);
    const { body } = await placeOrder(consumer.token, p.id);

    const failed = await payOrder(consumer.token, body.groupId, 'DECLINED');
    expect(failed.body.status).toBe('FAILED');
    let order = await prisma.order.findFirstOrThrow({ where: { groupId: body.groupId } });
    expect(order.paymentStatus).toBe('FAILED');
    // the farmer must not see an unpaid order, and cannot act on it
    expect((await api().get('/api/farmer/orders').set(auth(farmer.token))).body.items).toHaveLength(0);
    expect((await api().patch(`/api/farmer/orders/${order.id}/status`).set(auth(farmer.token)).send({ status: 'ACCEPTED' })).status).toBe(409);

    expect((await api().post(`/api/payments/${body.groupId}/retry`).set(auth(consumer.token))).status).toBe(200);
    const ok = await payOrder(consumer.token, body.groupId, 'SUCCESS');
    expect(ok.body.status).toBe('SUCCESS');
    order = await prisma.order.findFirstOrThrow({ where: { groupId: body.groupId } });
    expect(order.paymentStatus).toBe('PAID');
    expect((await api().get('/api/farmer/orders').set(auth(farmer.token))).body.items).toHaveLength(1);
  });

  it('timeout is a failure too, and a paid payment cannot be retried', async () => {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token);
    const { body } = await placeOrder(consumer.token, p.id);
    expect((await payOrder(consumer.token, body.groupId, 'TIMEOUT')).body.status).toBe('FAILED');
    await api().post(`/api/payments/${body.groupId}/retry`).set(auth(consumer.token));
    await payOrder(consumer.token, body.groupId, 'SUCCESS');
    expect((await api().post(`/api/payments/${body.groupId}/retry`).set(auth(consumer.token))).status).toBe(409);
  });

  it('duplicate callbacks are idempotent: processed once, notifications sent once', async () => {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token);
    const { body } = await placeOrder(consumer.token, p.id);
    const r = await payOrder(consumer.token, body.groupId, 'SUCCESS', true);
    expect(r.body.duplicateIgnored).toBe(true);
    const n = await prisma.notification.count({ where: { userId: farmer.id, message: { contains: 'New paid order' } } });
    expect(n).toBe(1);
  });

  it('a late success after a failure does not flip a failed payment', async () => {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token);
    const { body } = await placeOrder(consumer.token, p.id);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { groupId: body.groupId } });
    await payOrder(consumer.token, body.groupId, 'DECLINED');

    const raw = JSON.stringify({ eventId: 'evt_late_success_1', gatewayRef: payment.gatewayRef, status: 'SUCCESS', amount: payment.amount });
    const hook = await api().post('/api/payments/webhook').set('x-signature', signPayload(raw)).set('content-type', 'application/json').send(raw);
    expect(hook.status).toBe(200);
    expect(hook.body.applied).toBe(false);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('FAILED');
  });

  it('webhook rejects bad signatures, wrong amounts and unknown payments', async () => {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token);
    const { body } = await placeOrder(consumer.token, p.id);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { groupId: body.groupId } });
    const send = (raw: string, sig: string) => api().post('/api/payments/webhook').set('x-signature', sig).set('content-type', 'application/json').send(raw);

    const good = JSON.stringify({ eventId: 'evt_bad_sig_1', gatewayRef: payment.gatewayRef, status: 'SUCCESS', amount: payment.amount });
    expect((await send(good, 'deadbeef')).status).toBe(401);
    expect((await send(good, signPayload(good + ' '))).status).toBe(401); // signature over different bytes
    const wrongAmount = JSON.stringify({ eventId: 'evt_wrong_amt_1', gatewayRef: payment.gatewayRef, status: 'SUCCESS', amount: 1 });
    expect((await send(wrongAmount, signPayload(wrongAmount))).status).toBe(400);
    const unknown = JSON.stringify({ eventId: 'evt_unknown_001', gatewayRef: 'nope', status: 'SUCCESS', amount: 1 });
    expect((await send(unknown, signPayload(unknown))).status).toBe(404);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
  });

  it('unpaid orders expire and release their stock', async () => {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token, { stock: 5 });
    const { body } = await placeOrder(consumer.token, p.id, 2);
    expect(await stockOf(p.id)).toBe(3);
    await prisma.order.updateMany({ where: { groupId: body.groupId }, data: { createdAt: new Date(Date.now() - 3600_000) } });
    expect(await expireUnpaidOrders()).toBeGreaterThanOrEqual(1);
    expect(await stockOf(p.id)).toBe(5);
    expect((await prisma.order.findFirstOrThrow({ where: { groupId: body.groupId } })).status).toBe('CANCELLED');
  });
});

describe('Order lifecycle, cancellation and delivery (AT-08)', () => {
  async function paidOrder(qty = 2) {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token, { stock: 10, price: 5000 });
    const { body } = await placeOrder(consumer.token, p.id, qty);
    await payOrder(consumer.token, body.groupId, 'SUCCESS');
    return { farmer, consumer, p, orderId: body.orders[0].id as string, groupId: body.groupId as string };
  }
  const setStatus = (token: string, id: string, status: string, reason?: string) => api().patch(`/api/farmer/orders/${id}/status`).set(auth(token)).send({ status, reason });

  it('enforces the state machine: no skipping steps', async () => {
    const { farmer, orderId } = await paidOrder();
    expect((await setStatus(farmer.token, orderId, 'PACKED')).status).toBe(409); // must accept first
    expect((await setStatus(farmer.token, orderId, 'ACCEPTED')).status).toBe(200);
    expect((await setStatus(farmer.token, orderId, 'ACCEPTED')).status).toBe(409); // no repeats
    expect((await setStatus(farmer.token, orderId, 'PACKED')).status).toBe(200);
    expect((await setStatus(farmer.token, orderId, 'ACCEPTED')).status).toBe(409); // no going back
  });

  it('cancel before packing: full refund and stock restored; after packing: refused', async () => {
    const { consumer, farmer, p, orderId } = await paidOrder(3);
    expect(await stockOf(p.id)).toBe(7);
    const c = await api().post(`/api/orders/${orderId}/cancel`).set(auth(consumer.token)).send({});
    expect(c.status).toBe(200);
    expect(await stockOf(p.id)).toBe(10);
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(refund.amount).toBe(order.total);
    expect(order.paymentStatus).toBe('REFUNDED');
    expect((await api().post(`/api/orders/${orderId}/cancel`).set(auth(consumer.token)).send({})).status).toBe(409); // no double refund
    expect(await prisma.refund.count({ where: { orderId } })).toBe(1);

    const second = await paidOrder();
    await setStatus(second.farmer.token, second.orderId, 'ACCEPTED');
    await setStatus(second.farmer.token, second.orderId, 'PACKED');
    const late = await api().post(`/api/orders/${second.orderId}/cancel`).set(auth(second.consumer.token)).send({});
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/packed/);
    void farmer;
  });

  it('cancelling an unpaid order restores stock without a refund', async () => {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token, { stock: 4 });
    const { body } = await placeOrder(consumer.token, p.id, 2);
    expect((await api().post(`/api/orders/${body.orders[0].id}/cancel`).set(auth(consumer.token)).send({})).status).toBe(200);
    expect(await stockOf(p.id)).toBe(4);
    expect(await prisma.refund.count({ where: { orderId: body.orders[0].id } })).toBe(0);
  });

  it('full flow: farmer packs → courier accepts, picks up → OTP delivery → payout released → rating', async () => {
    const { farmer, consumer, p, orderId } = await paidOrder(2);
    const courier = await createCourier();
    const other = await createCourier();

    await setStatus(farmer.token, orderId, 'ACCEPTED');
    await setStatus(farmer.token, orderId, 'PACKED');

    // available pool hides the drop address until accepted (privacy)
    const pool = await api().get('/api/delivery/available').set(auth(courier.token));
    const mine = pool.body.items.find((d: { orderId: string }) => d.orderId === orderId);
    expect(mine).toBeTruthy();
    expect(mine.dropAddress).toBeNull();
    expect(mine.dropPhone).toBeNull();

    // a declined delivery disappears for that courier only
    const declined = await api().post(`/api/delivery/${mine.id}/decline`).set(auth(other.token));
    expect(declined.status).toBe(200);
    expect((await api().get('/api/delivery/available').set(auth(other.token))).body.items.find((d: { id: string }) => d.id === mine.id)).toBeUndefined();
    expect((await api().get('/api/delivery/available').set(auth(courier.token))).body.items.find((d: { id: string }) => d.id === mine.id)).toBeTruthy();

    // only one courier can claim it
    const [a, b] = await Promise.all([courier, other].map((c) => api().post(`/api/delivery/${mine.id}/accept`).set(auth(c.token))));
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? courier : other;
    const loser = a.status === 200 ? other : courier;
    expect((await api().get(`/api/delivery/${mine.id}`).set(auth(loser.token))).status).toBe(404);
    const detail = await api().get(`/api/delivery/${mine.id}`).set(auth(winner.token));
    expect(detail.body.delivery.dropAddress).toContain('Test Street');

    // location sharing only works while delivering
    expect((await api().post(`/api/delivery/${mine.id}/location`).set(auth(winner.token)).send({ lat: 30.3, lng: 76.4 })).status).toBe(409);
    expect((await api().post(`/api/delivery/${mine.id}/status`).set(auth(winner.token)).send({ status: 'ON_THE_WAY' })).status).toBe(409); // must pick up first
    expect((await api().post(`/api/delivery/${mine.id}/status`).set(auth(winner.token)).send({ status: 'PICKED_UP' })).status).toBe(200);
    expect((await api().post(`/api/delivery/${mine.id}/location`).set(auth(winner.token)).send({ lat: 30.3, lng: 76.4 })).status).toBe(200);
    expect((await api().post(`/api/delivery/${mine.id}/location`).set(auth(winner.token)).send({ lat: 999, lng: 0 })).status).toBe(400);
    expect((await api().post(`/api/delivery/${mine.id}/status`).set(auth(winner.token)).send({ status: 'ON_THE_WAY' })).status).toBe(200);

    // consumer sees OTP + live location only now; farmer never sees the OTP
    const view = await api().get(`/api/orders/${orderId}`).set(auth(consumer.token));
    expect(view.body.order.status).toBe('DISPATCHED');
    expect(view.body.order.deliveryOtp).toMatch(/^\d{4}$/);
    expect(view.body.order.delivery.location).toMatchObject({ lat: 30.3, lng: 76.4 });
    expect((await api().get(`/api/orders/${orderId}`).set(auth(farmer.token))).body.order.deliveryOtp).toBeUndefined();

    // can't cancel once out for delivery
    expect((await api().post(`/api/orders/${orderId}/cancel`).set(auth(consumer.token)).send({})).status).toBe(409);

    // wrong OTP rejected; right OTP completes
    const wrong = view.body.order.deliveryOtp === '0000' ? '1111' : '0000';
    expect((await api().post(`/api/delivery/${mine.id}/confirm`).set(auth(winner.token)).send({ otp: wrong })).status).toBe(400);
    const done = await api().post(`/api/delivery/${mine.id}/confirm`).set(auth(winner.token)).send({ otp: view.body.order.deliveryOtp });
    expect(done.status).toBe(200);
    expect(done.body.delivery.status).toBe('DELIVERED');
    // confirming twice is refused
    expect((await api().post(`/api/delivery/${mine.id}/confirm`).set(auth(winner.token)).send({ otp: view.body.order.deliveryOtp })).status).toBe(409);

    // AT-08: status visible to the relevant users; location cleared after delivery
    const after = await api().get(`/api/orders/${orderId}`).set(auth(consumer.token));
    expect(after.body.order.status).toBe('DELIVERED');
    expect(after.body.order.delivery.location).toBeNull();
    const row = await prisma.delivery.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row.lat).toBeNull();

    // payout released exactly once, excluding the delivery fee
    const earnings = await api().get('/api/farmer/earnings').set(auth(farmer.token));
    expect(earnings.body.total).toBe(2 * 5000);
    expect(earnings.body.items).toHaveLength(1);

    // rating: only after delivery, once per product
    const rate = () => api().post(`/api/orders/${orderId}/rate`).set(auth(consumer.token)).send({ productId: p.id, stars: 5, comment: 'Great' });
    expect((await rate()).status).toBe(201);
    expect((await rate()).status).toBe(409);
    const prod = await api().get(`/api/products/${p.id}`);
    expect(prod.body.product.farmer.rating).toBe(5);
  });

  it('rating is refused before delivery', async () => {
    const { consumer, p, orderId } = await paidOrder();
    const r = await api().post(`/api/orders/${orderId}/rate`).set(auth(consumer.token)).send({ productId: p.id, stars: 4 });
    expect(r.status).toBe(409);
  });

  it('failed delivery escalates to admin, who can cancel + refund', async () => {
    const { farmer, consumer, orderId } = await paidOrder();
    const courier = await createCourier();
    await setStatus(farmer.token, orderId, 'ACCEPTED');
    await setStatus(farmer.token, orderId, 'PACKED');
    const del = await prisma.delivery.findUniqueOrThrow({ where: { orderId } });
    await api().post(`/api/delivery/${del.id}/accept`).set(auth(courier.token));
    await api().post(`/api/delivery/${del.id}/status`).set(auth(courier.token)).send({ status: 'PICKED_UP' });
    expect((await api().post(`/api/delivery/${del.id}/status`).set(auth(courier.token)).send({ status: 'FAILED' })).status).toBe(400); // reason required
    expect((await api().post(`/api/delivery/${del.id}/status`).set(auth(courier.token)).send({ status: 'FAILED', reason: 'Customer unreachable' })).status).toBe(200);

    const flagged = await api().get('/api/admin/orders').query({ stuck: 'true' }).set(auth(admin.token));
    const row = flagged.body.items.find((o: { id: string }) => o.id === orderId);
    expect(row.flags.join(' ')).toMatch(/Delivery failed/);

    const r = await api().post(`/api/admin/orders/${orderId}/cancel-refund`).set(auth(admin.token)).send({ reason: 'Delivery failed' });
    expect(r.status).toBe(200);
    expect(r.body.refunded).toBeGreaterThan(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe('REFUNDED');
    // no payout for a refunded order
    expect((await api().get('/api/farmer/earnings').set(auth(farmer.token))).body.total).toBe(0);
    void consumer;
  });

  it("users cannot read each other's orders", async () => {
    const { orderId } = await paidOrder();
    const stranger = await createConsumer();
    expect((await api().get(`/api/orders/${orderId}`).set(auth(stranger.token))).status).toBe(404);
    expect((await api().post(`/api/orders/${orderId}/cancel`).set(auth(stranger.token)).send({})).status).toBe(404);
    const otherFarmer = await createApprovedFarmer();
    expect((await api().patch(`/api/farmer/orders/${orderId}/status`).set(auth(otherFarmer.token)).send({ status: 'ACCEPTED' })).status).toBe(404);
  });
});

describe('Admin', () => {
  it('analytics, logs, payments and complaints work end to end', async () => {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token);
    const { body } = await placeOrder(consumer.token, p.id);
    await payOrder(consumer.token, body.groupId, 'SUCCESS');

    const a = await api().get('/api/admin/analytics').set(auth(admin.token));
    expect(a.status).toBe(200);
    expect(a.body.orders.total).toBeGreaterThan(0);
    expect(a.body.revenue).toBeGreaterThan(0);

    const pays = await api().get('/api/admin/payments').query({ status: 'SUCCESS' }).set(auth(admin.token));
    expect(pays.body.items.some((x: { groupId: string }) => x.groupId === body.groupId)).toBe(true);

    const logs = await api().get('/api/admin/logs').query({ search: 'CHECKOUT' }).set(auth(admin.token));
    expect(logs.body.items.length).toBeGreaterThan(0);

    const c = await api().post('/api/complaints').set(auth(consumer.token)).send({ subject: 'Late delivery', description: 'It was very late.', orderId: body.orders[0].id });
    expect(c.status).toBe(201);
    const res = await api().post(`/api/admin/complaints/${c.body.complaint.id}/resolve`).set(auth(admin.token)).send({ notes: 'Apologised and credited.' });
    expect(res.status).toBe(200);
    // both parties are told
    expect(await prisma.notification.count({ where: { userId: farmer.id, type: 'COMPLAINT' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: consumer.id, type: 'COMPLAINT' } })).toBeGreaterThanOrEqual(1);
  });

  it('manages delivery personnel and the delivery fee', async () => {
    const email = `new_${Date.now()}@t.test`;
    const created = await api().post('/api/admin/delivery').set(auth(admin.token)).send({ name: 'New Courier', email, phone: '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), password: 'Passw0rd!' });
    expect(created.status).toBe(201);
    expect((await api().delete(`/api/admin/delivery/${created.body.user.id}`).set(auth(admin.token))).body.deactivated).toBe(false);

    expect((await api().put('/api/admin/settings').set(auth(admin.token)).send({ deliveryFee: 5500 })).status).toBe(200);
    expect((await api().get('/api/settings/public')).body.deliveryFee).toBe(5500);
    await api().put('/api/admin/settings').set(auth(admin.token)).send({ deliveryFee: 4000 });
  });

  it('taken-down products disappear from search and carts', async () => {
    const farmer = await createApprovedFarmer();
    const consumer = await createConsumer();
    const p = await createProduct(farmer.token, { name: 'ZzTakedown' });
    await api().post('/api/cart').set(auth(consumer.token)).send({ productId: p.id, quantity: 1 });
    expect((await api().post(`/api/admin/products/${p.id}/takedown`).set(auth(admin.token)).send({ reason: 'Misleading listing' })).status).toBe(200);
    expect((await api().get('/api/products').query({ search: 'ZzTakedown' })).body.items).toHaveLength(0);
    expect((await api().get('/api/cart').set(auth(consumer.token))).body.items).toHaveLength(0);
  });
});
