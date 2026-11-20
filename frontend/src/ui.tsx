import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { label as pretty } from './format';
import type { Paged } from './types';

export function Glass({ children, className = '', strong, hover, as: Tag = 'div', ...rest }: { children: ReactNode; className?: string; strong?: boolean; hover?: boolean; as?: 'div' | 'section' | 'article' } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`glass card ${strong ? 'strong' : ''} ${hover ? 'hover' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className="glass stat">
      <div className="lbl">{label}</div>
      <div className="num" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="center-fill" role="status" aria-live="polite">
      <div className="spinner" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function Empty({ icon = '🌱', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big" aria-hidden>{icon}</div>
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Async({ loading, error, onRetry, children }: { loading: boolean; error: string | null; onRetry?: () => void; children: ReactNode }) {
  if (loading) return <Spinner />;
  if (error)
    return (
      <div className="banner error" role="alert">
        <div className="row between">
          <span>{error}</span>
          {onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}
        </div>
      </div>
    );
  return <>{children}</>;
}

export function Banner({ kind = 'info', children }: { kind?: 'error' | 'ok' | 'warn' | 'info'; children: ReactNode }) {
  return <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Button({ variant, size, block, busy, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost'; size?: 'sm'; block?: boolean; busy?: boolean }) {
  return (
    <button className={`btn ${variant ?? ''} ${size ?? ''} ${block ? 'block' : ''} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? 'Please wait…' : children}
    </button>
  );
}

interface FieldShell { label: string; error?: string; hint?: string; className?: string }

export function Field({ label, error, hint, className = '', ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={`field ${error ? 'invalid' : ''} ${className}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} {...rest} />
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err" id={`${id}-e`} role="alert">{error}</span>}
    </div>
  );
}

export function TextArea({ label, error, hint, className = '', ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className={`field ${error ? 'invalid' : ''} ${className}`}>
      <label htmlFor={id}>{label}</label>
      <textarea id={id} className="textarea" aria-invalid={!!error} {...rest} />
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err" role="alert">{error}</span>}
    </div>
  );
}

export function Select({ label, error, hint, className = '', children, ...rest }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={`field ${error ? 'invalid' : ''} ${className}`}>
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" aria-invalid={!!error} {...rest}>{children}</select>
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err" role="alert">{error}</span>}
    </div>
  );
}

const TONES: Record<string, 'ok' | 'warn' | 'danger' | 'info' | ''> = {
  PLACED: 'info', ACCEPTED: 'info', PACKED: 'warn', DISPATCHED: 'warn', DELIVERED: 'ok', CANCELLED: 'danger',
  PENDING: 'warn', PAID: 'ok', FAILED: 'danger', REFUNDED: 'info', SUCCESS: 'ok',
  UNASSIGNED: 'warn', ASSIGNED: 'info', PICKED_UP: 'warn', ON_THE_WAY: 'warn',
  ACTIVE: 'ok', REJECTED: 'danger', BLOCKED: 'danger', OPEN: 'warn', RESOLVED: 'ok', APPROVED: 'ok',
};
export function StatusBadge({ status, text }: { status: string; text?: string }) {
  return <span className={`badge ${TONES[status] ?? ''}`}>{text ?? pretty(status)}</span>;
}

export function Stars({ value, count }: { value: number | null; count?: number }) {
  if (value == null) return <span className="small muted">No ratings yet</span>;
  const full = Math.round(value);
  return (
    <span className="small" aria-label={`${value} out of 5 stars`}>
      <span className="stars" aria-hidden>{'★'.repeat(full)}{'☆'.repeat(5 - full)}</span> {value.toFixed(1)}
      {count !== undefined && <span className="muted"> ({count})</span>}
    </span>
  );
}

export function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="row" role="radiogroup" aria-label="Rating" style={{ gap: '0.2rem' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="btn ghost sm" style={{ fontSize: '1.4rem', padding: '0 0.2rem', color: n <= value ? '#e3a008' : 'var(--text-muted)' }} onClick={() => onChange(n)}>
          {n <= value ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        <div className="stack">{children}</div>
        {footer && <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1.2rem' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmText = 'Confirm', danger, reasonLabel, reasonRequired = true, onConfirm, onClose }: { title: string; message?: ReactNode; confirmText?: string; danger?: boolean; reasonLabel?: string; reasonRequired?: boolean; onConfirm: (reason: string) => Promise<void> | void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (reasonLabel && reasonRequired && reason.trim().length < 3) return setErr('Please enter a reason (at least 3 characters)');
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={submit}>{confirmText}</Button></>}>
      {message && <div className="muted">{message}</div>}
      {reasonLabel && <TextArea label={reasonLabel} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
      {err && <Banner kind="error">{err}</Banner>}
    </Modal>
  );
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="chips" role="group">
      {options.map((o) => (
        <button key={o.value} className="chip" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Pagination({ data, onPage }: { data: Pick<Paged<unknown>, 'page' | 'pageSize' | 'total'>; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <Button size="sm" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>← Previous</Button>
      <span className="small muted">Page {data.page} of {pages} · {data.total} total</span>
      <Button size="sm" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)}>Next →</Button>
    </nav>
  );
}

const STEPS = ['PLACED', 'ACCEPTED', 'PACKED', 'DISPATCHED', 'DELIVERED'] as const;
const STEP_LABEL: Record<string, string> = { PLACED: 'Placed', ACCEPTED: 'Accepted', PACKED: 'Packed', DISPATCHED: 'Out for delivery', DELIVERED: 'Delivered' };
export function OrderTimeline({ status }: { status: string }) {
  if (status === 'CANCELLED') return <StatusBadge status="CANCELLED" />;
  const idx = STEPS.indexOf(status as (typeof STEPS)[number]);
  return (
    <div className="timeline" aria-label={`Order status: ${STEP_LABEL[status] ?? status}`}>
      {STEPS.map((s, i) => (
        <span key={s} className="row" style={{ gap: '0.3rem' }}>
          {i > 0 && <span className={`bar ${i <= idx ? 'done' : ''}`} />}
          <span className={`step ${i < idx ? 'done' : i === idx ? 'now' : ''}`}>
            <span className="pt" />{STEP_LABEL[s]}
          </span>
        </span>
      ))}
    </div>
  );
}

interface Toast { id: number; kind: 'ok' | 'error'; text: string }
const ToastCtx = createContext<{ ok: (t: string) => void; error: (t: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const api = useRef({ ok: (t: string) => push('ok', t), error: (t: string) => push('error', t) }).current;
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`glass strong toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}
