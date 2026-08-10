#!/usr/bin/env node
/*
 * Final-E2E — 宿主 bridge 凭据只读消费（target_environment=local_api，纯 node，Mac/Linux 可移植）
 *
 * 真实接缝，禁 mock：真起 packages/brain/scripts/cecelia-bridge.js 进程、真发 HTTP POST /llm-call、
 * 真读写文件系统。唯一被替换的是「真实 claude LLM」——用一个忠实复现「claude CLI 会回写
 * CLAUDE_CONFIG_DIR/.credentials.json」行为的 fake-claude 顶替（本单验证的是配置目录隔离，
 * 不是 LLM 产出；真调 claude 需真 token、会烧钱且污染权威凭据——正是本单要根治的）。
 *
 * 核心红线：跑完一次经 bridge 派发的 attempt，权威文件 mtime + sha256 前后完全不变。
 * 若 Generator 未落地隔离（bridge 仍把 CLAUDE_CONFIG_DIR 指向权威目录），fake-claude 会回写
 * 权威 .credentials.json → sha256 变化 → 本脚本 exit 1（真红）。
 *
 * 用法：node bridge-readonly-e2e.cjs [redline|isolation|concurrency|all]
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MODE = process.argv[2] || 'all';
const REPO_ROOT = path.resolve(__dirname, '../../..');
// 权威运行守护进程是 cecelia-bridge.cjs（bridge-keepalive-check.sh + launchd com.cecelia.bridge，port 3457）；
// cecelia-bridge.js 为同源第二实现（type:module 下无法直接 node 启动），须同步同一模式但 E2E 打真实 .cjs。
const BRIDGE_JS = path.join(REPO_ROOT, 'packages/brain/scripts/cecelia-bridge.cjs');
const PORT = parseInt(process.env.E2E_BRIDGE_PORT || '34571', 10);

function sha256(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function post(port, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(bodyObj);
    const req = http.request(
      { host: '127.0.0.1', port, path: '/llm-call', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

async function waitPort(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise((resolve) => {
      const s = require('net').connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
    });
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

async function setup() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-e2e-'));
  const fakeHome = path.join(work, 'home');
  const authDir = path.join(fakeHome, '.claude-account1');
  fs.mkdirSync(authDir, { recursive: true });
  const authFile = path.join(authDir, '.credentials.json');
  fs.writeFileSync(authFile, JSON.stringify({ claudeAiOauth: { accessToken: 'AUTH-ORIGINAL', expiresAt: 9999999999999 } }));
  fs.writeFileSync(path.join(authDir, 'settings.json'), JSON.stringify({ theme: 'dark' }));
  const marker = path.join(work, 'pointed-dirs.log');
  fs.writeFileSync(marker, '');

  // fake-claude：忠实复现 claude CLI「回写 CLAUDE_CONFIG_DIR/.credentials.json」
  const fakeClaude = path.join(work, 'fake-claude.cjs');
  fs.writeFileSync(fakeClaude,
    '#!/usr/bin/env node\n' +
    "'use strict';\n" +
    "const fs = require('fs'); const path = require('path');\n" +
    "const dir = process.env.CLAUDE_CONFIG_DIR || '';\n" +
    "fs.appendFileSync(process.env.E2E_MARKER, dir + '\\n');\n" +
    "if (dir) { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'REFRESHED-' + process.pid, expiresAt: 9999999999999 } })); } catch (e) {} }\n" +
    "setTimeout(() => { process.stdout.write('fake-claude-response-text'); process.exit(0); }, 600);\n");
  fs.chmodSync(fakeClaude, 0o755);

  // bridge 用 spawn(CLAUDE_BIN, args) 直接执行 CLAUDE_BIN，故 CLAUDE_BIN 必须是可执行文件本身
  const bridge = spawn(process.execPath, [BRIDGE_JS], {
    env: { ...process.env, HOME: fakeHome, BRIDGE_PORT: String(PORT), CLAUDE_BIN: fakeClaude, E2E_MARKER: marker },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  bridge.stdout.on('data', (d) => (log += d));
  bridge.stderr.on('data', (d) => (log += d));

  const ready = await waitPort(PORT);
  if (!ready) { try { bridge.kill(); } catch {} fail(`bridge 未在预算内就绪 port=${PORT}\n${log}`); }
  return { work, fakeHome, authDir, authFile, marker, bridge, logRef: () => log };
}

function teardown(ctx) {
  try { ctx.bridge.kill(); } catch {}
  try { fs.rmSync(ctx.work, { recursive: true, force: true }); } catch {}
}

function pointedDirs(marker) {
  return fs.readFileSync(marker, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
}

async function runRedline() {
  const ctx = await setup();
  try {
    const mtimeBefore = fs.statSync(ctx.authFile).mtimeMs;
    const shaBefore = sha256(ctx.authFile);
    const resp = await post(PORT, { prompt: 'hello', model: 'haiku', accountId: 'account1' });
    if (resp.status !== 200) fail(`/llm-call 非 200: ${resp.status} ${resp.body}`);
    await sleep(300);
    const mtimeAfter = fs.statSync(ctx.authFile).mtimeMs;
    const shaAfter = sha256(ctx.authFile);
    if (shaAfter !== shaBefore) fail(`核心红线：权威 .credentials.json sha256 变化 before=${shaBefore} after=${shaAfter}（bridge 仍在回写权威文件）`);
    if (mtimeAfter !== mtimeBefore) fail(`核心红线：权威 .credentials.json mtime 变化 ${mtimeBefore}→${mtimeAfter}`);
    console.log('OK: redline — 权威文件 mtime + sha256 attempt 前后完全不变');
  } finally { teardown(ctx); }
}

async function runIsolation() {
  const ctx = await setup();
  try {
    const resp = await post(PORT, { prompt: 'hello', model: 'haiku', accountId: 'account1' });
    if (resp.status !== 200) fail(`/llm-call 非 200: ${resp.status} ${resp.body}`);
    const dirs = pointedDirs(ctx.marker);
    if (dirs.length < 1) fail('fake-claude 未记录到任何 CLAUDE_CONFIG_DIR（claude 未被真实 spawn？）');
    const pointed = dirs[0];
    if (path.resolve(pointed) === path.resolve(ctx.authDir)) fail(`CLAUDE_CONFIG_DIR 指向权威目录 ${pointed}（未做临时副本隔离）`);
    // 临时副本被创建并已清理（等待预算 5s 轮询）
    let cleaned = false;
    for (let i = 0; i < 25; i++) { if (!fs.existsSync(pointed)) { cleaned = true; break; } await sleep(200); }
    if (!cleaned) fail(`attempt 结束后临时目录未清理: ${pointed}`);
    console.log(`OK: isolation — CLAUDE_CONFIG_DIR 指向临时副本(${pointed}) 非权威目录，且结束后已清理`);
  } finally { teardown(ctx); }
}

async function runConcurrency() {
  const ctx = await setup();
  try {
    const mtimeBefore = fs.statSync(ctx.authFile).mtimeMs;
    const shaBefore = sha256(ctx.authFile);
    const [r1, r2] = await Promise.all([
      post(PORT, { prompt: 'a', model: 'haiku', accountId: 'account1' }),
      post(PORT, { prompt: 'b', model: 'haiku', accountId: 'account1' }),
    ]);
    if (r1.status !== 200 || r2.status !== 200) fail(`并发 /llm-call 非 200: ${r1.status}/${r2.status}`);
    await sleep(300);
    const dirs = pointedDirs(ctx.marker);
    if (dirs.length < 2) fail(`并发应记录 2 个 CLAUDE_CONFIG_DIR，实得 ${dirs.length}: ${dirs.join(',')}`);
    const uniq = [...new Set(dirs.map((d) => path.resolve(d)))];
    if (uniq.length < 2) fail(`并发两 attempt 复用了同一临时目录: ${uniq.join(',')}`);
    for (const d of uniq) if (path.resolve(d) === path.resolve(ctx.authDir)) fail(`并发中出现指向权威目录: ${d}`);
    if (sha256(ctx.authFile) !== shaBefore || fs.statSync(ctx.authFile).mtimeMs !== mtimeBefore) fail('并发后权威文件被写');
    console.log(`OK: concurrency — 两 attempt 临时目录互异(${uniq.length}) 且权威文件仍未被写`);
  } finally { teardown(ctx); }
}

(async () => {
  const map = { redline: runRedline, isolation: runIsolation, concurrency: runConcurrency };
  if (MODE === 'all') { await runRedline(); await runIsolation(); await runConcurrency(); }
  else if (map[MODE]) { await map[MODE](); }
  else fail(`未知 mode: ${MODE}`);
  console.log('✅ bridge readonly E2E 全过');
})().catch((e) => fail(e && e.stack ? e.stack : String(e)));
