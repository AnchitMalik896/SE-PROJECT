import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, 'Please fix the highlighted fields', zodFields(result.error));
  }
  return result.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, fields: err.fields });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Please fix the highlighted fields', fields: zodFields(err) });
    return;
  }
  // body-parser errors (malformed JSON etc.)
  const e = err as { status?: number; type?: string };
  if (e?.status && e.status >= 400 && e.status < 500) {
    res.status(e.status).json({ error: 'Bad request' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side' });
}

export function pageParams(query: Record<string, unknown>, defaultSize = 20) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function dateRange(query: Record<string, unknown>) {
  const from = typeof query.from === 'string' && query.from ? new Date(query.from) : undefined;
  let to = typeof query.to === 'string' && query.to ? new Date(query.to) : undefined;
  if (from && isNaN(from.getTime())) throw new HttpError(400, 'Invalid "from" date');
  if (to && isNaN(to.getTime())) throw new HttpError(400, 'Invalid "to" date');
  // make `to` inclusive of the whole day when only a date was given
  if (to && typeof query.to === 'string' && query.to.length <= 10) to = new Date(to.getTime() + 86_400_000 - 1);
  const gte = from;
  const lte = to;
  if (!gte && !lte) return undefined;
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}
