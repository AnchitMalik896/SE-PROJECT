import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

if (isProd && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
if (isProd && !process.env.PAYMENT_WEBHOOK_SECRET) throw new Error('PAYMENT_WEBHOOK_SECRET must be set in production');

export const config = {
  isProd,
  isTest,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret',
  tokenTtlHours: 12,
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-only-webhook-secret',
  // The mock gateway lets the UI simulate success / decline / timeout / duplicate callbacks.
  enableMockGateway: process.env.ENABLE_MOCK_GATEWAY ? process.env.ENABLE_MOCK_GATEWAY === 'true' : !isProd,
  resetCodeTtlMinutes: 10,
  unpaidOrderExpiryMinutes: 30,
  defaultDeliveryFee: 4000, // paise (₹40)
};
