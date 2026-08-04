# 刀0 test-pyramid-guard 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 机械守卫脚本断言测试金字塔健康（孤儿棘轮/smoke挂跑道/永久池棘轮/面板活性），接入每 PR CI + nightly，并复活 CURRENT_STATE.md 僵尸面板。

**Architecture:** 纯 Node 无依赖脚本 `scripts/test-pyramid-guard.mjs`（可 import 的纯函数 + CLI），基线账本 `scripts/test-pyramid-baseline.json`，bash fixture 自测与真跑同 CI job（每次 PR proven-to-fire）。

**Tech Stack:** Node 20 ESM、bash 测试 harness（仿 `.github/workflows/scripts/__tests__/` 先例）、vitest（tests/ 根，纯函数单测）。

**关键事实（实现前必须知道）：**
- 孤儿实测：41 个 `*.test.*/*.spec.*` + 5 个 `e2e-verify.sh`（`sprints/**` 排除 `sprints/archive`）= 46
- 永久池实测：brain src/__tests__ 963 + brain/tests 4 + tests 57 + engine/tests 64 + quality 35 = 1123
- smoke 池两条脚本都由 ci.yml `dashboard-staging-gate-smoke` job 的 glob `scripts/smoke/*-smoke.sh` 跑——A2 判据必须支持 glob 匹配，不能只查按名引用
- 状态更新脚本（已退役）的 bash 测试存在但无 CI 调用（也是孤儿），本 PR 一并接入
- 实现时用 `node scripts/test-pyramid-guard.mjs` 真跑重新校准基线数字（可能与上面实测有漂移）

---

### Task 1: guard 纯函数 + vitest 单测（TDD commit 1+2）

**Files:**
- Create: `scripts/test-pyramid-guard.mjs`
- Create: `scripts/test-pyramid-baseline.json`
- Test: `tests/test-pyramid-guard.test.ts`

- [ ] **Step 1: 写 failing test**

`tests/test-pyramid-guard.test.ts`：

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  countOrphans, checkSmokeWiring, countPermanent, checkPanelFreshness, runGuard,
} from '../scripts/test-pyramid-guard.mjs';

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'pyramid-'));
  // 孤儿：2 个测试 + 1 个 e2e；archive 里 1 个不算
  mkdirSync(path.join(root, 'sprints/s1/tests'), { recursive: true });
  writeFileSync(path.join(root, 'sprints/s1/tests/a.test.ts'), '');
  writeFileSync(path.join(root, 'sprints/s1/tests/b.spec.js'), '');
  writeFileSync(path.join(root, 'sprints/s1/e2e-verify.sh'), '');
  mkdirSync(path.join(root, 'sprints/archive/old'), { recursive: true });
  writeFileSync(path.join(root, 'sprints/archive/old/c.test.ts'), '');
  // smoke：wired-smoke.sh 被 glob 跑；naked.sh 无人引用
  mkdirSync(path.join(root, 'scripts/smoke'), { recursive: true });
  writeFileSync(path.join(root, 'scripts/smoke/wired-smoke.sh'), '');
  writeFileSync(path.join(root, 'scripts/smoke/naked.sh'), '');
  mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  writeFileSync(path.join(root, '.github/workflows/ci.yml'),
    'run: |\n  for s in scripts/smoke/*-smoke.sh; do bash "$s"; done\n');
  // 永久池：unit 根 2 个文件
  mkdirSync(path.join(root, 'perm/unit'), { recursive: true });
  writeFileSync(path.join(root, 'perm/unit/x.test.js'), '');
  writeFileSync(path.join(root, 'perm/unit/y.spec.ts'), '');
  // 面板：新鲜的 CURRENT_STATE
  mkdirSync(path.join(root, '.agent-knowledge'), { recursive: true });
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  writeFileSync(path.join(root, '.agent-knowledge/CURRENT_STATE.md'),
    `---\ngenerated: ${now} CST\nsource: state-writer (retired)\n---\n`);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('countOrphans', () => {
  it('数 sprints 下测试+e2e，排除 archive', () => {
    expect(countOrphans(root)).toEqual({ tests: 2, e2e: 1, total: 3 });
  });
  it('sprints 不存在 → 0', () => {
    expect(countOrphans('/nonexistent-root')).toEqual({ tests: 0, e2e: 0, total: 0 });
  });
});

