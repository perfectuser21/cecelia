# DoD（Definition of Done）：watchdog DIRTY resume 补丁

- **Task ID**: c6a171e5-1a9c-4058-8364-abd946daccae
- **Sprint Dir**: sprints/07171430-watchdog-dirty-resume
- **Gear**: hotfix

---

## [BEHAVIOR] 断言清单

- [ ] [BEHAVIOR] DIRTY + 容器消失 → 重点火，out.resumed=1，日志含 resume_conflict（B1-核心）
- [ ] [BEHAVIOR] BEHIND + 容器消失 → 重点火，日志含 BEHIND，不受 DIRTY 修改影响（B2-回归）
- [ ] [BEHAVIOR] CI 全绿 + CLEAN + evaluator 完成 → 不重点火，skip_green_waiting_merge（B3-回归）
- [ ] [BEHAVIOR] BLOCKED（非 DIRTY）+ CI pending → wait_ci_running，不重点火（B4-回归）
- [ ] [BEHAVIOR] DIRTY + attempt cap 达上限 → 不重点火，out.capped++（B5-铁律）

---

### [BEHAVIOR-1] DIRTY + 容器消失 → 触发有界重点火，日志含 resume_conflict

**层级**: P0（核心 bug 修复）
**触发条件**:
- PR state = OPEN
- `execFn('gh pr view ... --json mergeStateStatus')` 返回 `{"mergeStateStatus":"DIRTY"}`（真实 JSON，由 watchdog 内部 `tryParseJson` 解析，不 mock 解析路径）
- `execFn('docker ps ...')` 返回空字符串（容器消失）
- `execFn('gh pr checks ... --json state')` 返回 `[]`（CI pending）

**必须满足**:
1. `out.resumed === 1`
2. `deps.spawnFn` 被调用恰好一次
3. `console.log` spy 捕获到含 `resume_conflict` 的日志行
4. 修复前本断言必须 FAIL（验证测试覆盖了实际 bug 路径）

---

### [BEHAVIOR-2] BEHIND + 容器消失 → 触发重点火，日志含 BEHIND（回归保护）

**层级**: P0（回归）
**触发条件**:
- PR state = OPEN
- `execFn('gh pr view ... --json mergeStateStatus')` 返回 `{"mergeStateStatus":"BEHIND"}`
- 容器消失

**必须满足**:
1. `out.resumed === 1`
2. `deps.spawnFn` 被调用恰好一次
3. `console.log` spy 捕获到含 `BEHIND` 的日志行
4. 修复前后均须 PASS

---

### [BEHAVIOR-3] CI 全绿 + CLEAN + evaluator 完成 → 不重点火，等待 merge（回归保护）

**层级**: P0（回归）
**触发条件**:
- PR state = OPEN
- `mergeStateStatus=CLEAN`
- CI checks 全绿（`ciStatus=pass`）
- `_hasEvaluatorGate` 返回 true（DB 查询返回 evaluator done 记录）

**必须满足**:
1. `out.resumed === 0`
2. `deps.spawnFn` 不被调用（调用次数为 0）
3. `console.log` spy 捕获到含 `skip_green_waiting_merge` 的日志行
4. 修复前后均须 PASS

---

### [BEHAVIOR-4] BLOCKED（非 DIRTY）+ CI pending → wait_ci_running，不重点火（回归保护）

**层级**: P0（回归）
**触发条件**:
- PR state = OPEN
- `mergeStateStatus=BLOCKED`（非 DIRTY，非 BEHIND）
- CI checks 返回空数组（`ciStatus=pending`）
- 容器消失

**必须满足**:
1. `out.resumed === 0`
2. `deps.spawnFn` 不被调用
3. `console.log` spy 捕获到含 `wait_ci_running` 的日志行
4. 修复前后均须 PASS

---

### [BEHAVIOR-5] DIRTY + attempt cap 已达上限 → 不重点火，计 capped（铁律验证）

**层级**: P1（铁律合规）
**触发条件**:
- PR state = OPEN
- `mergeStateStatus=DIRTY`
- `attempts >= MAX_RELAY_ATTEMPTS`（当前值 5）
- 容器消失

**必须满足**:
1. `out.resumed === 0`（cap 生效，不重点火）
2. `out.capped` 递增（或任务状态被标 failed）
3. `deps.spawnFn` 不被调用

---

## 铁律检查项

| # | 铁律 | 验证方式 |
|---|------|---------|
| T1 | attempt cap 数值未改变（`MAX_RELAY_ATTEMPTS=5`，`MAX_CODEX_RELAY_ATTEMPTS=2`） | grep 代码确认 + [BEHAVIOR-5] |
| T2 | 测试不 mock `mergeStateStatus` 解析路径（`execFn` 必须返回真实 JSON 字符串） | code review：禁止 `vi.mock('./tryParseJson')` 或直接 stub `isBehind`/`isDirty` |
| T3 | BEHIND 路径行为不变（日志仍含 `BEHIND`，而非 `resume_conflict`） | [BEHAVIOR-2] |
| T4 | 容器存活时不走 DIRTY 重点火分支 | [BEHAVIOR-5 变体] 或代码路径审查 |
| T5 | 不增加额外 `gh` CLI 调用（`isDirty` 复用已有 `mergeStateStatus` 查询） | code diff 审查 |

