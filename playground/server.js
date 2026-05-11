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

app.get('/divide', (req, res) => {
  const { a, b } = req.query;
  if (a === undefined || b === undefined) {
    return res.status(400).json({ error: 'a 和 b 都是必填 query 参数' });
  }
  if (typeof a !== 'string' || typeof b !== 'string' || !STRICT_NUMBER.test(a) || !STRICT_NUMBER.test(b)) {
    return res.status(400).json({ error: 'a 和 b 必须匹配 ^-?\\d+(\\.\\d+)?$（禁止科学计数法、Infinity、前导 +、十六进制等）' });
  }
  if (Number(b) === 0) {
    return res.status(400).json({ error: '除数 b 不能为 0' });
  }
  return res.json({ quotient: Number(a) / Number(b) });
});

app.get('/power', (req, res) => {
  const { a, b } = req.query;
  if (a === undefined || b === undefined) {
    return res.status(400).json({ error: 'a 和 b 都是必填 query 参数' });
  }
  if (typeof a !== 'string' || typeof b !== 'string' || !STRICT_NUMBER.test(a) || !STRICT_NUMBER.test(b)) {
    return res.status(400).json({ error: 'a 和 b 必须匹配 ^-?\\d+(\\.\\d+)?$（禁止科学计数法、Infinity、前导 +、十六进制等）' });
  }
  if (Number(a) === 0 && Number(b) === 0) {
    return res.status(400).json({ error: '0^0 是数学不定式，拒绝计算' });
  }
  const result = Number(a) ** Number(b);
  if (Number.isFinite(result) === false) {
    return res.status(400).json({ error: '计算结果非有限数（NaN / Infinity / -Infinity），拒绝返回' });
  }
  return res.json({ power: result });
});

app.get('/modulo', (req, res) => {
  const { a, b } = req.query;
  if (a === undefined || b === undefined) {
    return res.status(400).json({ error: 'a 和 b 都是必填 query 参数' });
  }
  if (typeof a !== 'string' || typeof b !== 'string' || !STRICT_NUMBER.test(a) || !STRICT_NUMBER.test(b)) {
    return res.status(400).json({ error: 'a 和 b 必须匹配 ^-?\\d+(\\.\\d+)?$（禁止科学计数法、Infinity、前导 +、十六进制等）' });
  }
  if (Number(b) === 0) {
    return res.status(400).json({ error: '除数 b 不能为 0' });
  }
  return res.json({ remainder: Number(a) % Number(b) });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`playground listening on ${PORT}`));
}

export default app;
