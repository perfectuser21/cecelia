# Sprint Contract Draft (Round 1)

**Sprint**: headed-smoke-test（relay 链路冒烟：smoke-artifact 落地）
**task_id**: b30fe42b-86c7-412e-9e05-eb08ac26488e
**smoke_tag**: claude-headed-dispatch-local-31156-4267
**journey_type**: autonomous
**target_environment**: local_api

---

## Response Schema（推导来源: PRD字面）

N/A — 任务无 HTTP 响应（本 sprint 不新增任何 API/端点，见 PRD「范围限定」）。

工件 JSON schema 按 PRD 第 19 行字面 codify（`smoke-artifact.json` 顶层对象）：

```json
{"task_id": "b30fe42b-86c7-412e-9e05-eb08ac26488e", "smoke_tag": "claude-headed-dispatch-local-31156-4267", "mode": "headed"}
```

- `task_id` (string, 必填): 来源——PRD 明确（第 19 行，字面相等）
- `smoke_tag` (string, 必填): 来源——PRD 明确（第 11/19 行，字面相等，含大小写）
- `mode` (string, 必填, 字面量 "headed"): 来源——PRD 明确（第 19 行）
- **顶层 keys 必须完全等于** `["mode","smoke_tag","task_id"]`（jq keys 排序后），禁止多塞字段
- **禁用字段名**: 无同义替换词清单（PRD 未列），但 keys 完整性断言已封死任何额外字段
- **Error**: N/A（无 HTTP error path；文件缺失/JSON 不合法即冒烟 FAIL，见边界情况）

---

## 已知约束

