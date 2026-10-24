import type { ErrorRequestHandler } from 'express';
import { logger } from 'firebase-functions';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = '請重新登入') => new HttpError(401, msg);
export const forbidden = (msg = '沒有權限') => new HttpError(403, msg);
export const notFound = (msg = '找不到資料') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  logger.error(err);
  res.status(500).json({ error: '系統錯誤，請稍後再試' });
};
