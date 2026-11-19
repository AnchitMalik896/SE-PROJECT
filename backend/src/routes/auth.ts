import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { authenticate, createSession, me, signToken } from '../lib/auth.js';
import { asyncHandler, HttpError, parse } from '../lib/http.js';
import { audit, notifyAdmins, sendMessage } from '../lib/notify.js';

export const authRouter = Router();

const limiter = (max: number) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit: config.isTest ? 10_000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  });

// ---------- shared field rules ----------
export const nameField = z.string().trim().min(2, 'Enter your full name').max(80);
export const emailField = z.string().trim().toLowerCase().email('Enter a valid email address');
export const phoneField = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\+?\d{10,15}$/, 'Enter a valid phone number (10–15 digits)'));
export const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use at least one letter and one number');

const consumerSchema = z.object({
  name: nameField,
  email: emailField,
  phone: phoneField,
  password,
  address: z.string().trim().min(8, 'Enter your full delivery address').max(300),
});
const farmerSchema = z.object({
  name: nameField,
  email: emailField,
  phone: phoneField,
  password,
  farmName: z.string().trim().min(2, 'Enter your farm name').max(100),
  farmLocation: z.string().trim().min(3, 'Enter your farm location').max(200),
  bio: z.string().trim().max(500).optional(),
});

async function assertUnique(emailVal: string, phoneVal: string) {
  const [byEmail, byPhone] = await Promise.all([
    prisma.user.findUnique({ where: { email: emailVal } }),
    prisma.user.findUnique({ where: { phone: phoneVal } }),
  ]);
  const fields: Record<string, string> = {};
  if (byEmail) fields.email = 'This email is already registered';
  if (byPhone) fields.phone = 'This phone number is already registered';
  if (Object.keys(fields).length) throw new HttpError(409, 'An account with these details already exists', fields);
}

export const publicUser = (u: {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  address: string | null;
}) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, status: u.status, address: u.address });

// ---------- registration ----------
authRouter.post(
  '/register/consumer',
  limiter(30),
  asyncHandler(async (req, res) => {
    const d = parse(consumerSchema, req.body);
    await assertUnique(d.email, d.phone);
    const user = await prisma.user.create({
      data: {
        name: d.name,
        email: d.email,
        phone: d.phone,
        address: d.address,
        role: 'CONSUMER',
        status: 'ACTIVE', // FR-02: active immediately
        passwordHash: await bcrypt.hash(d.password, 10),
      },
    });
    await audit(user.id, 'REGISTER', `user:${user.id}`, 'consumer');
    res.status(201).json({ message: 'Account created. You can log in now.', user: publicUser(user) });
  }),
);

authRouter.post(
  '/register/farmer',
  limiter(30),
  asyncHandler(async (req, res) => {
    const d = parse(farmerSchema, req.body);
    await assertUnique(d.email, d.phone);
    const user = await prisma.user.create({
      data: {
        name: d.name,
        email: d.email,
        phone: d.phone,
        role: 'FARMER',
        status: 'PENDING', // FR-01: pending until an administrator verifies
        passwordHash: await bcrypt.hash(d.password, 10),
        farmerProfile: { create: { farmName: d.farmName, farmLocation: d.farmLocation, bio: d.bio } },
      },
    });
    await audit(user.id, 'REGISTER', `user:${user.id}`, 'farmer (pending verification)');
    await notifyAdmins('VERIFICATION', `New farmer "${d.farmName}" is waiting for verification.`);
    res.status(201).json({
      message: 'Registration received. An administrator will verify your account before you can sell.',
      user: publicUser(user),
    });
  }),
);

// ---------- login / logout ----------
const loginSchema = z.object({ identifier: z.string().trim().min(3, 'Enter your email or phone'), password: z.string().min(1, 'Enter your password') });
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', 10);

function normaliseIdentifier(id: string) {
  return id.includes('@') ? { email: id.toLowerCase() } : { phone: id.replace(/[\s-]/g, '') };
}

