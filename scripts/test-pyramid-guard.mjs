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

// bash 测试（*.test.sh/*.spec.sh）也算孤儿——刀1 审查发现的棘轮盲区
const SH_TEST_RE = /\.(test|spec)\.sh$/;

export function countOrphans(root) {
  const sprints = path.join(root, 'sprints');
  const archive = path.join(sprints, 'archive') + path.sep;
  const ignoredSprintDirs = getIgnoredSprintDirs(root);
  const files = walk(sprints).filter((f) => {
    if (f.startsWith(archive)) return false;
    return !ignoredSprintDirs.some((dir) => f.startsWith(dir + path.sep));
  });
  const tests = files.filter((f) => TEST_RE.test(f) || SH_TEST_RE.test(f)).length;
  const e2e = files.filter((f) => path.basename(f) === 'e2e-verify.sh').length;
  return { tests, e2e, total: tests + e2e };
}

function getIgnoredSprintDirs(root) {
  if (!process.env.CI || process.env.GITHUB_EVENT_NAME !== 'pull_request') return [];
  try {
    const baseRef = process.env.BASE_REF || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : '');
    if (!baseRef) return [];
    const diff = execSync(`git diff --name-only ${baseRef}...HEAD`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const sprintDirs = diff
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^sprints\/[^/]+\//.test(line))
      .map((line) => path.join(root, line.replace(/^((sprints\/[^/]+)).*$/, '$1')))
      .filter((dir, index, arr) => arr.indexOf(dir) === index);
    if (sprintDirs.length && process.env.TEST_PYRAMID_GUARD_DEBUG === '1') {
      console.error(`ℹ️ A1(PR): 忽略本 PR 变更中的 sprint 目录: ${sprintDirs.map((dir) => path.basename(dir)).join(', ')}`);
    }
    return sprintDirs;
  } catch {
    return [];
  }
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
  try {
    names = walk(dir)
      .filter((f) => f.endsWith('.sh'))
      .map((f) => path.relative(dir, f));
  } catch { /* 无 smoke 目录 */ }
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

export function runGuard(root, baseline, { ci = false, panelRoot, bareFrCount = null } = {}) {
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

  // A5 裸奔 FR 棘轮：guard_ref IS NULL AND status=live 的 FR 数只许降
  // bareFrCount 由调用方注入（main 从 Brain API 取，测试直接传）；null 表示 Brain 不可用则跳过
  let bareFr = null;
  if (bareFrCount !== null && typeof baseline.bare_fr === 'number') {
    bareFr = { count: bareFrCount, baseline: baseline.bare_fr };
    if (bareFrCount > baseline.bare_fr) {
      failures.push(`A5 裸奔 FR 棘轮: 无守卫 live FR ${bareFrCount} > 基线 ${baseline.bare_fr}——新增 live FR 必须填 guard_ref，或降级为 planned`);
    } else if (bareFrCount < baseline.bare_fr) {
      console.error(`ℹ️ A5: 裸奔 FR ${bareFrCount} < 基线 ${baseline.bare_fr}，请把 scripts/test-pyramid-baseline.json 的 bare_fr 下调锁住战果`);
    }
  }

  return { pass: failures.length === 0, failures, orphans, smoke, permanent, panel, bare_fr: bareFr };
}

async function fetchBareFrCount(brainUrl = 'http://localhost:5221') {
  try {
    const { default: http } = await import('node:http');
    return await new Promise((resolve) => {
      const req = http.get(`${brainUrl}/api/brain/journey_features/unguarded-count`, { timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          try { resolve(JSON.parse(body).count ?? null); } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  } catch {
    return null;
  }
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
  // A5 尝试从 Brain API 取裸奔 FR 数（Brain 不可达则跳过 A5）
  const bareFrCount = await fetchBareFrCount();
  if (bareFrCount === null) console.error('ℹ️ A5: Brain 不可达，跳过裸奔 FR 棘轮');
  const result = runGuard(root, baseline, { ci: !!process.env.CI, panelRoot, bareFrCount });
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`测试金字塔守卫 @ ${root}`);
    if (result.orphans) console.log(`  孤儿: ${result.orphans.total}（tests ${result.orphans.tests} + e2e ${result.orphans.e2e}）/ 基线 ${baseline?.orphans}`);
    if (result.smoke) console.log(`  smoke: ${result.smoke.total} 条，未挂跑道 ${result.smoke.unwired.length}`);
    if (result.permanent) console.log(`  永久池: ${result.permanent.total} / 基线 ${baseline?.permanent} ｜ 分层 ${JSON.stringify(result.permanent.layers)}`);
    if (result.panel) console.log(`  面板: generated=${result.panel.generated} fresh=${result.panel.fresh}`);
    if (result.bare_fr) console.log(`  裸奔 FR: ${result.bare_fr.count} / 基线 ${result.bare_fr.baseline}`);
    for (const f of result.failures) console.log(`  ❌ ${f}`);
    console.log(result.pass ? '✅ PASS' : '❌ FAIL');
  }
  process.exit(result.pass ? 0 : 1);
}
