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

app.get('/increment', (req, res) => {
  // 成功 schema 字面: { result: <number>, operation: "increment" }；strict ^-?\d+$；上界 |value| ≤ 9007199254740990；query 名 req.query.value
  const STRICT_INT = /^-?\d+$/;
  const keys = Object.keys(req.query);
  const v = req.query.value;
  const n = Number(v);
  if (keys.length !== 1 || keys[0] !== 'value' || typeof v !== 'string' || !STRICT_INT.test(v) || Math.abs(n) > 9007199254740990) {
    return res.status(400).json({ error: 'value 必须是唯一 query 名 + 匹配 ^-?\\d+$（仅整数；禁小数、前导 +、双重负号、科学计数法、十六进制、千分位、空格、Infinity、NaN、空串）+ |value| ≤ 9007199254740990' });
  }
  return res.json({ result: n + 1, operation: 'increment' });
});

app.get('/decrement', (req, res) => {
  // 成功 schema 字面: { result: <number>, operation: "decrement" }；strict ^-?\d+$；上界 |value| ≤ 9007199254740990；query 名 req.query.value
  const STRICT_INT = /^-?\d+$/;
  const keys = Object.keys(req.query);
  const v = req.query.value;
  const n = Number(v);
  if (keys.length !== 1 || keys[0] !== 'value' || typeof v !== 'string' || !STRICT_INT.test(v) || Math.abs(n) > 9007199254740990) {
    return res.status(400).json({ error: 'value 必须是唯一 query 名 + 匹配 ^-?\\d+$（仅整数；禁小数、前导 +、双重负号、科学计数法、十六进制、千分位、空格、Infinity、NaN、空串）+ |value| ≤ 9007199254740990' });
  }
  return res.json({ result: n - 1, operation: 'decrement' });
});

app.get('/abs', (req, res) => {
  // 成功 schema 字面: { result: <number>, operation: "abs" }；strict ^-?\d+$；上界 |value| ≤ 9007199254740990；query 名 req.query.value
  const STRICT_INT = /^-?\d+$/;
  const keys = Object.keys(req.query);
  const v = req.query.value;
  const n = Number(v);
  if (keys.length !== 1 || keys[0] !== 'value' || typeof v !== 'string' || !STRICT_INT.test(v) || Math.abs(n) > 9007199254740990) {
    return res.status(400).json({ error: 'value 必须是唯一 query 名 + 匹配 ^-?\\d+$（仅整数；禁小数、前导 +、双重负号、科学计数法、十六进制、千分位、空格、Infinity、NaN、空串）+ |value| ≤ 9007199254740990' });
  }
  return res.json({ result: Math.abs(n), operation: 'abs' });
});

app.get('/factorial', (req, res) => {
  const { n } = req.query;
  if (n === undefined) {
    return res.status(400).json({ error: 'n 是必填 query 参数（仅 n，整数 0 ≤ n ≤ 18）' });
  }
  if (typeof n !== 'string' || !/^\d+$/.test(n)) {
    return res.status(400).json({ error: 'n 必须匹配 ^\\d+$（仅非负整数；禁负号、小数、前导 +、科学计数法、十六进制、千分位、Infinity、NaN）' });
  }
  if (Number(n) > 18) {
    return res.status(400).json({ error: 'n 必须 ≤ 18（精度上界，避免超过 Number.MAX_SAFE_INTEGER）' });
  }
  let acc = 1;
  for (let i = 2; i <= Number(n); i++) acc *= i;
  return res.json({ factorial: acc });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`playground listening on ${PORT}`));
}

export default app;
