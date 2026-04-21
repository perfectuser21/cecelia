import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../../');
const SERVER_JS = resolve(REPO_ROOT, 'packages/brain/server.js');

// IANA 时区硬阈值（Reviewer 风险 2 回应）：
// 允许 UTC 或 Area/Location（Asia/Shanghai）或 Area/Region/Location（America/Argentina/Buenos_Aires）
const IANA_TZ_RE = /^(UTC|[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?)$/;

// 懒加载：import 失败在每个 it 内单独报红（TDD Red 阶段实现尚未存在）
let app;
async function getApp() {
  if (app) return app;
  const mod = await import('../../../packages/brain/src/routes/time.js');
  const timeRoutes = mod.default;
  const a = express();
  a.use(express.json());
  a.use('/api/brain/time', timeRoutes);
  app = a;
  return app;
}

describe('Workstream 1 — GET /api/brain/time [BEHAVIOR]', () => {
  it('responds with HTTP 200 and application/json on GET /api/brain/time', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('response body has exactly three keys: iso, timezone, unix', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(Object.keys(res.body).sort()).toEqual(['iso', 'timezone', 'unix']);
  });

  it('iso is an ISO-8601 UTC millisecond string', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('timezone is a valid IANA zone matching UTC or Area/Location(/Sub)', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
    expect(res.body.timezone).toMatch(IANA_TZ_RE);
  });

  it('timezone round-trips through Intl.DateTimeFormat without throwing', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    // IANA validity: Intl.DateTimeFormat 构造时若 timeZone 非法会抛 RangeError
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: res.body.timezone })).not.toThrow();
  });

  it('unix is an integer within 1 second of current wall clock', async () => {
    const a = await getApp();
    const before = Math.floor(Date.now() / 1000);
    const res = await request(a).get('/api/brain/time');
    const after = Math.floor(Date.now() / 1000);
    expect(Number.isInteger(res.body.unix)).toBe(true);
    expect(res.body.unix).toBeGreaterThanOrEqual(before - 1);
    expect(res.body.unix).toBeLessThanOrEqual(after + 1);
  });

  it('iso and unix represent the same moment within 1 second tolerance', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    const isoSeconds = Math.floor(new Date(res.body.iso).getTime() / 1000);
    expect(Number.isNaN(isoSeconds)).toBe(false);
    expect(Math.abs(isoSeconds - res.body.unix)).toBeLessThanOrEqual(1);
  });

  it('two consecutive calls spaced 1.1 seconds return different unix values', async () => {
    const a = await getApp();
    const r1 = await request(a).get('/api/brain/time');
    await new Promise((r) => setTimeout(r, 1100));
    const r2 = await request(a).get('/api/brain/time');
    expect(r2.body.unix).toBeGreaterThan(r1.body.unix);
  });
});

// Reviewer 风险 3 回应：以上 7 个 it 全部挂在私有 express() 上，
// 无法发现 server.js 里笔误 /api/brain/times 或条件分支注册。
// 这里用静态语义检查补漏（避免 import server.js 引入 DB/Tick 副作用）。
describe('Workstream 1 — server.js 挂载点完整性 [BEHAVIOR-STATIC]', () => {
  it('server.js can be read and contains no obvious typo around /api/brain/time', () => {
    const src = readFileSync(SERVER_JS, 'utf8');
    // 字面量 /api/brain/time 后必须紧跟引号（禁止 /api/brain/times 这种笔误）
    // 用负向前瞻确保 time 之后不是字母/数字/下划线
    expect(src).toMatch(/['"]\/api\/brain\/time(?![A-Za-z0-9_])['"]/);
  });

  it('server.js imports timeRoutes default export from ./src/routes/time.js', () => {
    const src = readFileSync(SERVER_JS, 'utf8');
    expect(src).toMatch(/^import\s+timeRoutes\s+from\s+['"]\.\/src\/routes\/time\.js['"];?\s*$/m);
  });

  it('server.js registers app.use with exact path /api/brain/time bound to timeRoutes', () => {
    const src = readFileSync(SERVER_JS, 'utf8');
    expect(src).toMatch(
      /app\.use\(\s*['"]\/api\/brain\/time(?![A-Za-z0-9_])['"]\s*,\s*timeRoutes\s*\)/
    );
  });

  it('app.use(/api/brain/time, ...) line is at top level (not nested in if/try/else block)', () => {
    const src = readFileSync(SERVER_JS, 'utf8');
    const lines = src.split('\n');
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      if (/app\.use\(\s*['"]\/api\/brain\/time(?![A-Za-z0-9_])['"]/.test(lines[i])) {
        hits.push({ idx: i, line: lines[i] });
      }
    }
    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const hit of hits) {
      // 顶层注册行必须零缩进（不在 if/else/try/function/block 内）
      expect(hit.line).toMatch(/^app\.use\(/);
    }
  });
});
