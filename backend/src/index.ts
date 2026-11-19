import { createApp } from './app.js';
import { config } from './config.js';
import { expireUnpaidOrders } from './services/orders.js';

const app = createApp();
app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});

// release stock held by orders that were never paid
setInterval(() => {
  expireUnpaidOrders().then((n) => n && console.log(`Expired ${n} unpaid order(s)`)).catch((e) => console.error('expiry job failed', e));
}, 60_000).unref();
