import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T | null) => void;
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs?: number): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (silent: boolean) => {
    const id = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const r = await fnRef.current();
      if (id === seq.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => void run(false), deps);

  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void run(true);
    }, pollMs);
    return () => clearInterval(t);
  }, [pollMs, run]);

  return { data, error, loading, reload: () => run(true), setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
export const fieldErrs = (e: unknown): Record<string, string> => (e instanceof ApiError ? e.fields : {});
