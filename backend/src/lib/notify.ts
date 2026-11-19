import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

type Db = Prisma.TransactionClient | typeof prisma;

export async function notify(userId: string, type: string, message: string, db: Db = prisma) {
  await db.notification.create({ data: { userId, type, message } });
}

export async function notifyAdmins(type: string, message: string, db: Db = prisma) {
  const admins = await db.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } });
  if (admins.length) {
    await db.notification.createMany({ data: admins.map((a) => ({ userId: a.id, type, message })) });
  }
}

export async function audit(
  actorId: string | null,
  action: string,
  entity?: string,
  detail?: string,
  db: Db = prisma,
) {
  await db.auditLog.create({ data: { actorId, action, entity, detail } });
}

// ---- dev outbox: stands in for email/SMS delivery of reset codes ----
export interface OutboxMessage {
  to: string;
  channel: 'email' | 'sms';
  subject: string;
  body: string;
  at: string;
}
const outbox: OutboxMessage[] = [];
export function sendMessage(m: Omit<OutboxMessage, 'at'>) {
  outbox.unshift({ ...m, at: new Date().toISOString() });
  if (outbox.length > 100) outbox.pop();
  // eslint-disable-next-line no-console
  console.log(`[outbox:${m.channel}] to=${m.to} :: ${m.subject} :: ${m.body}`);
}
export function readOutbox(to?: string) {
  return to ? outbox.filter((m) => m.to === to) : outbox;
}
export function clearOutbox() {
  outbox.length = 0;
}
