import rateLimit from 'express-rate-limit';

export function createRateLimiter({ windowMs = 60_000, max = 20 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.headers.authorization || req.ip,
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate_limited' });
    },
  });
}
