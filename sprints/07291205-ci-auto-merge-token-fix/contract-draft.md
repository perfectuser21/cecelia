# Sprint Contract Draft (Round 1)

**覆盖父路**: 独立小路（无父路）

## 已知约束（来自回归测试）

- [ci-blindspot-contract.test.sh] → `ASSERT-1: changes job 含 push 事件短路逻辑（event_name == push）`
- [ci-blindspot-contract.test.sh] → `ASSERT-2: ci.yml 含 fleet-worker *.test.sh glob（失明点②已修复）`
- [ci-blindspot-contract.test.sh] → `ASSERT-3: ci-passed needs 数组含 brain-tests-shell（已列为必过项）`
- [累积FR] context-manifest: unavailable（journey_id=27e83eb4-d582-4baf-aa08-7d6acbbe6e26 暂无历史）

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

N/A — 任务无 HTTP 响应。本 sprint 是静态 CI 配置变更 + 静态 shell 测试断言，无新增 API 端点。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | auto-merge job 的 GH_TOKEN 改用 `${{ secrets.GH_PAT_BOT \|\| secrets.GITHUB_TOKEN }}`；新增静态契约测试断言该改动已落地 |
| **NFR（做得多好）** | 非功能需求 | 降级写法保证 `GH_PAT_BOT` 不存在时不崩溃，退化为原行为；ci.yml 改动量最小化（单行变更） |
| **Invariant（永不违反）** | 不变量 | `GH_PAT_BOT` 不存在时必须 fallback 到 `GITHUB_TOKEN`，不能让 auto-merge 挂掉；静态测试本身不引入新 CI 依赖 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方登记表 |
| **保质期（何时过期）** | 失效时机 | 若 GitHub 将来废除 loop-prevention 机制，此修复可回退；无固定时间失效 |
| **死亡告警（停了谁知道）** | 告警手段 | 修复失效时，main push 不再触发 CI run，Cecelia Brain 巡检会发现 CI 缺少 push 事件 run |
| **失败语义（挂了怎么办）** | 故障策略 | `GH_PAT_BOT` 不存在 → 降级 `GITHUB_TOKEN`，行为退化回修复前（可接受，不崩溃）；auto-merge 失败 → Brain 回写任务 failed 状态（已有逻辑） |
| **效果确认（已发≠已生效）** | 验证方式 | `gh run list --branch main --workflow=ci.yml --limit 1` 核实 event=push CI run 出现；静态测试 exit 0 确认字段写法正确 |

### 判定点登记表

（本任务无接缝判定点 — 本 sprint 是静态 CI 配置文本变更，无 RPA/真机/外部状态推断接缝，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `GH_PAT_BOT` secret 不存在 | auto-merge 使用 `GITHUB_TOKEN` 降级，loop-prevention 限制恢复（退化到修复前行为） | 是（幂等，无状态改变） | 接受降级，不崩溃 |
| 静态测试 ci.yml 不可读 | 测试 exit 1，报错 "ci.yml 不存在，中止" | 是 | 无降级（是真实错误，应修复） |

### 输入对抗面

N/A — 本 sprint 不对外暴露 agent，纯内部 CI 配置变更。

---

## 禁 mock 边清单

（本单纯 CI 配置文本变更 + 静态 shell 测试断言，不涉及调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，N/A）

---

## 未覆盖真实链路清单

本合同无 mock 豁免——静态 shell 测试直接 grep ci.yml 文件内容，无外部依赖，无 mock/stub/force_*。

但存在一条真实链路需人工验证：

| 真实链路点 | 为什么无法在本 sprint 覆盖 | 真验证补位计划 |
|---|---|---|
| PR 合并入 main 后 GitHub Actions 产生 event=push 的 CI run | 需要真实 GitHub merge 事件，无法在本地静态断言 | PR 合并后手动执行 `gh run list --branch main --workflow=ci.yml --limit 1` 核实 event=push |

---

## Golden Path

