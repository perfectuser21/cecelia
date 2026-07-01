# 无条件核心回归闸（B1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。步骤用 `- [ ]`。

**Goal:** 新增一条无条件 CI 回归闸，脱离路径门跑 `regression-contract.yaml` 里的 must-never-break 断言，并删掉扫空目录静默 exit 0 的假绿灯 `regression-smoke`。

**Architecture:** `regression-contract.yaml`(SSOT，schema 对齐 packages/quality template) → `scripts/ci/run-core-regression.sh --tier pr|release`(yq 解析+执行+空契约守卫) → `ci.yml` 新 `core-regression` job(无路径门 if，PR/push-main 两档) → 接入 `ci-passed`。

**Tech Stack:** bash + yq + GitHub Actions + node(静态断言测试)

---

### Task 1: 契约非空守卫 + 播种 P0 种子

**Files:**
- Test: `packages/quality/__tests__/regression-contract.test.js`(新建)
- Modify: `regression-contract.yaml`

- [ ] **Step 1: 写失败测试**（断言 contract 有 ≥1 golden_path 且字段齐全）
```js
// regression-contract.test.js
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { test, expect } from 'vitest';
test('regression-contract 非空且字段齐全', () => {
  const c = parse(readFileSync(new URL('../../../regression-contract.yaml', import.meta.url), 'utf8'));
  expect(Array.isArray(c.golden_paths)).toBe(true);
  expect(c.golden_paths.length).toBeGreaterThanOrEqual(1);
  for (const g of c.golden_paths) {
    for (const f of ['id','priority','trigger','method','test_command']) expect(g[f]).toBeDefined();
  }
});
```
- [ ] **Step 2: 跑 → 失败**（`golden_paths` 为空/字段缺）`cd packages/quality && npx vitest run __tests__/regression-contract.test.js`，Expected: FAIL
- [ ] **Step 3: 播种**（把 root `regression-contract.yaml` 的 `core: []` / `golden_paths: []` 换成对齐 schema 的种子；种子用真实存在的 must-never-break：DEFINITION 一致性 `node scripts/facts-check.mjs`）
```yaml
golden_paths:
  - id: CORE-001
    name: "DEFINITION.md 与代码一致（facts-check）"
    priority: P0
    trigger: [PR, Release]
    method: auto
    test_command: "node scripts/facts-check.mjs"
    must_never_break: true
```
（若 `scripts/facts-check.mjs` 不存在，改用 `bash scripts/check-version-sync.sh`，先 `ls` 确认）
- [ ] **Step 4: 跑 → 通过**
- [ ] **Step 5: commit** `git add regression-contract.yaml packages/quality/__tests__/regression-contract.test.js && git commit -m "feat(b1): 播种 regression-contract P0 种子 + 非空守卫测试"`

---

### Task 2: run-core-regression.sh 执行器（TDD bash）

**Files:**
- Test: `scripts/ci/__tests__/run-core-regression.test.sh`(新建)
- Create: `scripts/ci/run-core-regression.sh`

