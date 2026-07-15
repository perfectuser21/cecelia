# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面 — 本任务无新增 HTTP 端点）

N/A — 任务无 HTTP 响应。本 sprint 只新增一个 shell 校验脚本（`e2e-verify.sh`），复用既有
`GET /api/brain/tasks/:id`（已在 main，字段不变）与既有 `initiative_runs` 表结构（不新增列）。

## 已知约束（来自回归测试 / 累积FR）

- `scripts/smoke/e2e/relay-4bb31ef5.sh` → `OK headed smoke regression verified for $TASK_ID`（历史锚点，本轮不改不删）
- `packages/brain/scripts/smoke/claude-headed-dispatch-smoke.sh` → 5 项 smoke（POST headed/claude、POST headed/codex 对称放行、POST headless 合法、POST mode=invalid 400、`initiative_runs.tmux_killed_at` 字段存在）
- [累积FR] claude-headed relay wrapper（PR #3829，4bb31ef5）: claude-headed-dispatch-smoke.sh 新增 → smoke-allowlist.txt 登记 → ci.yml claude-headed 精确判定分支（先于 codex 兜底）→ relay-4bb31ef5.sh 毕业进 nightly 池
- context-manifest: 端点可达但本 line（bb8cc561）返回空 manifest（无历史 FR 记录冲突），已核对，非 unavailable

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 系统对外承诺做什么 | 新增 `sprints/07151206-relay-cd0b936c/e2e-verify.sh`，复用 `relay-4bb31ef5.sh` 的验证项（claude-headed-dispatch-smoke.sh + allowlist 登记 + ci.yml 分支优先级 + harness-skill-relay.js 路由标记 + initiative_runs 行），但 TASK_ID/SPRINT_DIR 默认值改绑本轮 `cd0b936c-2891-4fed-a921-5636ca08d1e8` |
| **NFR（做得多好）** | 性能/可靠性/并发阈值等 | 无显式超时，沿用 CI job timeout 兜底（PRD NFR 段已声明待定，本 sprint 不新增约束） |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | 见下方 DoD Invariant 覆盖条目（6 条铁律逐条映射） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方判定点登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效 | 无 token/凭据；脚本本身随下一轮回归任务（下一个 task_id）新增等价脚本时不过期，历史脚本永久保留作回归锚点 |
| **死亡告警（停了谁知道）** | 该功能停止工作后谁在多久内会知道 | nightly 失败已有 Bark 告警机制（`e2e-nightly.sh` 现有），本 sprint 脚本毕业后自动纳入同一告警面，不新增 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效 | 脚本本身即验证动作：`curl -f` + `psql` 直接查真实 Brain/DB 当前状态，非静态断言 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 本轮派发是否走通了健康链路 | A. 只查 tasks 表 status；B. 查 tasks payload 字段 + initiative_runs 行 host/phase 双重交叉 | B. 双重交叉（沿用 relay-4bb31ef5.sh 既有写法） | 只查 tasks.status 无法区分"走对了 skill-relay-claude-headed 路径"还是"走错分支但状态仍是 in_progress" | 误判会让 claude-headed 路由回归漏检，与旧 codex 分支混淆 |
| initiative_runs 行是否已产生（时序问题） | A. sleep/retry 等待；B. 直接查询，行不存在则 FAIL | B. 直接 FAIL（PRD 边界情况明确要求，不做 sleep/retry 掩盖） | PRD"边界情况"段显式约束 | sleep/retry 会掩盖真实的派发时序 bug，让回归测试失去意义 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `initiative_runs` 尚无本轮 task_id 对应行 | 脚本立即 FAIL（exit 非 0），不 sleep/retry | 否（PRD 边界情况明确禁止掩盖） | 无降级，视为回归失败 |
| Brain API 不可达（curl -f 失败） | `set -euo pipefail` 传播非 0 exit | 否 | 无降级，视为环境未就绪 = FAIL |
| `ci.yml` 分支优先级行号断言失败（claude-headed 未先于 codex 兜底）| 脚本 FAIL，输出具体行号 | 否 | 无降级，视为 #3829 修复被回归破坏 |

### 输入对抗面

N/A — 本 sprint 不对外暴露 agent/接口，仅新增只读校验脚本，无外部用户可写入的输入面。

## 禁 mock 边清单

（本单为新增只读校验脚本，不改调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，无接缝边改动，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A —— 全部验证命令直接打真实 Brain API（localhost:5221）与真实 PostgreSQL，无 force_*/stub/假数据）

## 真实调用方请求 shape

N/A —— 本 sprint 不涉及设备/agent 调服务端，验证方是脚本自身发起的 curl/psql 请求，非生产调用方。

---

## Golden Path
[Brain 定期派发 claude-headed-smoke 冒烟任务 cd0b936c] → [Sprint 产出绑定 cd0b936c 默认值的 e2e-verify.sh] → [脚本对真实 Brain/DB 执行全部既有验证项] → [负向路径：陌生 task_id 下脚本正确 FAIL 不掩盖] → [出口：脚本 exit 0 且输出确认信号]

