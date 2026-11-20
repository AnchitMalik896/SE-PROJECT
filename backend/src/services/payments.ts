import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../lib/http.js';
import { audit, notify } from '../lib/notify.js';
import { short } from './orders.js';

export interface PaymentProvider {
  name: string;
  createIntent(input: { groupId: string; amount: number }): { gatewayRef: string };
}

export const mockProvider: PaymentProvider = {
  name: 'mock',
  createIntent: () => ({ gatewayRef: `mock_${crypto.randomUUID()}` }),
};
export const paymentProvider: PaymentProvider = mockProvider;

export function signPayload(rawBody: string, secret = config.webhookSecret): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifySignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signPayload(rawBody), 'hex');
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const eventSchema = z.object({
  eventId: z.string().min(8),
  gatewayRef: z.string().min(1),
  status: z.enum(['SUCCESS', 'FAILED']),
  amount: z.number().int().nonnegative(),
  reason: z.string().optional(),
});
export type GatewayEvent = z.infer<typeof eventSchema>;

export type WebhookResult = { ok: true; duplicate: boolean; applied: boolean; status: string };

export async function processWebhook(rawBody: string, signature: string | undefined): Promise<WebhookResult> {
  if (!verifySignature(rawBody, signature)) throw new HttpError(401, 'Invalid webhook signature');
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, 'Malformed webhook body');
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) throw new HttpError(400, 'Malformed webhook event');
  const ev = parsed.data;

  const payment = await prisma.payment.findUnique({ where: { gatewayRef: ev.gatewayRef } });
  if (!payment) throw new HttpError(404, 'Unknown payment');
  if (ev.amount !== payment.amount) throw new HttpError(400, 'Amount does not match the payment');

  return prisma.$transaction(async (tx) => {
    const seen = await tx.paymentEvent.findUnique({ where: { eventId: ev.eventId } });
    if (seen) return { ok: true as const, duplicate: true, applied: seen.applied, status: payment.status };

    const fresh = await tx.payment.findUnique({ where: { id: payment.id } });
    if (!fresh) throw new HttpError(404, 'Unknown payment');
    const apply = fresh.status === 'PENDING';
    await tx.paymentEvent.create({ data: { eventId: ev.eventId, paymentId: fresh.id, status: ev.status, applied: apply } });

    if (!apply) {
      await audit(null, 'PAYMENT_EVENT_IGNORED', `payment:${fresh.id}`, `event=${ev.eventId}; status=${ev.status}; current=${fresh.status}`, tx);
      return { ok: true as const, duplicate: false, applied: false, status: fresh.status };
    }

    const orders = await tx.order.findMany({ where: { groupId: fresh.groupId, status: { not: 'CANCELLED' } } });
    if (ev.status === 'SUCCESS') {
      await tx.payment.update({ where: { id: fresh.id }, data: { status: 'SUCCESS', failureReason: null } });
      await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { paymentStatus: 'PAID' } });
      await notify(fresh.consumerId, 'PAYMENT', `Payment of ₹${(fresh.amount / 100).toFixed(2)} received. Thank you!`, tx);
      for (const o of orders) {
        await notify(o.farmerId, 'ORDER', `New paid order #${short(o.id)} — please accept it.`, tx);
      }
      return { ok: true as const, duplicate: false, applied: true, status: 'SUCCESS' };
    }

    const reason = ev.reason ?? 'Payment was declined';
    await tx.payment.update({ where: { id: fresh.id }, data: { status: 'FAILED', failureReason: reason } });
    await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { paymentStatus: 'FAILED' } });
    await notify(fresh.consumerId, 'PAYMENT', `Payment failed: ${reason}. You can retry from your orders.`, tx);
    return { ok: true as const, duplicate: false, applied: true, status: 'FAILED' };
  });
}

export async function retryPayment(groupId: string, consumerId: string) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { groupId } });
    if (!payment || payment.consumerId !== consumerId) throw new HttpError(404, 'Payment not found');
    if (payment.status === 'SUCCESS') throw new HttpError(409, 'This payment has already been completed');
    if (payment.status === 'PENDING') return payment;
    const live = await tx.order.findMany({ where: { groupId, status: { not: 'CANCELLED' } } });
    if (live.length === 0) throw new HttpError(409, 'These orders were cancelled, so there is nothing to pay');
    const amount = live.reduce((s, o) => s + o.total, 0);
    const intent = paymentProvider.createIntent({ groupId, amount });
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'PENDING', failureReason: null, amount, gatewayRef: intent.gatewayRef, attempts: { increment: 1 } },
    });
    await tx.order.updateMany({ where: { id: { in: live.map((o) => o.id) } }, data: { paymentStatus: 'PENDING' } });
    return updated;
  });
}
