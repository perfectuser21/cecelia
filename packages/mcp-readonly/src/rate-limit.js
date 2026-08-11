import { createHash } from 'node:crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// 单独导出，方便测试直接断言 hash 格式，而不用反射进 rateLimit 内部实现
export function rateLimitKeyGenerator(req) {
  return req.headers.authorization
    ? createHash('sha256').update(req.headers.authorization).digest('hex')
    : ipKeyGenerator(req.ip);
}

export function createRateLimiter({ windowMs = 60_000, max = 20 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKeyGenerator,
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate_limited' });
    },
  });
}
