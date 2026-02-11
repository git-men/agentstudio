/**
 * X-Request-ID middleware
 *
 * 透传请求头 X-Request-ID，若无则生成并写入请求与响应，供上游/下游传递。
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

const HEADER = 'x-request-id';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[HEADER] as string | undefined;
  const id = (typeof incoming === 'string' && incoming.trim()) ? incoming.trim() : randomUUID();
  (req as Request & { requestId?: string }).requestId = id;
  res.setHeader(HEADER, id);
  next();
}
