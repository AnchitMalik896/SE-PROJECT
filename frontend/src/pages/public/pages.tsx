import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { get, post } from '../../api';
import { homeFor, useAuth } from '../../auth';
import { ProductCard } from '../../components/ProductCard';
import { errMsg, fieldErrs, useLoad } from '../../hooks';
import type { Paged, Product } from '../../types';
import { Banner, Button, Field, Glass, TextArea } from '../../ui';

// ---------------------------------------------------------------- landing
export function Landing() {
  const featured = useLoad(() => get<Paged<Product>>('/products', { pageSize: 4 }), []);
  return (
    <div className="stack" style={{ gap: '1.6rem' }}>
      <section className="glass hero">
        <span className="badge ok" style={{ marginBottom: '1rem' }}>🌱 No middlemen</span>
        <h1>Fresh produce, straight from the farmer to your door</h1>
        <p className="lead">Farmers set their own prices. You see exactly who grew your food, pay securely online, and track every order until it arrives.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn primary" to="/browse">Browse produce</Link>
          <Link className="btn" to="/register?role=farmer">Sell as a farmer</Link>
        </div>
      </section>

      <section className="grid cols-3" aria-label="How it works">
        {[
          ['🧑‍🌾', 'Farmers list produce', 'Verified farmers publish what they grow, with their own prices and live stock.'],
          ['🧺', 'You order directly', 'Add produce from one or more farms and pay securely online.'],
          ['🛵', 'Delivered & confirmed', 'A delivery partner brings it over. Payment reaches the farmer only after you confirm with a one-time code.'],
        ].map(([icon, title, text]) => (
          <Glass key={title as string} hover>
            <div style={{ fontSize: '2rem' }} aria-hidden>{icon}</div>
            <h3>{title}</h3>
            <p className="muted" style={{ margin: 0 }}>{text}</p>
          </Glass>
        ))}
      </section>

      {featured.data && featured.data.items.length > 0 && (
        <section>
          <div className="page-head"><h2 style={{ margin: 0 }}>Fresh right now</h2><Link to="/browse">See all →</Link></div>
          <div className="grid cols-4">
            {featured.data.items.map((p) => <ProductCard key={p.id} product={p} to={`/browse/${p.id}`} />)}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- login
const DEMO = [
  ['Customer', 'asha@farmdirect.test'],
  ['Farmer', 'harpreet@farmdirect.test'],
  ['Delivery', 'dev@farmdirect.test'],
  ['Admin', 'admin@farmdirect.test'],
] as const;

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const user = await login(identifier.trim(), password);
      nav(loc.state?.from && loc.state.from !== '/login' ? loc.state.from : homeFor(user.role), { replace: true });
    } catch (err) {
      setError(errMsg(err));
      setFields(fieldErrs(err));
      setBusy(false); // invalid credentials: stay on the form so the user can retry
    }
  }

  return (
    <div className="auth-wrap">
      <Glass className="auth-card" strong>
        <h1>Welcome back</h1>
        <p className="muted">Log in to your FarmDirect account.</p>
        <form className="stack" onSubmit={submit} noValidate>
          {error && <Banner kind="error">{error}</Banner>}
          <Field label="Email or phone" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} error={fields.identifier} required />
          <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} required />
          <Button variant="primary" block busy={busy} type="submit">Log in</Button>
          <div className="row between small">
            <Link to="/forgot-password">Forgot password?</Link>
            <span>New here? <Link to="/register">Create an account</Link></span>
          </div>
        </form>
        {import.meta.env.DEV && (
          <details style={{ marginTop: '1.2rem' }}>
            <summary className="small muted" style={{ cursor: 'pointer' }}>Demo accounts (dev only)</summary>
            <div className="chips" style={{ marginTop: '0.6rem' }}>
              {DEMO.map(([name, email]) => (
                <button key={email} type="button" className="chip" onClick={() => { setIdentifier(email); setPassword('Demo@1234'); }}>{name}</button>
              ))}
            </div>
          </details>
        )}
      </Glass>
    </div>
  );
}

