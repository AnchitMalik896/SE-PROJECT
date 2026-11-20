import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, HttpError } from './lib/http.js';
import { accountRouter } from './routes/account.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { cartRouter } from './routes/cart.js';
import { catalogRouter, farmerProductsRouter } from './routes/catalog.js';
import { deliveryRouter } from './routes/delivery.js';
import { farmerMiscRouter, farmerOrdersRouter, ordersRouter } from './routes/orders.js';
import { paymentsRouter, webhookHandler } from './routes/payments.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.clientOrigin, credentials: false }));

  app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '100kb' }), webhookHandler);

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api', catalogRouter); 
  app.use('/api/cart', cartRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/delivery', deliveryRouter);
  app.use('/api/farmer/products', farmerProductsRouter);
  app.use('/api/farmer/orders', farmerOrdersRouter);
  app.use('/api/farmer', farmerMiscRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', accountRouter); 

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use(errorHandler);
  return app;
}