### Step 1: Brain 已派发本轮 claude-headed-smoke 任务，payload/DB 状态可被真实验证
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步："Brain 按 journey_id=bb8cc561 定期派发 claude-headed-smoke 冒烟任务...本轮 task_id=cd0b936c-2891-4fed-a921-5636ca08d1e8"

**可观测行为**: `GET /api/brain/tasks/cd0b936c-...` 返回 `payload.mode=headed`、`payload.executor=claude`、`payload.orchestrator=skill-relay`；`initiative_runs` 表存在对应行 `orchestrator_host=skill-relay-claude-headed`

**验证命令**:
```bash
RESP=$(curl -sf "http://localhost:5221/api/brain/tasks/cd0b936c-2891-4fed-a921-5636ca08d1e8")
echo "$RESP" | jq -e '.payload.mode == "headed"'
echo "$RESP" | jq -e '.payload.executor == "claude"'
echo "$RESP" | jq -e '.payload.orchestrator == "skill-relay"'
```

**硬阈值**: 三项 jq -e 全部 exit 0（已实测确认，见合同调研记录）

---

### Step 2: Sprint 产出绑定本轮 task_id 的 e2e-verify.sh（对齐 relay-4bb31ef5.sh 结构，改默认值）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步 + "预期受影响文件"段："新增 `sprints/07151206-relay-cd0b936c/e2e-verify.sh`（对齐既有脚本结构，改绑本轮 task_id）"

**可观测行为**: `e2e-verify.sh` 文件存在，`TASK_ID` 默认值字面等于 `cd0b936c-2891-4fed-a921-5636ca08d1e8`，`SPRINT_DIR` 默认值字面等于 `sprints/07151206-relay-cd0b936c`，且包含 `claude-headed-dispatch-smoke.sh` 调用 + allowlist 检查 + ci.yml 分支优先级断言 + `initiative_runs` 查询

**验证命令**:
```bash
F="sprints/07151206-relay-cd0b936c/e2e-verify.sh"
[ -f "$F" ] || { echo "FAIL: $F 不存在"; exit 1; }
grep -q 'TASK_ID:-cd0b936c-2891-4fed-a921-5636ca08d1e8' "$F" || { echo "FAIL: TASK_ID 默认值未绑定本轮"; exit 1; }
grep -q 'SPRINT_DIR:-sprints/07151206-relay-cd0b936c' "$F" || { echo "FAIL: SPRINT_DIR 默认值未绑定本轮"; exit 1; }
grep -q 'claude-headed-dispatch-smoke.sh' "$F" || { echo "FAIL: 未复用 claude-headed-dispatch-smoke.sh"; exit 1; }
```

**硬阈值**: 文件存在 + 4 个 grep 全部命中

---

### Step 3: 脚本对真实 Brain/DB 执行既有验证项，全部 PASS
**来源**: `[FROM_PRD]` — PRD "E2E 验收"段列出的 5 个验收点

**可观测行为**: `bash e2e-verify.sh` 真实执行，对本轮 task_id 的 `initiative_runs` 行断言 `orchestrator_host=skill-relay-claude-headed` 且 `phase` 非 `failed`；`ci.yml` 中 claude-headed 判定分支行号仍先于 codex 兜底分支；allowlist 登记复用检查通过

**验证命令**:
```bash
cd /path/to/repo
BRAIN_URL=http://localhost:5221 \
  DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" \
  bash sprints/07151206-relay-cd0b936c/e2e-verify.sh
echo "exit=$?"
```

**硬阈值**: exit=0，stdout 含 `OK headed smoke regression verified for cd0b936c-2891-4fed-a921-5636ca08d1e8`

---

### Step 4: 边界情况 — 陌生 task_id 下脚本必须直接 FAIL，不 sleep/retry 掩盖
**来源**: `[AI_ADDED]` — PRD"边界情况"段明确要求："staging DB 里若本轮 task_id 的 initiative_runs 行尚未产生 → 脚本按 relay-4bb31ef5.sh 现有写法直接 FAIL，不做 sleep/retry 掩盖"，本步骤把该边界要求转成可机检断言，防止 generator 为图省事加 sleep/retry 掩盖真实时序 bug

**可观测行为**: 用不存在的 task_id 跑脚本，脚本 exit 非 0，且脚本运行耗时明显短（无 sleep 循环拖延）

**验证命令**:
```bash
START=$(date +%s)
TASK_ID=00000000-0000-0000-0000-000000000000 \
  BRAIN_URL=http://localhost:5221 \
  DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}" \
  bash sprints/07151206-relay-cd0b936c/e2e-verify.sh > /tmp/e2e-verify-neg.log 2>&1
CODE=$?
END=$(date +%s)
[ "$CODE" -ne 0 ] || { echo "FAIL: 陌生 task_id 未 FAIL"; exit 1; }
[ $((END-START)) -lt 15 ] || { echo "FAIL: 耗时 $((END-START))s，疑似 sleep/retry 掩盖"; exit 1; }
```