---

## manual:bash 可执行验收命令

```bash
#!/usr/bin/env bash
# watchdog DIRTY resume 补丁 — 完整可执行验收命令
# 在 /workspace 目录下执行

set -euo pipefail
REPO_ROOT=/workspace
TASK_ID=c6a171e5-1a9c-4058-8364-abd946daccae
TEST_FILE="${REPO_ROOT}/tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js"

echo "=== Step 1: 确认测试文件存在 ==="
[ -f "${TEST_FILE}" ] && echo "OK: 测试文件存在" || { echo "FAIL: 测试文件不存在"; exit 1; }

echo ""
echo "=== Step 2: 确认 isDirty 变量已注入 watchdog（修复后才通过）==="
grep -n "isDirty" "${REPO_ROOT}/packages/brain/src/harness-relay-watchdog.js" \
  && echo "OK: isDirty 已注入" \
  || { echo "FAIL: watchdog 尚未注入 isDirty（修复未完成）"; exit 1; }

echo ""
echo "=== Step 3: 确认 resume_conflict 日志标记存在 ==="
grep -n "resume_conflict" "${REPO_ROOT}/packages/brain/src/harness-relay-watchdog.js" \
  && echo "OK: resume_conflict 日志标记存在" \
  || { echo "FAIL: 缺少 resume_conflict 日志标记"; exit 1; }

echo ""
echo "=== Step 4: 确认 attempt cap 数值未改变 ==="
RELAY_CAP=$(grep "MAX_RELAY_ATTEMPTS = " "${REPO_ROOT}/packages/brain/src/harness-relay-watchdog.js" | grep -oE "[0-9]+")
CODEX_CAP=$(grep "MAX_CODEX_RELAY_ATTEMPTS = " "${REPO_ROOT}/packages/brain/src/harness-relay-watchdog.js" | grep -oE "[0-9]+")
[ "${RELAY_CAP}" = "5" ] && echo "OK: MAX_RELAY_ATTEMPTS=5" || { echo "FAIL: MAX_RELAY_ATTEMPTS 已变（期望=5，实际=${RELAY_CAP}）"; exit 1; }
[ "${CODEX_CAP}" = "2" ] && echo "OK: MAX_CODEX_RELAY_ATTEMPTS=2" || { echo "FAIL: MAX_CODEX_RELAY_ATTEMPTS 已变（期望=2，实际=${CODEX_CAP}）"; exit 1; }

echo ""
echo "=== Step 5: 运行 vitest 回归测试（4 条用例必须全绿）==="
cd "${REPO_ROOT}"
npx vitest run "${TEST_FILE}" --reporter=verbose 2>&1 | tee /tmp/watchdog-dirty-resume-test-out.txt

echo ""
echo "=== Step 6: 验证测试结果 ==="
PASS_COUNT=$(grep -c " ✓\| passed" /tmp/watchdog-dirty-resume-test-out.txt || true)
FAIL_COUNT=$(grep -c " ✗\| failed\|FAIL" /tmp/watchdog-dirty-resume-test-out.txt || true)

grep "resume_conflict" /tmp/watchdog-dirty-resume-test-out.txt \
  && echo "OK: B1 日志断言 resume_conflict 已捕获" \
  || echo "WARN: 未在测试输出中找到 resume_conflict（可能在 console spy 内部，请检查 verbose 输出）"

grep "4 passed\|4 tests\|Tests: .*4 passed" /tmp/watchdog-dirty-resume-test-out.txt \
  && echo "OK: 4 条测试全绿" \
  || { echo "FAIL: 未出现 4 passed"; cat /tmp/watchdog-dirty-resume-test-out.txt; exit 1; }

echo ""
echo "=== Step 7: 全量 brain 回归（确保无破坏）==="
cd "${REPO_ROOT}/packages/brain"
npx vitest run --reporter=dot 2>&1 | tail -5

echo ""
echo "=== ALL CHECKS PASSED: watchdog DIRTY resume 补丁验收完成 ==="
echo "Task ID: ${TASK_ID}"
```

---

## 代码 Diff 核查点（code review checklist）

1. `let isDirty = false;` 在 `let isBehind = false;` 附近声明
2. 主路径（L391）：`isDirty = viewDetail?.mergeStateStatus === 'DIRTY';`
3. fallback 路径（L400）：`isDirty = prDetail?.mergeStateStatus === 'DIRTY';`
4. 判断条件（L413）改为：`if (isBehind || isDirty || ciStatus === 'fail')`
5. reason 赋值：`const reason = isDirty ? 'resume_conflict' : (isBehind ? 'BEHIND' : 'CI_FAILURE');`
6. 日志行更新为使用 `reason` 变量（已有结构 `console.log(...reason=${reason})`）
7. `ciStatus === 'pending'` 分支注释更新：说明"非 DIRTY 时才走此分支"
8. attempt cap 相关常量行未变动

---

## CI 门禁

- `brain-ci.yml` regression 目录自动纳入 `tests/regression/watchdog-dirty-resume/`
- 本次 hotfix 无需改 CI 配置，新目录自动被 glob 覆盖
- 合并前 CI 必须全绿（`brain-ci.yml` + `engine-ci.yml`）
