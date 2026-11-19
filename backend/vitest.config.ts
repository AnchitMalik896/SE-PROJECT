import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./test.db',
      JWT_SECRET: 'test-secret',
      PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret',
    },
    fileParallelism: false, // one shared SQLite test DB
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
