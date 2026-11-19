import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { guard, me } from '../lib/auth.js';
import { asyncHandler, HttpError, parse } from '../lib/http.js';

export const cartRouter = Router();
cartRouter.use(guard('CONSUMER'));

async function loadCart(userId: string) {
  const rows = await prisma.cartItem.findMany({
    where: { userId },
    include: { product: { include: { farmer: { select: { id: true, name: true, status: true, farmerProfile: { select: { farmName: true } } } } } } },
    orderBy: { id: 'asc' },
  });
  const items = rows.map((r) => {
    const p = r.product;
    const available = p.active && !p.takenDownReason && p.farmer.status === 'ACTIVE';
    return {
      productId: p.id,
      name: p.name,
      unit: p.unit,
      price: p.price,
      photoUrl: p.photoUrl,
      quantity: r.quantity,
      stock: p.stock,
      farmerId: p.farmerId,
      farmName: p.farmer.farmerProfile?.farmName ?? p.farmer.name,
      available,
      problem: !available ? 'No longer available' : r.quantity > p.stock ? `Only ${p.stock} left` : null,
      lineTotal: p.price * r.quantity,
    };
  });
  const total = items.reduce((s, i) => s + i.lineTotal, 0);
  return { items, total, count: items.reduce((s, i) => s + i.quantity, 0), hasProblems: items.some((i) => i.problem) };
}

async function purchasable(productId: string) {
  const p = await prisma.product.findFirst({
    where: { id: productId, active: true, takenDownReason: null, farmer: { status: 'ACTIVE' } },
  });
  if (!p) throw new HttpError(404, 'This product is not available');
  return p;
}

cartRouter.get('/', asyncHandler(async (req, res) => res.json(await loadCart(me(req).id))));

cartRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const d = parse(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(999).default(1) }), req.body);
    const userId = me(req).id;
    const p = await purchasable(d.productId);
    const existing = await prisma.cartItem.findUnique({ where: { userId_productId: { userId, productId: p.id } } });
    const next = (existing?.quantity ?? 0) + d.quantity;
    if (next > p.stock) {
      throw new HttpError(409, p.stock === 0 ? 'This product is out of stock' : `Only ${p.stock} ${p.unit} available`);
    }
    await prisma.cartItem.upsert({
      where: { userId_productId: { userId, productId: p.id } },
      update: { quantity: next },
      create: { userId, productId: p.id, quantity: next },
    });
    res.status(201).json(await loadCart(userId));
  }),
);

cartRouter.patch(
  '/:productId',
  asyncHandler(async (req, res) => {
    const d = parse(z.object({ quantity: z.number().int().min(0).max(999) }), req.body);
    const userId = me(req).id;
    const productId = String(req.params.productId);
    if (d.quantity === 0) {
      await prisma.cartItem.deleteMany({ where: { userId, productId } });
    } else {
      const p = await purchasable(productId);
      if (d.quantity > p.stock) throw new HttpError(409, `Only ${p.stock} ${p.unit} available`);
      await prisma.cartItem.upsert({
        where: { userId_productId: { userId, productId } },
        update: { quantity: d.quantity },
        create: { userId, productId, quantity: d.quantity },
      });
    }
    res.json(await loadCart(userId));
  }),
);

cartRouter.delete(
  '/:productId',
  asyncHandler(async (req, res) => {
    await prisma.cartItem.deleteMany({ where: { userId: me(req).id, productId: String(req.params.productId) } });
    res.json(await loadCart(me(req).id));
  }),
);

cartRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    await prisma.cartItem.deleteMany({ where: { userId: me(req).id } });
    res.json(await loadCart(me(req).id));
  }),
);
