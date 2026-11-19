import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { authenticate, me } from '../lib/auth.js';
import { asyncHandler, HttpError, parse } from '../lib/http.js';
import { processWebhook, retryPayment, signPayload } from '../services/payments.js';
import { short } from '../services/orders.js';

/** POST /api/payments/webhook — mounted with express.raw() so the HMAC is computed over the exact bytes. */
export const webhookHandler = asyncHandler(async (req: Request, res: Response) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : '';
  const result = await processWebhook(raw, req.header('x-signature') ?? undefined);
  res.json(result);
});

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

async function ownPayment(groupId: string, user: { id: string; role: string }) {
  const payment = await prisma.payment.findUnique({ where: { groupId } });
  if (!payment || (user.role !== 'ADMIN' && payment.consumerId !== user.id)) throw new HttpError(404, 'Payment not found');
  return payment;
}

paymentsRouter.get(
  '/:groupId',
  asyncHandler(async (req, res) => {
    const u = me(req);
    const payment = await ownPayment(String(req.params.groupId), u);
    const orders = await prisma.order.findMany({
      where: { groupId: payment.groupId },
      select: { id: true, status: true, paymentStatus: true, total: true, farmer: { select: { name: true, farmerProfile: { select: { farmName: true } } } } },
    });
    res.json({
      payment: {
        groupId: payment.groupId,
        amount: payment.amount,
        status: payment.status,
        failureReason: payment.failureReason,
        attempts: payment.attempts,
        gatewayRef: u.role === 'ADMIN' || u.id === payment.consumerId ? payment.gatewayRef : undefined,
        mockGateway: config.enableMockGateway,
      },
      orders: orders.map((o) => ({ id: o.id, ref: short(o.id), status: o.status, paymentStatus: o.paymentStatus, total: o.total, farmName: o.farmer.farmerProfile?.farmName ?? o.farmer.name })),
    });
  }),
);

// US-18: failed payment lets the consumer retry
paymentsRouter.post(
  '/:groupId/retry',
  asyncHandler(async (req, res) => {
    const u = me(req);
    if (u.role !== 'CONSUMER') throw new HttpError(403, 'Only the customer can retry a payment');
    const p = await retryPayment(String(req.params.groupId), u.id);
    res.json({ payment: { groupId: p.groupId, amount: p.amount, status: p.status, attempts: p.attempts } });
  }),
);

/**
 * Mock gateway: simulates what a real gateway does — it decides the outcome, then calls OUR webhook
 * with a signed event. Everything after that goes through the exact same code path as production.
 */
paymentsRouter.post(
  '/:groupId/mock-complete',
  asyncHandler(async (req, res) => {
    if (!config.enableMockGateway) throw new HttpError(404, 'Not found');
    const u = me(req);
    if (u.role !== 'CONSUMER') throw new HttpError(403, 'Only the customer can pay');
    const d = parse(
      z.object({
        outcome: z.enum(['SUCCESS', 'DECLINED', 'TIMEOUT']),
        duplicate: z.boolean().optional(), // also send the same event a second time (idempotency demo)
      }),
      req.body,
    );
    const payment = await ownPayment(String(req.params.groupId), u);
    const event = {
      eventId: `evt_${crypto.randomUUID()}`,
      gatewayRef: payment.gatewayRef,
      status: d.outcome === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      amount: payment.amount,
      reason: d.outcome === 'DECLINED' ? 'Card declined by the bank' : d.outcome === 'TIMEOUT' ? 'Gateway timed out' : undefined,
    };
    const raw = JSON.stringify(event);
    const sig = signPayload(raw);
    const first = await processWebhook(raw, sig);
    const second = d.duplicate ? await processWebhook(raw, sig) : null;
    res.json({ status: first.status, applied: first.applied, duplicateIgnored: second ? second.duplicate : false });
  }),
);