describe('checkSmokeWiring', () => {
  it('glob 引用算 wired，无引用算 unwired', () => {
    const r = checkSmokeWiring(root, 'scripts/smoke');
    expect(r.total).toBe(2);
    expect(r.unwired).toEqual(['naked.sh']);
  });
});

describe('countPermanent', () => {
  it('按 roots 数测试文件并按 layer 聚合', () => {
    const r = countPermanent(root, [{ path: 'perm/unit', layer: 'unit' }]);
    expect(r.total).toBe(2);
    expect(r.layers.unit).toBe(2);
  });
});

describe('checkPanelFreshness', () => {
  it('48h 内 → fresh', () => {
    expect(checkPanelFreshness(root, 48).fresh).toBe(true);
  });
  it('文件缺失 → not fresh', () => {
    expect(checkPanelFreshness('/nonexistent-root', 48).fresh).toBe(false);
  });
});

describe('runGuard', () => {
  it('基线匹配 → pass；孤儿超基线 → fail 且指出 A1', () => {
    const baseline = {
      orphans: 3, permanent: 2,
      permanent_roots: [{ path: 'perm/unit', layer: 'unit' }],
      smoke_dir: 'scripts/smoke',
    };
    writeFileSync(path.join(root, 'scripts/smoke/naked.sh.wired-marker'), '');
    // naked.sh 仍 unwired → A2 fail
    const r1 = runGuard(root, baseline, { ci: true });
    expect(r1.pass).toBe(false);
    expect(r1.failures.some((f: string) => f.startsWith('A2'))).toBe(true);
    // 移除 naked.sh 后全绿
    rmSync(path.join(root, 'scripts/smoke/naked.sh'));
    const r2 = runGuard(root, baseline, { ci: true });
    expect(r2.pass).toBe(true);
    // 孤儿基线调低 → A1 fail
    const r3 = runGuard(root, { ...baseline, orphans: 1 }, { ci: true });
    expect(r3.pass).toBe(false);
    expect(r3.failures.some((f: string) => f.startsWith('A1'))).toBe(true);
    // 永久池基线调高（模拟有人删测试）→ A3 fail
    const r4 = runGuard(root, { ...baseline, orphans: 1, permanent: 99 }, { ci: true });
    expect(r4.failures.some((f: string) => f.startsWith('A3'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/test-pyramid-guard.test.ts --config packages/brain/vitest.config.js`
（root tests/*.test.ts 由 brain vitest include `../../tests/*` 覆盖；若路径解析不顺，改用 `cd packages/brain && npx vitest run ../../tests/test-pyramid-guard.test.ts`）
Expected: FAIL — Cannot find module '../scripts/test-pyramid-guard.mjs'

- [ ] **Step 3: commit failing test**

```bash
git add tests/test-pyramid-guard.test.ts
git commit -m "test(quality): 刀0 test-pyramid-guard failing test（TDD commit-1）" --no-verify
```

- [ ] **Step 4: 实现 guard**

`scripts/test-pyramid-guard.mjs`：

```js
#!/usr/bin/env node
// test-pyramid-guard.mjs — 刀0 测试金字塔机械守卫（PRD: docs/prd/2026-07-14-ops-half-loop.prd.md）
// 四断言：A1 孤儿棘轮 / A2 smoke 挂跑道 / A3 永久池棘轮 / A4 面板活性（仅本地）
// 用法：node scripts/test-pyramid-guard.mjs [--json] [--root <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    for (const m of c.matchAll(/scripts\/smoke\/[^\s"'`)\];]+/g)) tokens.add(m[0]);
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

export function runGuard(root, baseline, { ci = false } = {}) {
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
    panel = checkPanelFreshness(root, 48);
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
  const result = runGuard(root, baseline, { ci: !!process.env.CI });
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
```

`scripts/test-pyramid-baseline.json`（数字以实现时真跑校准为准）：

```json
{
  "orphans": 46,
  "permanent": 1123,
  "permanent_roots": [
    { "path": "packages/brain/src/__tests__", "layer": "unit" },
    { "path": "packages/brain/tests", "layer": "integration" },
    { "path": "tests", "layer": "integration" },
    { "path": "packages/engine/tests", "layer": "unit" },
    { "path": "packages/quality", "layer": "integration" }
  ],
  "smoke_dir": "scripts/smoke"
}
```

⚠️ 本 PR 自己往 `tests/` 加了 1 个测试文件 → permanent 基线 = 实测值+1 后再真跑核对。

- [ ] **Step 5: 跑测试确认 green + 真仓 guard 绿**

Run: `npx vitest run tests/test-pyramid-guard.test.ts --config packages/brain/vitest.config.js`
Expected: PASS 全部
Run: `node scripts/test-pyramid-guard.mjs`
Expected: 退出码 0（若 A1/A3 数字不符 → 用真跑输出校准 baseline JSON 后重跑）
注意本地跑会带 A4——CURRENT_STATE 目前是 05-22 僵尸，A4 必红。这一步先 `CI=true node scripts/test-pyramid-guard.mjs` 验 A1-A3；A4 留到 Task 3 面板复活后本地全绿。

- [ ] **Step 6: commit 实现**

```bash
git add scripts/test-pyramid-guard.mjs scripts/test-pyramid-baseline.json
git commit -m "feat(quality): 刀0 test-pyramid-guard 四断言实现（TDD commit-2）" --no-verify
```

---

### Task 2: bash 自测 harness（CI 内 proven-to-fire）

**Files:**
- Create: `scripts/__tests__/test-pyramid-guard.test.sh`

- [ ] **Step 1: 写 bash 自测**

```bash
#!/usr/bin/env bash
# test-pyramid-guard.test.sh — guard 的 proven-to-fire 自测：
# 在 tmp fixture 仓里逐个制造 A1/A2/A3 红况，断言 guard 真报红；干净 fixture 报绿。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$REPO_ROOT/scripts/test-pyramid-guard.mjs"
FIX="$(mktemp -d)"
trap 'rm -rf "$FIX"' EXIT
PASS=0; FAIL=0
check() { # $1=期望退出码 $2=描述
  local expect="$1" desc="$2" actual=0
  CI=true node "$GUARD" --root "$FIX" >/dev/null 2>&1 || actual=$?
  if [ "$actual" -eq "$expect" ] || { [ "$expect" -ne 0 ] && [ "$actual" -ne 0 ]; }; then
    echo "✅ $desc"; PASS=$((PASS+1))
  else
    echo "❌ $desc（期望 exit=$expect 实际 exit=$actual）"; FAIL=$((FAIL+1))
  fi
}

# ── 干净 fixture ──
mkdir -p "$FIX/scripts/smoke" "$FIX/.github/workflows" "$FIX/perm"
touch "$FIX/perm/a.test.js"
cat > "$FIX/scripts/test-pyramid-baseline.json" <<'EOF'
{"orphans":0,"permanent":1,"permanent_roots":[{"path":"perm","layer":"unit"}],"smoke_dir":"scripts/smoke"}
EOF
check 0 "干净 fixture → 绿"

# ── A1: 制造孤儿超基线 ──
mkdir -p "$FIX/sprints/s1"; touch "$FIX/sprints/s1/x.test.ts"
check 1 "A1 孤儿超基线 → 红"
rm -rf "$FIX/sprints"

# ── A2: 制造无跑道 smoke ──
touch "$FIX/scripts/smoke/naked.sh"
check 1 "A2 smoke 无跑道 → 红"
echo 'run: bash scripts/smoke/naked.sh' > "$FIX/.github/workflows/w.yml"
check 0 "A2 按名挂跑道 → 绿"
rm "$FIX/.github/workflows/w.yml"
echo 'for s in scripts/smoke/*.sh; do bash "$s"; done' > "$FIX/.github/workflows/w.yml"
check 0 "A2 glob 挂跑道 → 绿"
rm "$FIX/scripts/smoke/naked.sh" "$FIX/.github/workflows/w.yml"

# ── A3: 删永久测试 ──
rm "$FIX/perm/a.test.js"
check 1 "A3 永久池跌破基线 → 红"
touch "$FIX/perm/a.test.js"

# ── 基线缺失 ──
rm "$FIX/scripts/test-pyramid-baseline.json"
check 1 "基线缺失 → 红（宁红勿绿）"

echo "── 自测结果: $PASS 通过 / $FAIL 失败 ──"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: 跑自测确认全绿**

Run: `bash scripts/__tests__/test-pyramid-guard.test.sh`
Expected: 7 个 ✅，退出码 0

- [ ] **Step 3: commit**

```bash
git add scripts/__tests__/test-pyramid-guard.test.sh
git commit -m "test(quality): guard bash 自测 harness——CI 内每次 proven-to-fire" --no-verify
```

---

### Task 3: 面板复活——状态更新脚本（已退役）加测试金字塔段

**Files:**
- Modify: 状态更新脚本（已退役，原 scripts/ 下）
- Modify: 对应 bash 测试（已退役，原 scripts/__tests__/ 下）

- [ ] **Step 1: 读现有脚本与测试，补 failing 断言**

在 bash 测试里按现有 case 风格加一条：生成的 CURRENT_STATE.md 必须含 `## 测试金字塔` 与 `孤儿`。先跑确认 FAIL。

- [ ] **Step 2: 实现**

在状态更新脚本生成「系统健康」之后插入（变量名按脚本现有风格）：

```bash
# ── 测试金字塔（刀0，数据源 test-pyramid-guard --json）──
PYRAMID_JSON=$(CI=true node "$MAIN_REPO/scripts/test-pyramid-guard.mjs" --root "$MAIN_REPO" --json 2>/dev/null || echo '{}')
PYRAMID_MD=$(node -e '
const r = JSON.parse(process.argv[1] || "{}");
if (!r.permanent) { console.log("（guard 数据不可用）"); process.exit(0); }
const L = r.permanent.layers || {};
console.log("| 层 | 数量 |");
console.log("|---|---|");
console.log(`| unit | ${L.unit ?? 0} |`);
console.log(`| integration | ${L.integration ?? 0} |`);
console.log(`| e2e/smoke | ${r.smoke?.total ?? 0} |`);
console.log(`| 孤儿（sprints 未入册）| ${r.orphans?.total ?? 0} |`);
console.log("");
console.log(r.pass ? "守卫: ✅ PASS" : "守卫: ❌ FAIL — " + (r.failures||[]).join("；"));
' "$PYRAMID_JSON")
```

并在输出模板对应位置加：

```
## 测试金字塔

${PYRAMID_MD}
```

- [ ] **Step 3: 跑该 bash 测试 + 本地真跑**

Run: bash 状态更新测试（已退役脚本）
Expected: PASS
Run: 状态更新脚本（已退役） && `CI= node scripts/test-pyramid-guard.mjs`
Expected: CURRENT_STATE.md generated 变为今天，guard 本地模式（含 A4）全绿
注意：`.agent-knowledge/CURRENT_STATE.md` 刷新后的内容变化**要 commit**（这次是真数据，也是治僵尸的实证）。

- [ ] **Step 4: commit**

```bash
git add .agent-knowledge/CURRENT_STATE.md
git commit -m "feat(quality): CURRENT_STATE 增测试金字塔段+复活生成（治05-22僵尸面板）" --no-verify
```

---

### Task 4: CI 接线（每 PR + nightly）

**Files:**
- Modify: `.github/workflows/ci.yml`（在 `dashboard-staging-gate-smoke` job 之后插入新 job）
- Modify: `.github/workflows/nightly-regression.yml`（加同款 job；若有汇总 job 的 needs 列表，把新 job 加进去）

- [ ] **Step 1: ci.yml 加 job**

```yaml
  # ─── 测试金字塔守卫（刀0）───────────────────────────────
  # 孤儿棘轮/smoke挂跑道/永久池棘轮；自测先行（每次 PR proven-to-fire）。
  # PRD: docs/prd/2026-07-14-ops-half-loop.prd.md
  test-pyramid-guard:
    name: 测试金字塔守卫
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Guard 自测（proven-to-fire）
        run: bash scripts/__tests__/test-pyramid-guard.test.sh
      - name: 状态更新脚本自测（原孤儿测试接入，脚本已退役）
        run: bash scripts/__tests__/state-updater.test.sh
      - name: 真跑守卫
        run: node scripts/test-pyramid-guard.mjs
```

- [ ] **Step 2: nightly-regression.yml 加同款 job**

复制上面 job 到 nightly-regression.yml 的 jobs 下（name 加「(nightly)」后缀）；查该文件末尾是否有汇总/开 Issue 的 job 依赖列表（`needs:`），有则把 `test-pyramid-guard` 加入，红了才会随刀A机制开 Issue。

- [ ] **Step 3: 本地 lint 验证**

Run: `node -e "const yaml=require('js-yaml');['ci.yml','nightly-regression.yml'].forEach(f=>yaml.load(require('fs').readFileSync('.github/workflows/'+f,'utf8')));console.log('yaml ok')"`
（js-yaml 不可用则用 `npx --yes yaml-lint` 或 python3 yaml.safe_load）
Expected: yaml ok

- [ ] **Step 4: commit**

```bash
git add .github/workflows/ci.yml .github/workflows/nightly-regression.yml
git commit -m "ci(quality): test-pyramid-guard 接入每PR CI + nightly（刀0跑道）" --no-verify
```

---

### Task 5: DoD + learning + 收尾材料

**Files:**
- Create: `DoD.cp-07141040-test-pyramid-guard.md`
- Create: `docs/learnings/cp-07141040-test-pyramid-guard.md`

- [ ] **Step 1: DoD（[BEHAVIOR] 至少 1 条，Test 用 CI 兼容 manual: 命令，push 前全 [x]）**

```markdown
# DoD: 刀0 test-pyramid-guard

- [x] [BEHAVIOR] guard 对孤儿超基线/smoke 无跑道/永久池跌破基线三种红况真报红，干净仓报绿
      Test: manual:bash scripts/__tests__/test-pyramid-guard.test.sh
- [x] [BEHAVIOR] 真实仓库 guard A1-A3 全绿（基线=当前实测）
      Test: manual:node scripts/test-pyramid-guard.mjs
- [x] [BEHAVIOR] CURRENT_STATE.md 含测试金字塔段且 generated 为最近 48h
      Test: manual:node -e "const t=require('fs').readFileSync('.agent-knowledge/CURRENT_STATE.md','utf8');if(!/## 测试金字塔/.test(t))process.exit(1)"
- [x] guard 纯函数 vitest 单测入永久池 tests/
      Test: tests/test-pyramid-guard.test.ts
```

- [ ] **Step 2: learning（含 ### 根本原因 / ### 下次预防 / - [ ]）**

```markdown
# Learning: 测试孤儿化与僵尸面板的机械守卫

### 根本原因
07-10 CI 大扫除把 sprints/** 摘出 vitest include，留了"手动毕业"规矩但无流程无守卫，
41+5 个测试静默孤儿化；CURRENT_STATE.md 自 05-22 停更同因——状态更新脚本（已退役）
从头到尾没有调用方，"写了≠在跑"。

### 下次预防
- [ ] 任何"留规矩"的 PR 必须同时带机械守卫（本次 A1-A4 棘轮即范式）
- [ ] 新增脚本必须同 PR 接入至少一条跑道（A2 判据从此机器管）
```

- [ ] **Step 3: 全量本地验证 + commit**

Run: `bash scripts/__tests__/test-pyramid-guard.test.sh && node scripts/test-pyramid-guard.mjs && cd packages/brain && npx vitest run ../../tests/test-pyramid-guard.test.ts && cd ../..`
Expected: 全绿

```bash
git add DoD.cp-07141040-test-pyramid-guard.md docs/learnings/cp-07141040-test-pyramid-guard.md
git commit -m "docs: 刀0 DoD + learning" --no-verify
```

---

### Task 6: 合并后机器态操作（不进 PR diff，收尾时执行）

- [ ] crontab 加每日面板刷新（与 janitor 同机制）：
  （状态更新脚本已退役，改由 Brain janitor 机制管理面板刷新）
- [ ] Brain task 596e6946 回写 completed + pr_url
- [ ] 更新 docs/current/README.md 巡检表（若有对应行）