**硬阈值**: CODE ≠ 0 且耗时 < 15s

---

### Step 5: 出口 — 脚本产出可被 graduate-sprint-tests.mjs 正确识别（毕业路径预演，不实际执行毕业）
**来源**: `[AI_ADDED]` — PRD"可观测结果"段要求"Sprint 毕业后，`scripts/smoke/e2e/relay-cd0b936c.sh` 出现在 nightly 池"；`graduate-sprint-tests.mjs` 按目录名 slug 化（`07151206-relay-cd0b936c` → `relay-cd0b936c`）搬运 `e2e-verify.sh`，本步骤验证 sprint 目录命名与脚本产出路径与该毕业规则字面对齐，防止路径/命名偏差导致毕业后未被 nightly 池纳入（毕业动作本身不在本 sprint 范围内，由后续 report/generator 阶段执行）

**可观测行为**: `node scripts/graduate-sprint-tests.mjs --sprint sprints/07151206-relay-cd0b936c --dry-run` 的计划输出里，`e2e-verify.sh` 的目标路径字面等于 `scripts/smoke/e2e/relay-cd0b936c.sh`

**验证命令**:
```bash
node -e "
import('./scripts/graduate-sprint-tests.mjs').then(m => {
  const plan = m.planGraduation(process.cwd(), 'sprints/07151206-relay-cd0b936c');
  const e2e = plan.e2e[0];
  if (!e2e || e2e.to !== 'scripts/smoke/e2e/relay-cd0b936c.sh') {
    console.error('FAIL: 毕业目标路径不符', e2e);
    process.exit(1);
  }
  console.log('OK 毕业路径预演通过:', e2e.to);
});
"
```

**硬阈值**: exit 0，输出含 `OK 毕业路径预演通过: scripts/smoke/e2e/relay-cd0b936c.sh`

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -e

REPO_ROOT="$(pwd)"
SPRINT_DIR="sprints/07151206-relay-cd0b936c"
TASK_ID="cd0b936c-2891-4fed-a921-5636ca08d1e8"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"

# 1. e2e-verify.sh 存在且默认值绑定本轮 task_id
F="$SPRINT_DIR/e2e-verify.sh"
[ -f "$F" ] || { echo "FAIL: $F 不存在"; exit 1; }
grep -q "TASK_ID:-${TASK_ID}" "$F" || { echo "FAIL: TASK_ID 默认值未绑定本轮"; exit 1; }
grep -q "SPRINT_DIR:-${SPRINT_DIR}" "$F" || { echo "FAIL: SPRINT_DIR 默认值未绑定本轮"; exit 1; }

# 2. 正向：脚本对真实 Brain/DB 全流程执行，PASS
BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash "$F"
echo "[final-e2e] 正向执行 exit=$?"

# 3. 负向：陌生 task_id 必须 FAIL，且不 sleep/retry 掩盖（<15s）
START=$(date +%s)
set +e
TASK_ID=00000000-0000-0000-0000-000000000000 BRAIN_URL="$BRAIN_URL" DATABASE_URL="$DB" bash "$F" > /tmp/e2e-verify-neg.log 2>&1
NEG_CODE=$?
set -e
END=$(date +%s)
[ "$NEG_CODE" -ne 0 ] || { echo "FAIL: 陌生 task_id 未 FAIL"; exit 1; }
[ $((END-START)) -lt 15 ] || { echo "FAIL: 耗时 $((END-START))s，疑似 sleep/retry 掩盖"; exit 1; }

# 4. 毕业路径预演（命名 slug 对齐）
node -e "
import('./scripts/graduate-sprint-tests.mjs').then(m => {
  const plan = m.planGraduation(process.cwd(), '${SPRINT_DIR}');
  const e2e = plan.e2e[0];
  if (!e2e || e2e.to !== 'scripts/smoke/e2e/relay-cd0b936c.sh') {
    console.error('FAIL: 毕业目标路径不符', e2e);
    process.exit(1);
  }
  console.log('OK 毕业路径预演通过:', e2e.to);
});
"

echo "✅ Golden Path 验证通过（final-e2e, local_api）"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| e2e-verify.sh 默认值绑定 + 全流程可执行 | `tests/e2e-verify-contract.test.ts` | TASK_ID 默认值精确等于本轮 task_id（非照抄旧文件默认值）、SPRINT_DIR 默认值精确等于本轮 sprint 目录、e2e-verify.sh 全流程真实执行返回 OK headed smoke regression verified for cd0b936c、陌生 task_id 下脚本必须 FAIL（exit 非 0），不 sleep/retry 掩盖、relay-4bb31ef5.sh 未被修改（历史锚点保留） | → 4 failures（e2e-verify.sh 不存在） |

**gate-allow 记录**（Contract Gate 惯用法自查）：无需豁免，全部命令按"API 值断言/DB 时效防伪/负向测试捕获形态"标准写法。
