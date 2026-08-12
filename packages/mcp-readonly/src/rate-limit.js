import { createHash } from 'node:crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// 单独导出，方便测试直接断言 hash 格式，而不用反射进 rateLimit 内部实现
export function rateLimitKeyGenerator(req) {
  return req.headers.authorization
    ? createHash('sha256').update(req.headers.authorization).digest('hex')
    : ipKeyGenerator(req.ip);
}

// onRateLimited（可选，Task 14 Bark 告警钩子）：某个请求真的撞到 429 时触发，
// 喂 AlertTracker.recordRateLimited(token) 做"10分钟内同token触发限流超5次"的
// token 疑似泄露检测。跟 keyGenerator 不同，这里传给回调的是原始 token（不是
// hash）——AlertTracker 内部自己会 hash 存储，回调只负责把 token 从请求里
// 抠出来，不重复做安全处理。同样 fire-and-forget，不 await，避免拖慢 429 响应。
function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length) || null;
}

export function createRateLimiter({ windowMs = 60_000, max = 20, onRateLimited } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKeyGenerator,
    handler: (req, res) => {
      const token = extractBearerToken(req);
      if (token && onRateLimited) {
        Promise.resolve(onRateLimited(token)).catch((err) => {
          console.error('[mcp-readonly][rate-limit] onRateLimited 钩子异常:', err.message);
        });
      }
      res.status(429).json({ error: 'rate_limited' });
    },
  });
}
