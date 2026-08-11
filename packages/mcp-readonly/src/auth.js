import { timingSafeEqual } from 'node:crypto';

function safeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function bearerAuth(expectedToken) {
  return function (req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const token = header.slice('Bearer '.length);
    if (!token || !safeCompare(token, expectedToken)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };
}
