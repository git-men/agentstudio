/**
 * X-Call-Chain middleware
 *
 * Chain order: outermost service first (e.g. nginx->as-mate->as-mate-chat).
 * Each hop appends the current service name; if the header is missing, use only this service name.
 * The resulting chain is set on the response and on req.callChain for outgoing calls.
 */

import { Request, Response, NextFunction } from 'express';

const SERVICE_NAME = 'agentstudio';
const HEADER = 'x-call-chain';

function appendService(chain: string | undefined, name: string): string {
  const base = (typeof chain === 'string' && chain.trim()) ? chain.trim() : '';
  return base ? `${base}->${name}` : name;
}

export function callChainMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[HEADER] as string | undefined;
  const chain = appendService(incoming, SERVICE_NAME);
  (req as Request & { callChain?: string }).callChain = chain;
  res.setHeader(HEADER, chain);
  next();
}
