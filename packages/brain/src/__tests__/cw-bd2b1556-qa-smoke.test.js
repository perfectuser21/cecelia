/**
 * cw-bd2b1556-qa-smoke.sh 自身有效性 [BEHAVIOR]
 *
 * 裁判 J-4：Q-1 的 GET 地址被单引号包住（"$BRAIN_URL" 不展开），且各场景 && 断言串无失败退出，
 * set -e 不终止 → Q-1 断言失败时脚本仍打印 PASS。
 * 这里用假 Brain 跑脚本：行为正确 → PASS 退出 0；被拒请求仍写库 → 必须非零退出且不打印 PASS。
 * 写入守卫换成放行桩（守卫本身另有测试），只验证脚本断言链。
 * 脚本在 QA+裁判通过后由 runner 重新生成（勿手改），这里只断言退出码与 PASS 行，不依赖生成器之外的手加标记。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../scripts/smoke/cw-bd2b1556-qa-smoke.sh', import.meta.url).pathname;
const ALLOWED = ['decision', 'general', 'judgment'];

function fakeBrain({ writeRejected }) {
  const rows = [];
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname !== '/api/brain/strategic-decisions') return send(404, {});
    if (req.method === 'GET') {
      const cat = url.searchParams.get('category');
      return send(200, { success: true, data: rows.filter((r) => !cat || r.category === cat) });
    }
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const b = JSON.parse(raw);
      const category = b.category === undefined || b.category === null || b.category === '' ? 'general' : b.category;
      const row = { id: `id-${rows.length + 1}`, category, topic: b.topic, made_by: b.made_by };
      if (!ALLOWED.includes(category)) {
        if (writeRejected) rows.push(row);
        return send(400, { success: false, error: `category 非法，合法值：${ALLOWED.join('|')}`, allowed_categories: ALLOWED });
      }
      rows.push(row);
      send(201, { success: true, data: row });
    });
  });
}

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-qa-smoke-'));
  mkdirSync(join(dir, 'smoke'));
  mkdirSync(join(dir, 'lib'));
  copyFileSync(SCRIPT, join(dir, 'smoke', 'qa.sh'));
  writeFileSync(join(dir, 'lib', 'smoke-production-guard.mjs'), 'process.exit(0);\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function runAgainst(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await new Promise((resolve) => {
      execFile('bash', [join(dir, 'smoke', 'qa.sh')], { env: { ...process.env, BRAIN_URL: url }, timeout: 60000 },
        (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
    });
  } finally {
    server.close();
  }
}

describe('cw-bd2b1556-qa-smoke.sh', () => {
  it('假 Brain 行为正确 → 全部场景通过，打印 PASS', async () => {
    const r = await runAgainst(fakeBrain({ writeRejected: false }));
    expect(r.stdout).toContain('PASS: cw-bd2b1556-qa-smoke.sh');
    expect(r.code).toBe(0);
  }, 70000);

  it('被拒的非法 category 仍写了库 → Q-1 失败即非零退出，不打印 PASS', async () => {
    const r = await runAgainst(fakeBrain({ writeRejected: true }));
    expect(r.stdout).not.toContain('PASS: cw-bd2b1556-qa-smoke.sh');
    expect(r.code).not.toBe(0);
  }, 70000);
});
