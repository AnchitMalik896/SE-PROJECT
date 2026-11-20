import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { authenticate, guard, me } from '../lib/auth.js';
import { asyncHandler, HttpError, parse } from '../lib/http.js';
import { notifyAdmins, readOutbox } from '../lib/notify.js';
import { publicUser } from './auth.js';

export const accountRouter = Router();

const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z
    .string()
    .trim()
    .transform((s) => s.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\+?\d{10,15}$/, 'Enter a valid phone number (10–15 digits)'))
    .optional(),
  address: z.string().trim().min(8, 'Enter your full address').max(300).optional(),
});
const farmerProfileSchema = z.object({
  farmName: z.string().trim().min(2).max(100).optional(),
  farmLocation: z.string().trim().min(3).max(200).optional(),
  bio: z.string().trim().max(500).optional(),
});

accountRouter.patch(
  '/profile',
  authenticate,
  asyncHandler(async (req, res) => {
    const u = me(req);
    const d = parse(profileSchema.merge(farmerProfileSchema), req.body);
    const { farmName, farmLocation, bio, ...userFields } = d;
    try {
      await prisma.$transaction(async (tx) => {
        if (Object.keys(userFields).length) await tx.user.update({ where: { id: u.id }, data: userFields });
        if (u.role === 'FARMER' && (farmName || farmLocation || bio !== undefined)) {
          await tx.farmerProfile.update({ where: { userId: u.id }, data: { farmName, farmLocation, bio } });
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new HttpError(409, 'That phone number is already registered', { phone: 'This phone number is already registered' });
      }
      throw e;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { farmerProfile: true } });
    res.json({ user: { ...publicUser(user), farmerProfile: user.farmerProfile } });
  }),
);

accountRouter.get(
  '/notifications',
  authenticate,
  asyncHandler(async (req, res) => {
    const u = me(req);
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.notification.count({ where: { userId: u.id, read: false } }),
    ]);
    res.json({ items, unread });
  }),
);

accountRouter.post(
  '/notifications/read',
  authenticate,
  asyncHandler(async (req, res) => {
    const d = parse(z.object({ ids: z.array(z.string()).optional() }), req.body ?? {});
    await prisma.notification.updateMany({
      where: { userId: me(req).id, read: false, ...(d.ids ? { id: { in: d.ids } } : {}) },
      data: { read: true },
    });
    res.json({ ok: true });
  }),
);

accountRouter.post(
  '/complaints',
  guard('CONSUMER', 'FARMER', 'DELIVERY'),
  asyncHandler(async (req, res) => {
    const u = me(req);
    const d = parse(
      z.object({
        subject: z.string().trim().min(3, 'Add a short subject').max(120),
        description: z.string().trim().min(10, 'Please describe the problem (at least 10 characters)').max(1500),
        orderId: z.string().optional(),
      }),
      req.body,
    );
    let againstId: string | undefined;
    if (d.orderId) {
      const o = await prisma.order.findUnique({ where: { id: d.orderId }, include: { delivery: true } });
      const involved = o && (o.consumerId === u.id || o.farmerId === u.id || o.delivery?.deliveryPersonId === u.id);
      if (!o || !involved) throw new HttpError(404, 'Order not found');
      againstId = u.role === 'CONSUMER' ? o.farmerId : u.role === 'FARMER' ? o.consumerId : o.consumerId;
    }
    const c = await prisma.complaint.create({ data: { filedById: u.id, againstId, orderId: d.orderId, subject: d.subject, description: d.description } });
    await notifyAdmins('COMPLAINT', `New complaint: ${d.subject}`);
    res.status(201).json({ complaint: c });
  }),
);

accountRouter.get(
  '/complaints',
  guard('CONSUMER', 'FARMER', 'DELIVERY'),
  asyncHandler(async (req, res) => {
    const items = await prisma.complaint.findMany({ where: { filedById: me(req).id }, orderBy: { createdAt: 'desc' } });
    res.json({ items });
  }),
);

accountRouter.get('/dev/outbox', (req, res) => {
  if (config.isProd) return res.status(404).json({ error: 'Not found' });
  res.json({ items: readOutbox(typeof req.query.to === 'string' ? req.query.to : undefined) });
});
