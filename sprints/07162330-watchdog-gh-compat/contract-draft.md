# Contract Draft — watchdog CI查询兼容老版gh + 仓库映射补 zenithjoy-skills

## 合同 ID
sprint-07162330-watchdog-gh-compat

## 对应 PRD
sprints/07162330-watchdog-gh-compat/sprint-prd.md

## 范围声明

本合同仅涵盖：
1. `packages/brain/src/harness-relay-watchdog.js` 中 CI 查询逻辑从 `gh pr checks --json` 替换为 `gh pr view --json statusCheckRollup,mergeStateStatus`
2. `_parseBaseRepo` 的 `DEFAULT_REPO_MAP` 补充 `zenithjoy-skills` → `perfectuser21/zenithjoy-skills` 映射
3. 对应 failing 测试先行写入（修复前 failing，修复后 passing）

**不在范围**：其他 watchdog 逻辑（A2/A3/A4 阶段）、gh 客户端升级、其他仓库映射。

## 行为断言（Behavior Assertions）

### B1 — 老版 gh `--json` 报错时走 pr view 路径而非保守跳过

**场景**：`execFn` 对 `gh pr checks --json` 抛出 `unknown flag: --json` 错误且无 stdout（`err.stdout = ''`）。

**修复前行为（failing test 验证）**：
- `execTolerant` 因 `err.stdout` 为空，re-throw 错误
- 外层 catch 进入 `保守跳过` 分支，`resumed = 0`，日志打 "CI 状态查询失败"

**修复后行为（passing test 验证）**：
- 检测到 `pr checks --json` 失败 → fallback 到 `gh pr view "${effectivePrUrl}" --json statusCheckRollup,mergeStateStatus`
- 解析 `statusCheckRollup` 数组：存在 FAILURE → `ci_red`；全 SUCCESS → `pass`；其余 → `pending`
- CI 红时 `resumed = 1`（触发重点火），不再 `保守跳过`

### B2 — `_parseBaseRepo` 正确解析 zenithjoy-skills 路径

**场景**：调用 `_parseBaseRepo('/Users/administrator/perfect21/zenithjoy-skills')`

**修复前行为（failing test 验证）**：
- `DEFAULT_REPO_MAP` 无 `zenithjoy-skills` key
- basename 匹配 `zenithjoy-skills` 无命中
- 路径包含检测命中 `zenithjoy`（key），返回 `perfectuser21/zenithjoy-workspace`（错误映射）
  或返回 `null`（取决于路径包含顺序）

**修复后行为（passing test 验证）**：
- `DEFAULT_REPO_MAP` 增加 `'zenithjoy-skills': 'perfectuser21/zenithjoy-skills'`
- 精确 basename 匹配 `zenithjoy-skills` 优先于包含检测 `zenithjoy`
- 返回 `'perfectuser21/zenithjoy-skills'`

### B3 — `statusCheckRollup` 为空数组时判定为 pending

**场景**：`gh pr view --json statusCheckRollup` 返回 `{"statusCheckRollup":[]}`

**行为**：`mapCiStatus([])` 返回 `'pending'`（无检查项时保守），不重点火

### B4 — 既有 A1/A5/A2 测试回归保护

**场景**：运行 `packages/brain/tests/` 下现有所有测试

**行为**：全部 PASS，无回退

## E2E 验收

target_environment: local_api

```bash
#!/usr/bin/env bash
# ============================================================
# E2E 验收脚本 — watchdog-gh-compat
# target_environment: local_api
# 运行方式: bash sprints/07162330-watchdog-gh-compat/e2e-verify.sh
# ============================================================
set -euo pipefail

SPRINT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SPRINT_DIR/../.." && pwd)"
TEST_FILE="$SPRINT_DIR/tests/harness-relay-watchdog-ghcompat.test.js"

echo "=== [E2E-1] 运行合同测试（failing → 修复后 passing）==="
cd "$BRAIN_ROOT/packages/brain"
npx vitest run "$TEST_FILE" --reporter=verbose
echo "=== [E2E-1] PASS ==="

echo "=== [E2E-2] 回归保护：既有测试全 PASS ==="
npx vitest run packages/brain/tests/ --reporter=verbose
echo "=== [E2E-2] PASS ==="

echo "=== [E2E-3] 单元断言：_parseBaseRepo zenithjoy-skills ==="
node -e "
import { _parseBaseRepo } from './src/harness-relay-watchdog.js';
const result = _parseBaseRepo('/Users/administrator/perfect21/zenithjoy-skills');
if (result !== 'perfectuser21/zenithjoy-skills') {
  console.error('FAIL: got', result);
  process.exit(1);
}
console.log('PASS: _parseBaseRepo returned', result);
" --input-type=module
echo "=== [E2E-3] PASS ==="

echo ""
echo "=== 所有 E2E 验收通过 ==="

# ---- 部署后补充（容器内真验，须人工附原文到 behavior_tests）----
# docker exec <container> gh pr view <test_pr_url> --json statusCheckRollup,mergeStateStatus
# 期望输出含 statusCheckRollup 数组，证明老版 gh 兼容新命令格式
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红色证据 |
|------|-----------|---------------|------------|
| B1 老版gh fallback | `../../tests/regression/watchdog-gh-compat/harness-relay-watchdog-ghcompat.test.js` | [B1-fallback-ci-red] 老版gh报错 → fallback pr view statusCheckRollup → CI红 → resumed=1 [FAILING] | 修复前 resumed=0（保守跳过），修复后 resumed=1 [FAILING 标注验证] |
| B2 zenithjoy-skills映射 | `../../tests/regression/watchdog-gh-compat/harness-relay-watchdog-ghcompat.test.js` | [B2-exact] _parseBaseRepo zenithjoy-skills 路径返回 perfectuser21/zenithjoy-skills [FAILING] | 修复前返回 null/wrong，修复后精确匹配 [FAILING 标注验证] |
| B3 空statusCheckRollup | `../../tests/regression/watchdog-gh-compat/harness-relay-watchdog-ghcompat.test.js` | [B3-empty-statusCheckRollup] 空数组 statusCheckRollup → pending → resumed=0 | N/A（保守策略，不触发重点火） |

## 未覆盖真实链路清单

N/A — 修改仅 watchdog 内部逻辑，mock execFn 已完整覆盖 gh 调用路径；无真实 gh CLI 集成路径需额外覆盖。

## 不变量（Invariants）

- 禁止 mock 掉版本差异：测试中 `execFn` 必须真实模拟老版 gh 的报错原文（`unknown flag: --json`）
- `_parseBaseRepo` 映射表扩展必须精确匹配（`zenithjoy-skills` 不得模糊命中 `zenithjoy`）
- 共享 CI 文件（`.github/workflows/*.yml`）未经合同授权不可修改
- 凭据不得硬编码、不得进 git、不得进日志
