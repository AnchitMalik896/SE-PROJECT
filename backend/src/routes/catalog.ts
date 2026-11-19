import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { guard, me } from '../lib/auth.js';
import { asyncHandler, HttpError, pageParams, parse } from '../lib/http.js';
import { getDeliveryFee } from '../lib/settings.js';

export const catalogRouter = Router();

/** average rating + count for a set of farmers (visible ratings only) */
export async function farmerRatings(farmerIds: string[]) {
  if (!farmerIds.length) return new Map<string, { avg: number; count: number }>();
  const rows = await prisma.rating.groupBy({
    by: ['farmerId'],
    where: { farmerId: { in: farmerIds }, hidden: false },
    _avg: { stars: true },
    _count: { stars: true },
  });
  return new Map(rows.map((r) => [r.farmerId, { avg: Math.round((r._avg.stars ?? 0) * 10) / 10, count: r._count.stars }]));
}

const publicProductInclude = {
  category: true,
  farmer: { select: { id: true, name: true, status: true, farmerProfile: { select: { farmName: true, farmLocation: true, bio: true } } } },
} as const;

type ProductRow = Awaited<ReturnType<typeof prisma.product.findFirstOrThrow<{ include: typeof publicProductInclude }>>>;

export function shapeProduct(p: ProductRow, ratings: Map<string, { avg: number; count: number }>) {
  const r = ratings.get(p.farmerId);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    unit: p.unit,
    stock: p.stock,
    inStock: p.stock > 0,
    photoUrl: p.photoUrl,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    farmer: {
      id: p.farmer.id,
      name: p.farmer.name,
      farmName: p.farmer.farmerProfile?.farmName ?? p.farmer.name,
      farmLocation: p.farmer.farmerProfile?.farmLocation ?? '',
      rating: r?.avg ?? null,
      ratingCount: r?.count ?? 0,
    },
  };
}

// Only products that consumers may actually buy.
const buyable = {
  active: true,
  takenDownReason: null,
  farmer: { status: 'ACTIVE', farmerProfile: { verification: 'APPROVED' } },
} as const;

catalogRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json({ items: await prisma.category.findMany({ orderBy: { name: 'asc' } }) });
  }),
);

catalogRouter.get(
  '/settings/public',
  asyncHandler(async (_req, res) => {
    res.json({ deliveryFee: await getDeliveryFee() });
  }),
);

// US-14: search by name/category/farmer, in-stock only, filter by category and price
catalogRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip, take } = pageParams(req.query, 24);
    const q = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const categoryId = typeof req.query.categoryId === 'string' && req.query.categoryId ? req.query.categoryId : undefined;
    const farmerId = typeof req.query.farmerId === 'string' && req.query.farmerId ? req.query.farmerId : undefined;
    const minPrice = req.query.minPrice !== undefined && req.query.minPrice !== '' ? Number(req.query.minPrice) : undefined;
    const maxPrice = req.query.maxPrice !== undefined && req.query.maxPrice !== '' ? Number(req.query.maxPrice) : undefined;
    const sort = req.query.sort === 'price_asc' ? { price: 'asc' as const } : req.query.sort === 'price_desc' ? { price: 'desc' as const } : { createdAt: 'desc' as const };

    const where = {
      ...buyable,
      stock: { gt: 0 },
      ...(categoryId ? { categoryId } : {}),
      ...(farmerId ? { farmerId } : {}),
      ...(minPrice !== undefined || maxPrice !== undefined
        ? { price: { ...(minPrice !== undefined && !isNaN(minPrice) ? { gte: minPrice } : {}), ...(maxPrice !== undefined && !isNaN(maxPrice) ? { lte: maxPrice } : {}) } }
        : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { description: { contains: q } },
              { category: { name: { contains: q } } },
              { farmer: { name: { contains: q } } },
              { farmer: { farmerProfile: { farmName: { contains: q } } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({ where, include: publicProductInclude, orderBy: sort, skip, take }),
    ]);
    const ratings = await farmerRatings([...new Set(rows.map((r) => r.farmerId))]);
    res.json({ items: rows.map((r) => shapeProduct(r, ratings)), total, page, pageSize });
  }),
);

// US-15
catalogRouter.get(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const p = await prisma.product.findFirst({
      where: { id: String(req.params.id), ...buyable },
      include: publicProductInclude,
    });
    if (!p) throw new HttpError(404, 'This product is not available');
    const ratings = await farmerRatings([p.farmerId]);
    res.json({ product: shapeProduct(p, ratings) });
  }),
);

catalogRouter.get(
  '/products/:id/ratings',
  asyncHandler(async (req, res) => {
    const rows = await prisma.rating.findMany({
      where: { productId: String(req.params.id), hidden: false },
      include: { consumer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({
      items: rows.map((r) => ({ id: r.id, stars: r.stars, comment: r.comment, consumerName: r.consumer.name, createdAt: r.createdAt })),
    });
  }),
);

// ---------- farmer product management (US-07, US-08) ----------
export const farmerProductsRouter = Router();
farmerProductsRouter.use(guard('FARMER'));

const productBody = z.object({
  name: z.string().trim().min(2, 'Enter a product name').max(80),
  description: z.string().trim().max(500).default(''),
  price: z.number().int('Price must be a whole number of paise').min(100, 'Price must be at least ₹1').max(10_000_000),
  unit: z.string().trim().min(1, 'Enter a unit (kg, dozen…)').max(20),
  stock: z.number().int('Stock must be a whole number').min(0, 'Stock cannot be negative').max(100_000),
  photoUrl: z
    .string()
    .trim()
    .url('Enter a valid image URL')
    .refine((u) => /^https?:\/\//i.test(u), 'Image URL must start with http(s)')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  categoryId: z.string().optional().or(z.literal('').transform(() => undefined)),
});

async function ownProduct(farmerId: string, id: string) {
  const p = await prisma.product.findFirst({ where: { id, farmerId, active: true } });
  if (!p) throw new HttpError(404, 'Product not found');
  return p;
}

async function checkCategory(id?: string) {
  if (!id) return;
  const c = await prisma.category.findUnique({ where: { id } });
  if (!c) throw new HttpError(400, 'Unknown category', { categoryId: 'Choose a valid category' });
}

farmerProductsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await prisma.product.findMany({
      where: { farmerId: me(req).id, active: true },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ items });
  }),
);

farmerProductsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const d = parse(productBody, req.body);
    await checkCategory(d.categoryId);
    const p = await prisma.product.create({ data: { ...d, farmerId: me(req).id } });
    res.status(201).json({ product: p });
  }),
);

farmerProductsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await ownProduct(me(req).id, String(req.params.id));
    const d = parse(productBody.partial(), req.body);
    await checkCategory(d.categoryId);
    const p = await prisma.product.update({ where: { id: existing.id }, data: d });
    res.json({ product: p });
  }),
);

farmerProductsRouter.patch(
  '/:id/stock',
  asyncHandler(async (req, res) => {
    const existing = await ownProduct(me(req).id, String(req.params.id));
    const d = parse(z.object({ stock: z.number().int().min(0).max(100_000) }), req.body);
    const p = await prisma.product.update({ where: { id: existing.id }, data: { stock: d.stock } });
    res.json({ product: p });
  }),
);

// soft delete: keeps order history intact, drops it from search and carts
farmerProductsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await ownProduct(me(req).id, String(req.params.id));
    await prisma.$transaction([
      prisma.cartItem.deleteMany({ where: { productId: existing.id } }),
      prisma.product.update({ where: { id: existing.id }, data: { active: false } }),
    ]);
    res.json({ message: 'Product removed' });
  }),
);
