import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

export const app = createApp();
export const api = () => request(app);

let n = 0;
export const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;
const phoneSeq = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

export const PASS = 'Passw0rd!';

export async function registerConsumer(over: Record<string, unknown> = {}) {
  const email = `c_${uniq()}@t.test`;
  const body = { name: 'Test Consumer', email, phone: phoneSeq(), password: PASS, address: '12 Test Street, Patiala', ...over };
  const res = await api().post('/api/auth/register/consumer').send(body);
  return { res, body };
}

export async function registerFarmer(over: Record<string, unknown> = {}) {
  const email = `f_${uniq()}@t.test`;
  const body = { name: 'Test Farmer', email, phone: phoneSeq(), password: PASS, farmName: 'Test Farm', farmLocation: 'Farm Road, Patiala', ...over };
  const res = await api().post('/api/auth/register/farmer').send(body);
  return { res, body };
}

export async function login(identifier: string, password = PASS) {
  return api().post('/api/auth/login').send({ identifier, password });
}

export async function tokenFor(identifier: string, password = PASS) {
  const r = await login(identifier, password);
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}
export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

export async function createAdmin() {
  const email = `a_${uniq()}@t.test`;
  await prisma.user.create({ data: { name: 'Admin', email, phone: phoneSeq(), role: 'ADMIN', status: 'ACTIVE', passwordHash: await bcrypt.hash(PASS, 4) } });
  return { email, token: await tokenFor(email) };
}

export async function createCourier() {
  const email = `d_${uniq()}@t.test`;
  await prisma.user.create({ data: { name: 'Courier', email, phone: phoneSeq(), role: 'DELIVERY', status: 'ACTIVE', passwordHash: await bcrypt.hash(PASS, 4) } });
  return { email, token: await tokenFor(email) };
}

/** a farmer with a login token (signup is active immediately) */
export async function createApprovedFarmer() {
  const { body } = await registerFarmer();
  const user = await prisma.user.findUniqueOrThrow({ where: { email: body.email as string } });
  return { id: user.id, email: body.email as string, token: await tokenFor(body.email as string) };
}

export async function createConsumer() {
  const { body } = await registerConsumer();
  const user = await prisma.user.findUniqueOrThrow({ where: { email: body.email as string } });
  return { id: user.id, email: body.email as string, token: await tokenFor(body.email as string) };
}

export async function createProduct(farmerToken: string, over: Record<string, unknown> = {}) {
  const r = await api()
    .post('/api/farmer/products')
    .set(auth(farmerToken))
    .send({ name: 'Tomatoes', description: 'Fresh', price: 4000, unit: 'kg', stock: 10, ...over });
  if (r.status !== 201) throw new Error(`product failed: ${JSON.stringify(r.body)}`);
  return r.body.product as { id: string; stock: number };
}

/** add to cart + checkout; returns the group id and the single order */
export async function placeOrder(consumerToken: string, productId: string, quantity = 1, extra: Record<string, unknown> = {}) {
  const add = await api().post('/api/cart').set(auth(consumerToken)).send({ productId, quantity });
  if (add.status !== 201) throw new Error(`cart failed: ${JSON.stringify(add.body)}`);
  const res = await api().post('/api/orders/checkout').set(auth(consumerToken)).send(extra);
  return res;
}

export async function payOrder(consumerToken: string, groupId: string, outcome: 'SUCCESS' | 'DECLINED' | 'TIMEOUT' = 'SUCCESS', duplicate = false) {
  return api().post(`/api/payments/${groupId}/mock-complete`).set(auth(consumerToken)).send({ outcome, duplicate });
}