- 回归测试约束：（暂无已知约束——smoke 任务不触及 line04/video/publisher 等既有模块，未检索到相关测试文件）
- [累积FR] context-manifest: unavailable（`GET /api/brain/line/bb8cc561-.../context-manifest` 返回 404，端点不存在；PRD「累积 FR」段亦载明本 line 暂无历史）
- contract-gate: `packages/brain/src/lib/contract-gate.js` 存在，cecelia 场景，代码层 Contract Gate 正常生效

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 在 `sprints/08061902-relay-b30fe42b/` 落一个最小可断言工件 `smoke-artifact.json`，三字段与 task payload 字面相等 |
| **NFR（做得多好）** | 非功能需求 | N/A（PRD NFR 段为空；仅要求断言脚本落会话独享路径、工件随 git commit 留痕） |
| **Invariant（永不违反）** | 不变量 | 不改任何产品代码路径（packages/*、apps/* 零改动）；断言临时文件用 mktemp 会话独享路径 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | 工件仅服务本次冒烟 run，随分支归档即完成使命，无退役动作 |
| **死亡告警（停了谁知道）** | 停止工作谁知道 | relay run 各棒失败由 Brain watchdog/phase-event 机制感知（既有能力，非本 sprint 范围）；冒烟断言失败即 evaluator FAIL，run 不走完 |
| **失败语义（挂了怎么办）** | 故障时行为 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执验证 | 工件生效 = jq 三字段断言 exit 0 + `git ls-files` 确认已 commit 留痕，两者都是机械回执 |

### 判定点登记表（对模糊现实的判断假设）

（本任务无接缝判定点，N/A——纯本地文件字面断言，不推断任何外部真实状态）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 工件文件缺失 | jq 报错 exit 非 0 → 冒烟 FAIL | 是（重写同一文件幂等） | 无降级，FAIL 即打回 |
| JSON 不合法 | `jq empty` exit 非 0 → 冒烟 FAIL | 是 | 无降级 |
| 字段与 payload 不字面相等（含大小写/截断） | jq -e exit 非 0 → 冒烟 FAIL | 是 | 无降级 |
| 工件未 commit 进分支 | `git ls-files --error-unmatch` exit 非 0 → FAIL | 是 | 无降级 |

### 输入对抗面

N/A（无对外暴露 agent，无外部用户可写入接口；工件由 relay 链内部生成）

---

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」链路，无任何 HTTP 调用方。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A——所有断言均对真实落盘文件与真实 git 索引执行，零 mock/stub/force_*）

## 禁 mock 边清单

（本单不改任何产品代码——不涉及调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，仅 sprint 目录静态工件落地与本地断言，无接缝边，N/A）

## 接缝清单（接缝断言 vs 逻辑断言）

- 本合同全部断言为**逻辑断言**（环境无关：本地文件读取 + JSON 字面比较 + git 索引查询），无接缝断言。
- relay 派发链路本身的"真目标验证"就是本次 run 自身：本合同由 Brain headed 真实派发产生、由 evaluator 在真实 relay run 内执行，链路连通性由 run 走完这一事实直接证明，无 `logic-done-pending` 项。

---

## Golden Path
[Brain headed 派发] → [工件 smoke-artifact.json 落 sprint 目录] → [jq 三字段断言通过 + git commit 留痕，run 走完]

### Step 1: Brain headed 派发触发，冒烟锚点已落盘
**来源**: `[FROM_PRD]` — PRD 第 11/18 行（Brain 派发 task b30fe42b，mode=headed，smoke_tag 字面值锚定）

**可观测行为**: sprint 目录存在且 sprint-prd.md 载明 smoke_tag 字面值（planner 棒已完成并 commit，证明派发→planner 段连通）

**验证命令**:
```bash
grep -q 'claude-headed-dispatch-local-31156-4267' sprints/08061902-relay-b30fe42b/sprint-prd.md || { echo "FAIL: PRD 缺冒烟锚点"; exit 1; }
```

**硬阈值**: grep exit 0（锚点字面命中）

---

### Step 2: 后续棒在 sprint 目录写入最小工件 smoke-artifact.json
**来源**: `[FROM_PRD]` — PRD 第 19 行（三字段：task_id / smoke_tag / mode）

**可观测行为**: `sprints/08061902-relay-b30fe42b/smoke-artifact.json` 存在、为合法 JSON、三字段与 task payload 字面相等

**验证命令**:
```bash
jq empty sprints/08061902-relay-b30fe42b/smoke-artifact.json || { echo "FAIL: 工件缺失或 JSON 不合法"; exit 1; }
jq -e '.task_id == "b30fe42b-86c7-412e-9e05-eb08ac26488e"' sprints/08061902-relay-b30fe42b/smoke-artifact.json || { echo "FAIL: task_id 不字面相等"; exit 1; }
jq -e '.smoke_tag == "claude-headed-dispatch-local-31156-4267"' sprints/08061902-relay-b30fe42b/smoke-artifact.json || { echo "FAIL: smoke_tag 不字面相等"; exit 1; }
jq -e '.mode == "headed"' sprints/08061902-relay-b30fe42b/smoke-artifact.json || { echo "FAIL: mode 不等于 headed"; exit 1; }
```

**硬阈值**: 4 条命令全部 exit 0；任一字段大小写/截断偏差即 FAIL

---

### Step 3: 工件随分支 commit 留痕，冒烟可复跑
**来源**: `[FROM_PRD]` — PRD 第 20 行（"工件随分支 commit 留痕"）

**可观测行为**: 工件被 git 跟踪（进入分支提交），任何人 checkout 分支后可复跑断言

**验证命令**:
```bash
git ls-files --error-unmatch sprints/08061902-relay-b30fe42b/smoke-artifact.json >/dev/null || { echo "FAIL: 工件未被 git 跟踪"; exit 1; }
```

**硬阈值**: exit 0（工件在 git 索引中）

---

### Step 4: schema 封闭性 + 断言 oracle 负向自证
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防 generator 多塞字段漂移（keys 完整性封死额外字段），并证明 oracle 不是被 `|| true` 化的假绿（对篡改副本同一断言必 FAIL）

**可观测行为**: 顶层 keys 完全等于预期集合；对篡改 smoke_tag 的副本执行同一断言返回非 0

**验证命令**:
```bash
jq -e 'keys == ["mode","smoke_tag","task_id"]' sprints/08061902-relay-b30fe42b/smoke-artifact.json || { echo "FAIL: 顶层 keys 不完全等于预期"; exit 1; }
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/smoke-gp4-b30fe42b-XXXXXX")
jq '.smoke_tag = "tampered"' sprints/08061902-relay-b30fe42b/smoke-artifact.json > "$TMPD/bad.json"
if jq -e '.smoke_tag == "claude-headed-dispatch-local-31156-4267"' "$TMPD/bad.json"; then echo "FAIL: 篡改副本竟通过断言"; rm -rf "$TMPD"; exit 1; fi
rm -rf "$TMPD"
```

**硬阈值**: keys 断言 exit 0；负向分支不触发（篡改副本断言必 FAIL）；临时文件走 mktemp 会话独享路径并清理

---

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

> local_api 变体：本 sprint 无 HTTP/DB（PRD 范围限定禁止），全程本地文件 + jq + git 断言，evaluator 在仓库根目录直接执行。

```bash
#!/bin/bash
set -euo pipefail

SPRINT_DIR="sprints/08061902-relay-b30fe42b"
ARTIFACT="$SPRINT_DIR/smoke-artifact.json"
EXPECT_TASK_ID="b30fe42b-86c7-412e-9e05-eb08ac26488e"
EXPECT_SMOKE_TAG="claude-headed-dispatch-local-31156-4267"
EXPECT_MODE="headed"

# 1. 派发锚点留痕（Golden Path Step 1）
grep -q "$EXPECT_SMOKE_TAG" "$SPRINT_DIR/sprint-prd.md" || { echo "FAIL: PRD 缺冒烟锚点"; exit 1; }

# 2. 工件存在且为合法 JSON（Golden Path Step 2）
jq empty "$ARTIFACT" || { echo "FAIL: 工件缺失或 JSON 不合法"; exit 1; }

# 3. 三字段与 payload 字面相等（含大小写）
jq -e --arg v "$EXPECT_TASK_ID" '.task_id == $v' "$ARTIFACT" || { echo "FAIL: task_id 不字面相等"; exit 1; }
jq -e --arg v "$EXPECT_SMOKE_TAG" '.smoke_tag == $v' "$ARTIFACT" || { echo "FAIL: smoke_tag 不字面相等"; exit 1; }
jq -e --arg v "$EXPECT_MODE" '.mode == $v' "$ARTIFACT" || { echo "FAIL: mode 不等于 headed"; exit 1; }

# 4. schema 封闭性：顶层 keys 完全等于预期（Golden Path Step 4）
jq -e 'keys == ["mode","smoke_tag","task_id"]' "$ARTIFACT" || { echo "FAIL: 顶层 keys 不完全等于预期"; exit 1; }

# 5. 负向自证：oracle 对篡改副本必 FAIL —— 临时文件落会话独享路径
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/smoke-e2e-b30fe42b-XXXXXX")
jq '.smoke_tag = "tampered"' "$ARTIFACT" > "$TMPD/bad.json"
if jq -e --arg v "$EXPECT_SMOKE_TAG" '.smoke_tag == $v' "$TMPD/bad.json"; then
  echo "FAIL: 篡改副本竟通过断言 - oracle 假绿"; rm -rf "$TMPD"; exit 1
fi
rm -rf "$TMPD"

# 6. git 留痕：工件必须进分支提交（Golden Path Step 3）
git ls-files --error-unmatch "$ARTIFACT" >/dev/null || { echo "FAIL: 工件未被 git 跟踪/commit"; exit 1; }

echo "✅ Golden Path 冒烟验证通过"
```

**PASS 标准**: 脚本 exit 0
**FAIL 标准**: 任一断言 exit 非 0（文件缺失 / JSON 不合法 / 字段不字面相等 / keys 漂移 / 负向自证失效 / 未 commit 留痕）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 工件合法性 | `tests/smoke-artifact.test.ts` | 存在且为合法 JSON 对象 | 工件未落地 → failure |
| task_id 字面相等 | `tests/smoke-artifact.test.ts` | task_id 字面等于 b30fe42b-86c7-412e-9e05-eb08ac26488e | → failure |
| smoke_tag 字面相等 | `tests/smoke-artifact.test.ts` | smoke_tag 字面等于 claude-headed-dispatch-local-31156-4267 | → failure |
| mode 字面相等 | `tests/smoke-artifact.test.ts` | mode 字面等于 headed | → failure |
| schema 封闭性 | `tests/smoke-artifact.test.ts` | 顶层 keys 完全等于 mode,smoke_tag,task_id | → failure |
| oracle 负向自证 | `tests/smoke-artifact.test.ts` | 篡改 smoke_tag 后同一断言必失败 | → failure |

预期红证据合计：工件未落地时 6 个 it() 全部 failure（每个用例均真实读取工件文件）。
