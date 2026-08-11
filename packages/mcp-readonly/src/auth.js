import { timingSafeEqual } from 'node:crypto';

function safeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// onFailure（可选，Task 14 Bark 告警钩子）：token 存在但校验失败时触发，用来喂
// AlertTracker.recordAuthFailure(token) 做"5分钟内同token失败10次"的暴力破解
// 检测。故意不对"完全没带 token"的请求调用它——那种情况没有 token 可分桶
// 计数，跟"暴力破解某个具体 token"是不同的信号。onFailure 可能是异步的
// （AlertTracker 里会 await sendBark），但这里不 await 它、只是 fire-and-forget
// 附加 .catch 兜底：告警钩子本身的延迟或异常绝不能拖慢或搞挂 401 响应，鉴权
// 中间件是安全关键路径。
export function bearerAuth(expectedToken, { onFailure } = {}) {
  return function (req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const token = header.slice('Bearer '.length);
    if (!token || !safeCompare(token, expectedToken)) {
      if (token && onFailure) {
        Promise.resolve(onFailure(token)).catch((err) => {
          console.error('[mcp-readonly][auth] onFailure 钩子异常:', err.message);
        });
      }
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };
}
