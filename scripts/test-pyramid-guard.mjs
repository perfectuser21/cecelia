#!/usr/bin/env node
// test-pyramid-guard.mjs — 刀0 测试金字塔机械守卫（PRD: docs/prd/2026-07-14-ops-half-loop.prd.md）
// 四断言：A1 孤儿棘轮 / A2 smoke 挂跑道 / A3 永久池棘轮 / A4 面板活性（仅本地）
// 用法：node scripts/test-pyramid-guard.mjs [--json] [--root <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (e.isFile()) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

export function countOrphans(root) {
  const sprints = path.join(root, 'sprints');
  const archive = path.join(sprints, 'archive') + path.sep;
  const files = walk(sprints).filter((f) => !f.startsWith(archive));
  const tests = files.filter((f) => TEST_RE.test(f)).length;
  const e2e = files.filter((f) => path.basename(f) === 'e2e-verify.sh').length;
  return { tests, e2e, total: tests + e2e };
}

// runner 文件 = .github/workflows/** 全部 + scripts/ 下文件名含 deploy 的脚本
function runnerContents(root) {
  const files = [
    ...walk(path.join(root, '.github', 'workflows')),
    ...walk(path.join(root, 'scripts')).filter(
      (f) => /deploy/.test(path.basename(f)) && !f.includes(`${path.sep}smoke${path.sep}`)
    ),
  ];
  return files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } });
}

function globToRegExp(glob) {
  return new RegExp('^' + glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
}

export function checkSmokeWiring(root, smokeDir) {
  const dir = path.join(root, smokeDir);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.sh')); } catch { /* 无 smoke 目录 */ }
  const contents = runnerContents(root);
  // 收集 runner 里出现的 scripts/smoke/xxx 或 glob token
  const tokens = new Set();
  for (const c of contents) {
    // 左边界锚定：packages/x/scripts/smoke/... 不能被截成根 scripts/smoke token（否则 A2 假绿）
    for (const m of c.matchAll(/(?<![\w./-])scripts\/smoke\/[^\s"'`)\];]+/g)) tokens.add(m[0]);
  }
  const unwired = names.filter((n) => {
    const full = `${smokeDir}/${n}`;
    for (const t of tokens) {
      if (t === full) return false;
      if (t.includes('*') && globToRegExp(t).test(full)) return false;
    }
    return true;
  });
  return { total: names.length, unwired };
}

export function countPermanent(root, roots) {
  const layers = {};
  let total = 0;
  for (const r of roots) {
    const n = walk(path.join(root, r.path)).filter((f) => TEST_RE.test(f)).length;
    layers[r.layer] = (layers[r.layer] || 0) + n;
    total += n;
  }
  return { total, layers };
}

export function checkPanelFreshness(root, maxAgeHours) {
  const file = path.join(root, '.agent-knowledge', 'CURRENT_STATE.md');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { fresh: false, generated: null }; }
  const m = text.match(/generated:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  if (!m) return { fresh: false, generated: null };
  const age = (Date.now() - new Date(m[1].replace(' ', 'T') + '+08:00').getTime()) / 3600e3;
  return { fresh: age >= 0 && age < maxAgeHours, generated: m[1] };
}

export function runGuard(root, baseline, { ci = false, panelRoot } = {}) {
  const failures = [];
  for (const k of ['orphans', 'permanent', 'permanent_roots', 'smoke_dir']) {
    if (baseline?.[k] === undefined) failures.push(`BASELINE: 基线缺字段 ${k}（宁红勿绿）`);
  }
  if (failures.length) return { pass: false, failures };

  const orphans = countOrphans(root);
  if (orphans.total > baseline.orphans) {
    failures.push(`A1 孤儿棘轮: sprints 孤儿测试 ${orphans.total} > 基线 ${baseline.orphans}——新测试必须入册永久池，不准晾在 sprints/`);
  } else if (orphans.total < baseline.orphans) {
    console.error(`ℹ️ A1: 孤儿 ${orphans.total} < 基线 ${baseline.orphans}，请把 scripts/test-pyramid-baseline.json 的 orphans 下调锁住战果`);
  }

  const smoke = checkSmokeWiring(root, baseline.smoke_dir);
  if (smoke.unwired.length) {
    failures.push(`A2 smoke 挂跑道: ${smoke.unwired.join(', ')} 没有任何跑道（workflow/部署脚本）引用`);
  }

  const permanent = countPermanent(root, baseline.permanent_roots);
  if (permanent.total < baseline.permanent) {
    failures.push(`A3 永久池棘轮: 永久测试 ${permanent.total} < 基线 ${baseline.permanent}——删测试/摘 include 必须显式改基线并在 commit message 声明退役理由`);
  }

  let panel = null;
  if (!ci) {
    panel = checkPanelFreshness(panelRoot ?? root, 48);
    if (!panel.fresh) failures.push(`A4 面板活性: CURRENT_STATE.md generated=${panel.generated ?? '缺失'} 超过 48h（僵尸面板复发）`);
  }

  return { pass: failures.length === 0, failures, orphans, smoke, permanent, panel };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : path.resolve(fileURLToPath(import.meta.url), '../..');
  const baselinePath = path.join(root, 'scripts', 'test-pyramid-baseline.json');
  let baseline = null;
  try { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')); } catch { /* runGuard 会红 */ }
  // A4 面板读主仓（worktree 副本必然过期误报）：git-common-dir 推主仓根，非 git 环境回退 root
  let panelRoot = root;
  try {
    const common = execSync('git rev-parse --git-common-dir', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const resolved = path.resolve(root, common);
    if (path.basename(resolved) === '.git') panelRoot = path.dirname(resolved);
  } catch { /* 回退 root */ }
  const result = runGuard(root, baseline, { ci: !!process.env.CI, panelRoot });
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`测试金字塔守卫 @ ${root}`);
    if (result.orphans) console.log(`  孤儿: ${result.orphans.total}（tests ${result.orphans.tests} + e2e ${result.orphans.e2e}）/ 基线 ${baseline?.orphans}`);
    if (result.smoke) console.log(`  smoke: ${result.smoke.total} 条，未挂跑道 ${result.smoke.unwired.length}`);
    if (result.permanent) console.log(`  永久池: ${result.permanent.total} / 基线 ${baseline?.permanent} ｜ 分层 ${JSON.stringify(result.permanent.layers)}`);
    if (result.panel) console.log(`  面板: generated=${result.panel.generated} fresh=${result.panel.fresh}`);
    for (const f of result.failures) console.log(`  ❌ ${f}`);
    console.log(result.pass ? '✅ PASS' : '❌ FAIL');
  }
  process.exit(result.pass ? 0 : 1);
}
