import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { readOutbox } from '../src/lib/notify.js';
import { api, auth, createAdmin, login, PASS, registerConsumer, registerFarmer, tokenFor } from './helpers.js';

describe('Authentication (AT-01 … AT-06)', () => {
  it('AT-01: farmer registers and stays pending until verified', async () => {
    const { res, body } = await registerFarmer();
    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: body.email as string }, include: { farmerProfile: true } });
    expect(user.status).toBe('PENDING');
    expect(user.farmerProfile?.verification).toBe('PENDING');
    // a pending farmer cannot log in yet
    const l = await login(body.email as string);
    expect(l.status).toBe(403);
    expect(l.body.error).toMatch(/verification/i);
  });

  it('stores password as a hash, never plaintext', async () => {
    const { body } = await registerConsumer();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: body.email as string } });
    expect(user.passwordHash).not.toContain(PASS);
    expect(user.passwordHash.startsWith('$2')).toBe(true);
  });

  it('AT-02: duplicate email or phone is rejected with a clear message', async () => {
    const first = await registerConsumer();
    const dupEmail = await registerConsumer({ email: first.body.email });
    expect(dupEmail.res.status).toBe(409);
    expect(dupEmail.res.body.fields.email).toMatch(/already registered/);
    const dupPhone = await registerFarmer({ phone: first.body.phone });
    expect(dupPhone.res.status).toBe(409);
    expect(dupPhone.res.body.fields.phone).toMatch(/already registered/);
  });

  it('validates required fields and weak passwords', async () => {
    const r = await api().post('/api/auth/register/consumer').send({ name: 'A', email: 'nope', phone: '12', password: 'short', address: 'x' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.fields)).toEqual(expect.arrayContaining(['name', 'email', 'phone', 'password', 'address']));
  });

  it('consumer account is active immediately and can log in (AT-03)', async () => {
    const { body } = await registerConsumer();
    const l = await login(body.email as string);
    expect(l.status).toBe(200);
    expect(l.body.token).toBeTruthy();
    expect(l.body.user.role).toBe('CONSUMER');
    // phone login works too
    expect((await login(body.phone as string)).status).toBe(200);
  });

  it('AT-04: invalid credentials show an error and allow retry', async () => {
    const { body } = await registerConsumer();
    const bad = await login(body.email as string, 'WrongPass1');
    expect(bad.status).toBe(401);
    // unknown accounts get the identical message (no account enumeration)
    const unknown = await login('nobody@t.test', 'WrongPass1');
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(bad.body.error);
    expect((await login(body.email as string)).status).toBe(200);
  });

  it('AT-05: logout invalidates the token', async () => {
    const { body } = await registerConsumer();
    const token = await tokenFor(body.email as string);
    expect((await api().get('/api/auth/me').set(auth(token))).status).toBe(200);
    expect((await api().post('/api/auth/logout').set(auth(token))).status).toBe(200);
    expect((await api().get('/api/auth/me').set(auth(token))).status).toBe(401);
  });

  it('rejects requests without a valid token and enforces roles', async () => {
    expect((await api().get('/api/cart')).status).toBe(401);
    const { body } = await registerConsumer();
    const token = await tokenFor(body.email as string);
    expect((await api().get('/api/farmer/products').set(auth(token))).status).toBe(403);
    expect((await api().get('/api/admin/users').set(auth(token))).status).toBe(403);
  });

  it('password reset: code works once, expires, and kills old password + sessions', async () => {
    const { body } = await registerConsumer();
    const email = body.email as string;
    const oldToken = await tokenFor(email);

    const f = await api().post('/api/auth/forgot').send({ identifier: email });
    expect(f.status).toBe(200);
    // same response for an unknown account
    const unknown = await api().post('/api/auth/forgot').send({ identifier: 'ghost@t.test' });
    expect(unknown.body.message).toBe(f.body.message);

    const code = /(\d{6})/.exec(readOutbox(email)[0].body)![1];
    expect((await api().post('/api/auth/reset').send({ identifier: email, code: '000000', newPassword: 'NewPass123' })).status).toBe(400);
    const ok = await api().post('/api/auth/reset').send({ identifier: email, code, newPassword: 'NewPass123' });
    expect(ok.status).toBe(200);

    expect((await login(email, PASS)).status).toBe(401); // old password stops working
    expect((await login(email, 'NewPass123')).status).toBe(200);
    expect((await api().get('/api/auth/me').set(auth(oldToken))).status).toBe(401); // old sessions ended
    // a code cannot be reused
    expect((await api().post('/api/auth/reset').send({ identifier: email, code, newPassword: 'Another123' })).status).toBe(400);
  });

  it('AT-06: expired reset code is rejected and a new one can be requested', async () => {
    const { body } = await registerConsumer();
    const email = body.email as string;
    await api().post('/api/auth/forgot').send({ identifier: email });
    const code = /(\d{6})/.exec(readOutbox(email)[0].body)![1];
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.passwordReset.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await api().post('/api/auth/reset').send({ identifier: email, code, newPassword: 'NewPass123' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/expired/);
    expect((await api().post('/api/auth/forgot').send({ identifier: email })).status).toBe(200);
  });

  it('blocked users are locked out immediately, even with a live session; unblock restores access', async () => {
    const admin = await createAdmin();
    const { body } = await registerConsumer();
    const email = body.email as string;
    const token = await tokenFor(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    const blocked = await api().post(`/api/admin/users/${user.id}/block`).set(auth(admin.token)).send({ reason: 'Fake orders' });
    expect(blocked.status).toBe(200);
    expect((await api().get('/api/auth/me').set(auth(token))).status).toBe(401);
    const l = await login(email);
    expect(l.status).toBe(403);
    expect(l.body.error).toMatch(/Fake orders/);

    expect((await api().post(`/api/admin/users/${user.id}/unblock`).set(auth(admin.token))).status).toBe(200);
    expect((await login(email)).status).toBe(200);
  });

  it('admin can approve a pending farmer, who can then log in; rejection records the reason', async () => {
    const admin = await createAdmin();
    const a = await registerFarmer();
    const b = await registerFarmer();
    const ua = await prisma.user.findUniqueOrThrow({ where: { email: a.body.email as string } });
    const ub = await prisma.user.findUniqueOrThrow({ where: { email: b.body.email as string } });

    const pending = await api().get('/api/admin/farmers/pending').set(auth(admin.token));
    expect(pending.body.items.map((f: { id: string }) => f.id)).toEqual(expect.arrayContaining([ua.id, ub.id]));

    expect((await api().post(`/api/admin/farmers/${ua.id}/approve`).set(auth(admin.token))).status).toBe(200);
    expect((await login(a.body.email as string)).status).toBe(200);

    expect((await api().post(`/api/admin/farmers/${ub.id}/reject`).set(auth(admin.token)).send({ reason: '' })).status).toBe(400);
    expect((await api().post(`/api/admin/farmers/${ub.id}/reject`).set(auth(admin.token)).send({ reason: 'Could not verify farm' })).status).toBe(200);
    const l = await login(b.body.email as string);
    expect(l.status).toBe(403);
    expect(l.body.error).toMatch(/Could not verify farm/);
  });
});