authRouter.post(
  '/login',
  limiter(20),
  asyncHandler(async (req, res) => {
    const d = parse(loginSchema, req.body);
    const user = await prisma.user.findFirst({ where: normaliseIdentifier(d.identifier), include: { farmerProfile: true } });
    // always run a hash comparison so response time does not reveal whether the account exists
    const ok = await bcrypt.compare(d.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Invalid email/phone or password');

    if (user.status === 'BLOCKED') throw new HttpError(403, `Your account has been blocked${user.blockReason ? `: ${user.blockReason}` : ''}`);
    if (user.status === 'PENDING') throw new HttpError(403, 'Your farmer account is still waiting for administrator verification');
    if (user.status === 'REJECTED') {
      throw new HttpError(403, `Your farmer registration was not approved${user.farmerProfile?.rejectionReason ? `: ${user.farmerProfile.rejectionReason}` : ''}`);
    }

    const session = await createSession(user.id);
    const token = signToken(user, session.id);
    await audit(user.id, 'LOGIN', `user:${user.id}`, user.role);
    res.json({ token, user: publicUser(user) });
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    const u = me(req);
    await prisma.session.update({ where: { id: u.sessionId }, data: { revokedAt: new Date() } });
    await audit(u.id, 'LOGOUT', `user:${u.id}`);
    res.json({ message: 'Logged out' });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const u = me(req);
    const user = await prisma.user.findUnique({ where: { id: u.id }, include: { farmerProfile: true } });
    if (!user) throw new HttpError(404, 'User not found');
    res.json({ user: { ...publicUser(user), farmerProfile: user.farmerProfile } });
  }),
);

// ---------- password reset (FR-05) ----------
const hashCode = (code: string, userId: string) => crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
const GENERIC_RESET_MESSAGE = 'If an account exists for that email or phone, a reset code has been sent. It expires in 10 minutes.';

authRouter.post(
  '/forgot',
  limiter(10),
  asyncHandler(async (req, res) => {
    const d = parse(z.object({ identifier: z.string().trim().min(3, 'Enter your email or phone') }), req.body);
    const user = await prisma.user.findFirst({ where: normaliseIdentifier(d.identifier) });
    if (user) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      await prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          codeHash: hashCode(code, user.id),
          expiresAt: new Date(Date.now() + config.resetCodeTtlMinutes * 60_000),
        },
      });
      const viaEmail = d.identifier.includes('@');
      sendMessage({
        to: viaEmail ? user.email : user.phone,
        channel: viaEmail ? 'email' : 'sms',
        subject: 'Your password reset code',
        body: `Your reset code is ${code}. It expires in ${config.resetCodeTtlMinutes} minutes.`,
      });
      await audit(user.id, 'PASSWORD_RESET_REQUESTED', `user:${user.id}`);
    }
    // identical response whether or not the account exists
    res.json({ message: GENERIC_RESET_MESSAGE });
  }),
);

authRouter.post(
  '/reset',
  limiter(15),
  asyncHandler(async (req, res) => {
    const d = parse(
      z.object({
        identifier: z.string().trim().min(3, 'Enter your email or phone'),
        code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
        newPassword: password,
      }),
      req.body,
    );
    const fail = () => new HttpError(400, 'That code is invalid or has expired. Request a new one.');
    const user = await prisma.user.findFirst({ where: normaliseIdentifier(d.identifier) });
    if (!user) throw fail();
    const reset = await prisma.passwordReset.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!reset || reset.expiresAt < new Date() || reset.attempts >= 5) throw fail();
    if (reset.codeHash !== hashCode(d.code, user.id)) {
      await prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
      throw fail();
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(d.newPassword, 10) } }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      // the old password must stop working everywhere: end every existing session
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(user.id, 'PASSWORD_RESET', `user:${user.id}`);
    res.json({ message: 'Password updated. Please log in with your new password.' });
  }),
);