[ci.yml auto-merge job 使用 `GITHUB_TOKEN`（旧）] → [修改为 `GH_PAT_BOT \|\| GITHUB_TOKEN`（降级写法）] → [PAT 触发的 merge bypass loop-prevention] → [main push 事件正常触发下游 CI run]

### Step 1: 契约测试（先红）— 静态断言 ci.yml 使用了 GH_PAT_BOT
**来源**: `[FROM_PRD]` — PRD 明确要求"新增静态契约测试 packages/engine/tests/integrity/auto-merge-token-contract.test.sh"

**可观测行为**: 在 ci.yml 未改之前运行契约测试，脚本应 exit 1（断言失败），证明测试真的在检测目标字段

**验证命令**:
```bash
# 【铁律-字段核实】实际读文件确认当前行号与字段名
grep -n "GH_TOKEN" /workspace/.github/workflows/ci.yml
# 当前实际输出（已读文件核实）：1896:          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# 运行契约测试（此时 ci.yml 还未改，应 exit 1）
bash packages/engine/tests/integrity/auto-merge-token-contract.test.sh
# 期望：exit 1（FAIL 断言打印）
```

**硬阈值**: exit code = 1（Red 阶段），FAIL ≥ 1

---

### Step 2: 修改 ci.yml GH_TOKEN（后绿）— 改为降级写法
**来源**: `[FROM_PRD]` — PRD 明确"auto-merge job 的 GH_TOKEN 由 `secrets.GITHUB_TOKEN` 改为 `secrets.GH_PAT_BOT || secrets.GITHUB_TOKEN`"

**可观测行为**: 修改 .github/workflows/ci.yml 第 1896 行的 GH_TOKEN 环境变量值为 `${{ secrets.GH_PAT_BOT || secrets.GITHUB_TOKEN }}`，契约测试重跑应 exit 0

**验证命令**:
```bash
# 验证改动是否落地（grep 应命中新写法）
grep -n "GH_PAT_BOT" /workspace/.github/workflows/ci.yml
# 期望：输出含 GH_PAT_BOT 的行

# 【铁律-语义字段】确认 GH_TOKEN 字段引用的是 GH_PAT_BOT（而非仅文件含该字符串）
grep -A0 "GH_TOKEN:" /workspace/.github/workflows/ci.yml | grep "GH_PAT_BOT"
# 期望：命中一行（auto-merge job 的 GH_TOKEN 字段）

# 重跑契约测试（ci.yml 已改，应 exit 0）
bash packages/engine/tests/integrity/auto-merge-token-contract.test.sh
# 期望：exit 0（全部 PASS）
```

**硬阈值**: exit code = 0（Green 阶段），PASS = 全部断言

---

### Step 3: 终极验收 — PR 合并后核实 event=push 的 CI run
**来源**: `[FROM_PRD]` — PRD 明确"合并后必须用 gh run list --branch main --workflow=ci.yml --limit 1 核实 event=push"

**可观测行为**: PR 合并入 main 后，GitHub Actions 页面出现 event=push 触发的 CI run（而非仅 pull_request 事件），证明 loop-prevention 已被 bypass

**验证命令**:
```bash
# 【铁律-语义字段】必须确认 event=push，而非仅 run 存在
gh run list --branch main --workflow=ci.yml --limit 1 --json event,status,conclusion,headBranch \
  | jq -e '.[0].event == "push"'
# 期望：true（event 列为 push，不是 pull_request）
```

**硬阈值**: event = "push"（语义字段核实，不仅是 run 存在）；此步骤需 PR 实际合并后人工执行

---

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: local_api

> 本 sprint 是静态 shell 测试断言，无浏览器/远端机器依赖，本地执行即可。