- [ ] **Step 1: 写失败测试**（fixture 契约，断言四种退出码）
```bash
#!/usr/bin/env bash
# run-core-regression.test.sh — 纯 bash 断言
set -u; SCRIPT="$(dirname "$0")/../run-core-regression.sh"; TMP=$(mktemp -d); fail=0
mk(){ cat > "$TMP/c.yaml"; }
# 1) 全绿 → 0
mk <<E
golden_paths:
  - {id: T1, priority: P0, trigger: [PR], method: auto, test_command: "true"}
E
bash "$SCRIPT" --tier pr --contract "$TMP/c.yaml"; [ $? -eq 0 ] || { echo "FAIL: 全绿应 0"; fail=1; }
# 2) 一条 fail → 1
mk <<E
golden_paths:
  - {id: T2, priority: P0, trigger: [PR], method: auto, test_command: "false"}
E
bash "$SCRIPT" --tier pr --contract "$TMP/c.yaml"; [ $? -ne 0 ] || { echo "FAIL: 有失败应非0"; fail=1; }
# 3) 空 release 集 → 1（空契约守卫）
mk <<E
golden_paths:
  - {id: T3, priority: P0, trigger: [PR], method: auto, test_command: "true"}
E
bash "$SCRIPT" --tier release --contract "$TMP/c.yaml"; [ $? -ne 0 ] || { echo "FAIL: 空release应非0"; fail=1; }
rm -rf "$TMP"; [ $fail -eq 0 ] && echo "ALL PASS" || exit 1
```
- [ ] **Step 2: 跑 → 失败**（脚本不存在）`bash scripts/ci/__tests__/run-core-regression.test.sh`，Expected: FAIL
- [ ] **Step 3: 实现 run-core-regression.sh**（yq 选 `trigger` 含当前 gate 的条目；PR→gate=PR，release→gate=Release；逐条跑 test_command；任一非0则整体非0；选出0条→非0）
```bash
#!/usr/bin/env bash
set -uo pipefail
TIER=pr; CONTRACT="regression-contract.yaml"
while [ $# -gt 0 ]; do case "$1" in --tier) TIER="$2"; shift 2;; --contract) CONTRACT="$2"; shift 2;; *) shift;; esac; done
GATE=PR; [ "$TIER" = release ] && GATE=Release
mapfile -t IDS < <(yq -r ".golden_paths[] | select(.trigger[] == \"$GATE\") | .id" "$CONTRACT")
[ "${#IDS[@]}" -eq 0 ] && { echo "ERROR: tier=$TIER 选出0条（空契约守卫）"; exit 1; }
rc=0
for id in "${IDS[@]}"; do
  cmd=$(yq -r ".golden_paths[] | select(.id==\"$id\") | .test_command" "$CONTRACT")
  echo "=== [$id] $cmd ==="
  bash -c "$cmd" || { echo "FAIL: $id"; rc=1; }
done
exit $rc
```
- [ ] **Step 4: 跑 → 通过**（需本机有 yq；CI ubuntu 自带/apt）
- [ ] **Step 5: commit** `git add scripts/ci/run-core-regression.sh scripts/ci/__tests__/run-core-regression.test.sh && git commit -m "feat(b1): run-core-regression.sh 执行器+空契约守卫 TDD"`

---

### Task 3: ci.yml core-regression job + 删假绿灯

**Files:**
- Test: `packages/quality/__tests__/ci-core-regression.test.js`(新建，静态断言)
- Modify: `.github/workflows/ci.yml`（716 行 regression-smoke 块；506/ci-passed）

- [ ] **Step 1: 写失败测试**（grep ci.yml：有无路径门的 core-regression + 含 main release 档；regression-smoke 已删）
```js
import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url),'utf8');
test('core-regression 无 workspace 路径门', () => {
  const m = ci.match(/\n {2}core-regression:[\s\S]*?(?=\n {2}\w)/);
  expect(m).not.toBeNull();
  expect(m[0]).not.toMatch(/needs\.changes\.outputs\.workspace/);
  expect(m[0]).toMatch(/refs\/heads\/main/);
});
test('假绿灯 regression-smoke 已删', () => { expect(ci).not.toMatch(/golden-smoke\.test\.ts/); });
```
- [ ] **Step 2: 跑 → 失败**
- [ ] **Step 3: 改 ci.yml**：删除 716 起的 `regression-smoke` job；新增 `core-regression` job（`needs: [changes]` 但**无 `if` 路径门**；step 装 yq；PR 事件 `run-core-regression.sh --tier pr`，`github.ref=='refs/heads/main'` 时 `--tier release`）；把 `core-regression` 加入 `ci-passed` 的 `needs` 并在其判定里要求 success（非 skipped）。
- [ ] **Step 4: 跑 → 通过**
- [ ] **Step 5: commit** `git add .github/workflows/ci.yml packages/quality/__tests__/ci-core-regression.test.js && git commit -m "feat(b1): core-regression 无条件 job + 删 regression-smoke 假绿灯"`

---

### Task 4: proven-to-fire + 本地全绿收尾

- [ ] **Step 1:** 本机 `bash scripts/ci/run-core-regression.sh --tier release` → exit 0（种子 facts-check 过）
- [ ] **Step 2:** proven-to-fire：临时把种子 test_command 改成 `false` → 跑应 exit 1（亲眼见红）→ 还原
- [ ] **Step 3:** 全测试跑一遍：`bash scripts/ci/__tests__/run-core-regression.test.sh` + `cd packages/quality && npx vitest run __tests__/`
- [ ] **Step 4: commit（如有还原改动）** + push
