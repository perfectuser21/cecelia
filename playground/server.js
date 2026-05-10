import express from 'express';

const app = express();
const PORT = process.env.PLAYGROUND_PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/sum', (req, res) => {
  const { a, b } = req.query;
  if (a === undefined || b === undefined) {
    return res.status(400).json({ error: 'a 和 b 都是必填 query 参数' });
  }
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) {
    return res.status(400).json({ error: 'a 和 b 必须是合法数字' });
  }
  return res.json({ sum: na + nb });
});

const STRICT_NUMBER = /^-?\d+(\.\d+)?$/;

app.get('/multiply', (req, res) => {
  const { a, b } = req.query;
  if (a === undefined || b === undefined) {
    return res.status(400).json({ error: 'a 和 b 都是必填 query 参数' });
  }
  if (typeof a !== 'string' || typeof b !== 'string' || !STRICT_NUMBER.test(a) || !STRICT_NUMBER.test(b)) {
    return res.status(400).json({ error: 'a 和 b 必须匹配 ^-?\\d+(\\.\\d+)?$（禁止科学计数法、Infinity、前导 +、十六进制等）' });
  }
  return res.json({ product: Number(a) * Number(b) });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`playground listening on ${PORT}`));
}

export default app;