```bash
#!/bin/bash
# final-e2e — auto-merge GH_TOKEN 修复 契约验证
# 执行路径：先红 → 改 ci.yml → 后绿
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
TEST_SCRIPT="$REPO_ROOT/packages/engine/tests/integrity/auto-merge-token-contract.test.sh"

echo "=== [E2E] auto-merge-token-contract final-e2e ==="

# ── 前置检查 ─────────────────────────────────────────────────────────────────
if [[ ! -f "$CI_YML" ]]; then
  echo "FAIL: $CI_YML 不存在"; exit 1
fi
if [[ ! -f "$TEST_SCRIPT" ]]; then
  echo "FAIL: 契约测试不存在 $TEST_SCRIPT"; exit 1
fi

# ── 字段核实（铁律：不凭记忆，实际读文件）──────────────────────────────────
echo "--- 字段核实：ci.yml auto-merge job GH_TOKEN ---"
GH_TOKEN_LINE=$(grep -n "GH_TOKEN:" "$CI_YML" | head -1)
echo "实际内容：$GH_TOKEN_LINE"

# ── 断言 GH_TOKEN 已使用 GH_PAT_BOT（后绿状态）────────────────────────────
if echo "$GH_TOKEN_LINE" | grep -q "GH_PAT_BOT"; then
  echo "PASS: GH_TOKEN 引用了 GH_PAT_BOT（loop-prevention bypass 已启用）"
else
  echo "FAIL: GH_TOKEN 未引用 GH_PAT_BOT，仍是 GITHUB_TOKEN 单一写法"
  exit 1
fi

# ── 运行静态契约测试脚本 ─────────────────────────────────────────────────────
echo "--- 运行契约测试 ---"
if bash "$TEST_SCRIPT"; then
  echo "PASS: 契约测试全部通过（exit 0）"
else
  echo "FAIL: 契约测试失败（exit $?）"
  exit 1
fi

# ── 枚举完整性检查（铁律：grep 全仓库复查）────────────────────────────────
echo "--- 枚举完整性：全仓库 GH_PAT_BOT 引用复查 ---"
REFS=$(grep -r "GH_PAT_BOT" "$REPO_ROOT/.github/" --include="*.yml" -l 2>/dev/null || true)
echo "引用 GH_PAT_BOT 的 workflow 文件：$REFS"

echo "=== PASS: final-e2e 全部通过 ==="
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（低风险 sprint，无真机/第三方 API）

高风险面:
- 错输入: 如果 ci.yml 格式破坏（缩进错误）导致 `grep -n "GH_TOKEN:"` 命中多行，测试脚本是否正确处理
- 边界值: `GH_PAT_BOT` 和 `GITHUB_TOKEN` 顺序互换（`GITHUB_TOKEN || GH_PAT_BOT`）时契约测试是否能检测到错误写法
- 中途中断: 如果 ci.yml 只有 GH_PAT_BOT 字符串出现在注释中（非 GH_TOKEN 字段），测试是否会假绿

发现分级: P0/P1（测试假绿/假红）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ci.yml auto-merge job 使用 GH_PAT_BOT | `packages/engine/tests/integrity/auto-merge-token-contract.test.sh` | `ASSERT-1: auto-merge job GH_TOKEN 引用了 GH_PAT_BOT` | ci.yml 改前 exit 1，FAIL=1 |
| 降级写法格式正确（含双竖线）| `packages/engine/tests/integrity/auto-merge-token-contract.test.sh` | `ASSERT-2: GH_TOKEN 值含降级写法 \|\| secrets.GITHUB_TOKEN` | ci.yml 改前 exit 1，FAIL=1 |
| 非注释行引用（语义字段核实）| `packages/engine/tests/integrity/auto-merge-token-contract.test.sh` | `ASSERT-3: GH_TOKEN 字段在 auto-merge job env: 块内（非注释）` | ci.yml 改前 exit 1，FAIL=1 |

**自查（生成后必做）**：
- [x] 八要素每行都有答案（N/A 必须显式）
- [x] 判定点登记表：本任务无接缝判定点，已显式写 N/A
- [x] 失败语义：降级和测试失败场景均已写
- [x] 效果确认：gh run list event=push 核实方式已写
- [x] 禁 mock 边清单：纯 CI 配置文本变更，已写 N/A
- [x] 未覆盖真实链路：已列 PR 合并后 event=push 人工核实