// ---------------------------------------------------------------- register
export function Register() {
  const [params] = useSearchParams();
  const [role, setRole] = useState<'consumer' | 'farmer'>(params.get('role') === 'farmer' ? 'farmer' : 'consumer');
  const [v, setV] = useState({ name: '', email: '', phone: '', password: '', confirm: '', address: '', farmName: '', farmLocation: '', bio: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (v.password !== v.confirm) return setFields({ confirm: 'Passwords do not match' });
    setFields({});
    setBusy(true);
    try {
      const base = { name: v.name, email: v.email, phone: v.phone, password: v.password };
      const body = role === 'consumer' ? { ...base, address: v.address } : { ...base, farmName: v.farmName, farmLocation: v.farmLocation, bio: v.bio || undefined };
      const r = await post<{ message: string }>(`/auth/register/${role}`, body);
      setDone(r.message);
    } catch (err) {
      setError(errMsg(err));
      setFields(fieldErrs(err));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="auth-wrap">
        <Glass className="auth-card" strong>
          <div style={{ fontSize: '2.4rem' }} aria-hidden>🎉</div>
          <h1>You’re in</h1>
          <Banner kind="ok">{done}</Banner>
          <p className="muted" style={{ marginTop: '1rem' }}>{role === 'farmer' ? 'Log in to start listing your produce.' : 'Log in to start shopping.'}</p>
          <Link className="btn primary" to="/login">Go to log in</Link>
        </Glass>
      </div>
    );

  return (
    <div className="auth-wrap">
      <Glass className="auth-card wide" strong>
        <h1>Create your account</h1>
        <div className="seg" role="group" aria-label="Account type" style={{ margin: '0.5rem 0 1rem' }}>
          <button type="button" aria-pressed={role === 'consumer'} onClick={() => setRole('consumer')}>🛍️ I want to buy</button>
          <button type="button" aria-pressed={role === 'farmer'} onClick={() => setRole('farmer')}>🧑‍🌾 I’m a farmer</button>
        </div>
        <form className="stack" onSubmit={submit} noValidate>
          {error && <Banner kind="error">{error}</Banner>}
          <div className="form-grid">
            <Field label="Full name" autoComplete="name" value={v.name} onChange={set('name')} error={fields.name} required />
            <Field label="Phone" type="tel" autoComplete="tel" value={v.phone} onChange={set('phone')} error={fields.phone} hint="10–15 digits" required />
          </div>
          <Field label="Email" type="email" autoComplete="email" value={v.email} onChange={set('email')} error={fields.email} required />
          {role === 'consumer' ? (
            <TextArea label="Delivery address" value={v.address} onChange={set('address')} error={fields.address} required />
          ) : (
            <>
              <div className="form-grid">
                <Field label="Farm name" value={v.farmName} onChange={set('farmName')} error={fields.farmName} required />
                <Field label="Farm location" value={v.farmLocation} onChange={set('farmLocation')} error={fields.farmLocation} hint="Village / town, district, state" required />
              </div>
              <TextArea label="About your farm (optional)" value={v.bio} onChange={set('bio')} error={fields.bio} />
              <Banner kind="info">Farmer accounts are checked by an administrator before you can list produce.</Banner>
            </>
          )}
          <div className="form-grid">
            <Field label="Password" type="password" autoComplete="new-password" value={v.password} onChange={set('password')} error={fields.password} hint="8+ characters, with a letter and a number" required />
            <Field label="Confirm password" type="password" autoComplete="new-password" value={v.confirm} onChange={set('confirm')} error={fields.confirm} required />
          </div>
          <Button variant="primary" block busy={busy} type="submit">Create account</Button>
          <p className="small muted" style={{ margin: 0 }}>Already registered? <Link to="/login">Log in</Link></p>
        </form>
      </Glass>
    </div>
  );
}

// ---------------------------------------------------------------- password reset
export function ForgotPassword() {
  const nav = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ message: string }>('/auth/forgot', { identifier: identifier.trim() });
      setSent(r.message);
      if (import.meta.env.DEV) {
        // dev only: there is no real email/SMS provider, so read the code from the server's outbox
        const to = identifier.includes('@') ? identifier.trim().toLowerCase() : identifier.replace(/[\s-]/g, '');
        const box = await get<{ items: { body: string }[] }>('/dev/outbox', { to }).catch(() => ({ items: [] }));
        setDevCode(box.items[0]?.body ?? null);
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <Glass className="auth-card" strong>
        <h1>Reset your password</h1>
        <p className="muted">Enter your email or phone and we’ll send you a 6-digit code.</p>
        <form className="stack" onSubmit={submit} noValidate>
          {error && <Banner kind="error">{error}</Banner>}
          {sent && <Banner kind="ok">{sent}</Banner>}
          {devCode && <Banner kind="warn">Dev inbox: {devCode}</Banner>}
          <Field label="Email or phone" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
          <Button variant="primary" block busy={busy} type="submit">{sent ? 'Send a new code' : 'Send code'}</Button>
          {sent && <Button block onClick={() => nav(`/reset-password?identifier=${encodeURIComponent(identifier.trim())}`)} type="button">I have a code</Button>}
          <Link className="small" to="/login">← Back to log in</Link>
        </form>
      </Glass>
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [v, setV] = useState({ identifier: params.get('identifier') ?? '', code: '', newPassword: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await post('/auth/reset', { identifier: v.identifier.trim(), code: v.code.trim(), newPassword: v.newPassword });
      setDone(true);
    } catch (err) {
      setError(errMsg(err));
      setFields(fieldErrs(err));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="auth-wrap">
        <Glass className="auth-card" strong>
          <h1>Password updated</h1>
          <Banner kind="ok">Your old password no longer works. Please log in with the new one.</Banner>
          <p><Link className="btn primary" to="/login">Log in</Link></p>
        </Glass>
      </div>
    );

  return (
    <div className="auth-wrap">
      <Glass className="auth-card" strong>
        <h1>Choose a new password</h1>
        <form className="stack" onSubmit={submit} noValidate>
          {error && <Banner kind="error">{error} {error.includes('expired') && <Link to="/forgot-password">Request a new code</Link>}</Banner>}
          <Field label="Email or phone" value={v.identifier} onChange={set('identifier')} error={fields.identifier} required />
          <Field label="6-digit code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={v.code} onChange={set('code')} error={fields.code} required />
          <Field label="New password" type="password" autoComplete="new-password" value={v.newPassword} onChange={set('newPassword')} error={fields.newPassword} hint="8+ characters, with a letter and a number" required />
          <Button variant="primary" block busy={busy} type="submit">Update password</Button>
          <Link className="small" to="/forgot-password">Need a new code?</Link>
        </form>
      </Glass>
    </div>
  );
}

export function NotFound() {
  return (
    <Glass className="hero">
      <div style={{ fontSize: '3rem' }} aria-hidden>🥀</div>
      <h1>Nothing growing here</h1>
      <p className="lead">The page you’re looking for doesn’t exist.</p>
      <Link className="btn primary" to="/">Back home</Link>
    </Glass>
  );
}
