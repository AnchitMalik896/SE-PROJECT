# FarmDirect — Farmer–Consumer Direct Platform

A marketplace where farmers sell produce directly to consumers. Four role-based experiences (farmer, consumer, delivery partner, administrator), online payments through a gateway, delivery coordination with OTP proof-of-delivery, and admin oversight.

Built from the SE project report (`docs/`): requirements in [`docs/project_context.md`](docs/project_context.md) and decisions in [`docs/requirements_spec.md`](docs/requirements_spec.md).

```
farm-direct/
├── backend/    Node.js + Express + TypeScript API, Prisma ORM, Vitest tests
├── frontend/   React + TypeScript + Vite UI (glassmorphism design system)
└── docs/       Project context + requirements spec
```

## Quick start

Requires Node 20+ (tested on 22).

```bash
npm run setup      # install deps, create the SQLite DB, load demo data
npm run dev        # API on :4000, UI on http://localhost:5173
```

`npm run dev` starts both servers; the Vite dev server proxies `/api` to the backend.

### Demo accounts (password for all: `Demo@1234`)

| Role | Login |
|---|---|
| Administrator | `admin@farmdirect.test` |
| Farmer (verified) | `harpreet@farmdirect.test`, `meena@farmdirect.test` |
| Farmer (pending verification) | `ravi@farmdirect.test` — approve him from the admin dashboard |
| Customer | `asha@farmdirect.test` |
| Delivery partner | `dev@farmdirect.test`, `sunil@farmdirect.test` |

### Try the full flow (about 3 minutes)
1. Log in as **Asha** → add produce to the cart → check out → on the payment page choose **Pay successfully** (or try *Decline* / *Timeout* / *send the callback twice*).
2. Log in as **Harpreet** → Orders → *Accept order* → *Mark as packed*.
3. Log in as **Dev** → *Available* → *Accept* → *Mark picked up* → share location → *On the way*.
4. Back as **Asha**: open the order, read the 4-digit OTP and share it with the partner. Dev enters it under *Confirm delivery*.
5. Harpreet's **Earnings** now show the payout; Asha can rate the products.
6. As **admin**: verify Ravi, review payments, complaints, logs, analytics.

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | install → `db:push` → `db:seed` |
| `npm run dev` | API + UI with hot reload |
| `npm test` | backend test suite (35 tests, fresh throw-away DB each run) |
| `npm run build` | typecheck backend, typecheck + build frontend |
| `npm run db:push` / `db:seed` | apply schema / load demo data |
| `npm run db:push:pg` | apply the PostgreSQL schema (`prisma/schema.postgres.prisma`) — used on Render |

## Deployment

Backend on **Render** (PostgreSQL) + frontend on **Vercel**: see [`DEPLOYMENT.md`](DEPLOYMENT.md). The frontend reads `VITE_API_URL` (the Render URL) at build time; locally it falls back to the Vite `/api` proxy.

## Configuration

`backend/.env` (copy from `backend/.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `file:./dev.db` (SQLite) by default |
| `JWT_SECRET` | signs session tokens — **required in production** |
| `PAYMENT_WEBHOOK_SECRET` | HMAC secret for payment webhooks — **required in production** |
| `CLIENT_ORIGIN` | allowed CORS origin (default `http://localhost:5173`) |
| `PORT` | API port (default 4000) |
| `ENABLE_MOCK_GATEWAY` | the simulated gateway is on unless `NODE_ENV=production` |

### Database
SQLite by default so it runs with zero setup. The report suggests PostgreSQL + Prisma, and the schema is portable (enum-like fields are validated strings): change `provider` in `backend/prisma/schema.prisma` to `"postgresql"`, set `DATABASE_URL`, run `npm run db:push`.

## How the requirements map to the code

| Requirement | Where |
|---|---|
| FR-01/02 registration (farmer pending, consumer active, duplicate rejection) | `backend/src/routes/auth.ts` |
| FR-03/04 login/logout with revocable sessions | `backend/src/lib/auth.ts` — JWT + server-side session, so logout and blocking take effect immediately |
| FR-05 password reset (expiring code, old password dies, sessions revoked) | `routes/auth.ts` |
| FR-06 marketplace, cart, orders | `routes/catalog.ts`, `cart.ts`, `orders.ts` |
| FR-07 payments, never marking failures as success | `services/payments.ts` (signed, idempotent webhook), `routes/payments.ts` |
| FR-08 delivery (pool, accept/decline, status, location, OTP) | `routes/delivery.ts` |
| FR-09 administration | `routes/admin.ts` |
| FR-10 order state machine | `services/orders.ts` (`TRANSITIONS`) |
| FR-11 stock atomicity, no duplicate orders | `routes/orders.ts` checkout (conditional decrement + idempotency key) |
| FR-12 refunds, FR-13 notifications, FR-14 ratings, FR-15 delivery exceptions, FR-16 audit log | `services/orders.ts`, `lib/notify.ts`, `routes/orders.ts`, `routes/delivery.ts` |

Acceptance tests AT-01 … AT-08 are covered in `backend/tests/`.

## Design decisions (from the requirements spec)

- **Payment gateway is behind an interface** with a mock implementation. The mock plays the gateway's part by sending our own webhook with a valid HMAC signature, so the production code path is exercised. To integrate a real gateway: implement `PaymentProvider.createIntent` and point its webhooks at `POST /api/payments/webhook`.
- **Delivery confirmation uses a customer OTP**; the farmer's payout (produce subtotal, excluding delivery fee) is released only then.
- **Cancellation until the farmer marks the order packed** — full refund, stock restored. An administrator can cancel + refund later (e.g. failed delivery).
- **One order per farmer.** A checkout containing several farms creates one order per farm under a single payment.
- **Unpaid orders expire after 30 minutes** and release their stock.
- **Privacy:** farmers never see the customer's address or phone; delivery partners see addresses only for deliveries assigned to them; live location is visible only to the customer while out for delivery and is cleared after delivery.
- **Password reset codes** are written to a dev outbox (console + `/api/dev/outbox`) because no email/SMS provider is configured. The forgot-password page shows the code in development only.
- Money is stored as integer **paise**.

## Known limitations

- Quantities are whole numbers (use pack sizes such as "500 g pack" for fractional goods).
- No real email/SMS/push providers or payment gateway yet (interfaces and mocks are in place).
- Product photos are image URLs; there is no file upload.
- Live location uses polling (10–15 s), not WebSockets.
- Performance and availability targets are not defined in the report, so none are claimed.

## Security notes

- Passwords are hashed with bcrypt; sessions are server-side revocable; login/reset endpoints are rate-limited; webhooks are HMAC-signed and idempotent; helmet and strict body-size limits are on.
- `npm audit` currently reports advisories in dev tooling (vitest/tinypool, the Prisma CLI) and in `zod`. The only fixes are breaking major upgrades (zod 4, vitest 5, prisma 7), so they were deliberately not forced. Plan the upgrades together before production.
- Before deploying: set `JWT_SECRET` and `PAYMENT_WEBHOOK_SECRET`, run with `NODE_ENV=production` (this disables the mock gateway and dev outbox), serve over HTTPS, and swap in a real payment gateway and email/SMS provider.
