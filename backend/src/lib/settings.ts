import { config } from '../config.js';
import { prisma } from '../db.js';

export async function getDeliveryFee(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: 'deliveryFee' } });
  const n = s ? Number(s.value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : config.defaultDeliveryFee;
}

export async function setDeliveryFee(paise: number) {
  await prisma.setting.upsert({
    where: { key: 'deliveryFee' },
    update: { value: String(paise) },
    create: { key: 'deliveryFee', value: String(paise) },
  });
}
