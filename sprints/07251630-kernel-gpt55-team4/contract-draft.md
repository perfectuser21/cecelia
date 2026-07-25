# Sprint Contract Draft (Round 1)

## 合同边界

- 冻结 PRD 是唯一功能边界；本 sprint 是 Kernel v1 GPT-5.5 lane4 canary，不新增业务能力。
- 唯一允许的产品交付文件是 `docs/fire-drills/kernel-v1-gpt55-team4-20260725.md`。
- 允许的 Harness 产物仅限本 sprint 目录下合同、DoD、tests、task-plan 等必要留痕。
- 严禁修改 `packages/**`、`apps/**`、`scripts/**`、`.github/**`、`config/**`、`database/**`、migration、测试基础设施、生产数据和共享配置。
- `contract-gate`: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。
- concern: generator 无法在 evaluator/judge 尚未执行前真实知道最终 PASS；合同将最终 PASS 作为 E2E/DB 真相验收，交付文档必须记录 verdict 字段和来源，禁止提前伪称已验。

## Response Schema（推导来源: PRD字面/api_registry推导）

N/A — 本任务无新增 HTTP 响应。验收对象是现有 `GET /api/brain/tasks/:id` 响应、PostgreSQL `harness_attempts`/`initiative_runs` 行、git/PR 状态和唯一交付文档内容。

既有 API registry 显示 `GET /:id` 任务详情端点位于 `packages/brain/src/routes/task-tasks.js:237`，字段命名沿用现有 snake_case/JSON payload 约定；DB schema 以 migration `357_harness_provider_attempts.sql` 和 `312_orchestrator_runs_state.sql` 为准。

## 已知约束（来自回归测试与累积 FR）

- `[回归测试] packages/brain/src/orchestrator/__tests__/dispatcher.test.js` -> role assignment 从 task payload 解析 provider/account，Codex account 映射为对应账号 home。
- `[回归测试] packages/brain/src/orchestrator/__tests__/attempt-store.test.js` -> attempt 写入 `harness_attempts`，run/hop 唯一。
- `[回归测试] packages/brain/src/orchestrator/providers/codex.test.js` -> Codex provider metadata 需包含可区分 session id。
- `[回归测试] packages/brain/src/workflows/__tests__/harness-initiative-b39.test.js` -> evaluator `.brain-result.json` 的 `verdict=PASS` 才能成为 evaluate verdict。
- `[回归测试] packages/brain/src/harness-judge.js` -> independent judge 保持 DeepSeek 裁判路径，judge PASS 不等于 Codex/GPT-5.5 角色。
- `[累积FR]` 本 line 暂无历史。
- `context-manifest: unavailable`（PRD 明确 `journey_id: none`，无可查询 line context）。

## 真实调用方请求 shape

真实调用方是 Kernel Harness orchestrator 对五个 agent role 的派发，不是本 sprint 新增 HTTP 调用方。已从任务 API 与 `packages/brain/src/orchestrator/dispatcher.js` 核对：

| 调用方 | 认证/入口 | 关键字段 shape |
|---|---|---|
| Task API 事实源 | `GET /api/brain/tasks/6449cebb-8f6f-4561-ba5f-350691bd6cec` | `payload.model == "gpt-5.5"`；`payload.executor == "codex"`；`payload.executor_account == "team4"`；`payload.role_assignments.<planner|proposer|reviewer|generator|evaluator>.provider == "codex"`；`account == "team4"`；`payload.target_environment == "local_api"` |
| Kernel dispatcher | `resolveAction(spawn:<role>)` -> `buildBundle()` -> `attemptStore.createAttempt()` | `role` 字面为 planner/proposer/reviewer/generator/evaluator；`provider` 写入 adapter name `codex`；`account_id` 写入 payload role assignment account；`task_bundle.execution.model` 写入 payload model |
| Attempt DB | `harness_attempts` | `run_id`、`hop`、`phase`、`role`、`provider`、`account_id`、`task_bundle`、`provider_session_id`、`status` |
| Judge | `spawn:judge` | `provider == "independent-judge"`，不要求 team4，不伪称 GPT-5.5 |

DoD 构造的请求必须逐字段沿用以上 shape；禁止把 account/model 改成 body 中另一套字段或只查文档字符串。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 跑完 planner/proposer/reviewer/generator/evaluator 五角色 canary；五角色 provider/account/model 可由 Brain/DB 交叉验证；generator 只交付 fire-drill 文档。 |
| **NFR（做得多好）** | 非功能需求 | 非破坏性；不改禁止路径；fresh session；CI/evaluator/judge 均为 PASS 后才可合并；Judge 保持 independent-judge/deepseek-v4-flash。 |
| **Invariant（永不违反）** | 安全/一致性 | 不写产品代码、不写生产数据、不泄露 secrets、不把未执行的 evaluator/judge 结果写成已 PASS。 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 数据/能力寿命 | 本 canary 证据按 task/run/PR 一次性有效；2026-07-25 lane4 以 `run_id=ee037a92-8061-4729-a67b-cc9fc7d9db56` 为唯一锚。 |
| **死亡告警（停了谁知道）** | 停止工作后的发现 | 任一 role attempt 缺失、CI/evaluator/judge 未 PASS、禁止路径 diff 出现时，DoD/E2E 非零退出，controller 不得 merge。 |
| **失败语义（挂了怎么办）** | 故障时策略 | fail closed：缺 Brain/DB/gh、缺 attempt、字段不匹配、PR diff 越界或 verdict 缺失均 FAIL；不降级为 warning。 |
| **效果确认（已发不等于已生效）** | 生效回执 | 交付文档内容 + Brain task payload + `harness_attempts` 五角色 + `initiative_runs.evaluate_verdict/judge_verdict` + PR checks 五方交叉确认。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 五角色是否真的走 Codex team4 | A. 看交付文档声明；B. 查 `harness_attempts.provider/account_id` | B. 查 DB 事实行，文档只作交叉证据 | dispatcher 写入 DB 是运行事实源 | 错把文本自证当真实路由，canary 假绿 |
| fresh session 是否成立 | A. 只数 attempt；B. 要求五角色 provider_session_id 非空且互不相同 | B. session id 去重 | Kernel v1 fresh_session 是任务约束 | 角色复用旧会话，隔离性未验 |
| ⚠️ evaluator/judge 是否最终 PASS | A. generator 文档提前写 PASS；B. 以 `initiative_runs.evaluate_verdict/judge_verdict` 和 judge attempt 为最终真相 | B. DB verdict 为权威，文档必须记录字段来源且不得提前伪称 | generator 无法知道未来裁决 | 静默合并未经双门验收的 PR |
| PR diff 是否非破坏性 | A. 人工看 PR；B. `git diff --name-only base...HEAD` 机械 allowlist | B. 机械 allowlist + gh checks | PRD 严格限定唯一产品文件 | 产品代码/配置被偷偷改动 |

judgment-pending-user: evaluator/judge 最终 PASS 不应由 generator 预填；本合同以 DB verdict 为权威，若必须要求文档内最终 PASS 字面值，需要 controller 在 judge 后补证据，而非 generator 伪造。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| Brain API 不可达 | E2E 非零退出 | 是，恢复 Brain 后可重跑 | 无降级 |
| DB 不可达或表缺失 | E2E 非零退出 | 是，恢复 DB 后可重跑 | 无降级 |
| 任一角色缺 attempt 或 account/model 不匹配 | E2E 非零退出 | 否，需要重新跑对应 role | 不允许人工改文档兜过 |
| provider_session_id 重复或为空 | E2E 非零退出 | 否，需要 fresh session 重派 | 不允许忽略隔离约束 |
| generator 交付文件缺字段/PR URL | 测试与 E2E 非零退出 | 是，补文档后重跑 | 不允许用 DB 结果替代文档留痕 |
| PR diff 含禁止路径 | E2E 非零退出 | 是，revert 禁止路径后重跑 | 不允许审查豁免 |
| CI/evaluator/judge 未 PASS | merge gate 失败 | 是，修复后重跑 | 不允许提前 merge |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 不新增对外 agent/API，也不处理外部用户可写输入。唯一外部输入是既有 task payload，验收按只读方式核对字段，不执行其中任意命令文本。

## 禁 mock 边清单

- Kernel Harness dispatcher -> `harness_attempts`（本 sprint 验证 role/provider/account/model/fresh session 接缝，DoD 必须真查 PostgreSQL，不得 mock attemptStore）。
- Task API -> task payload（DoD 必须真打 `GET /api/brain/tasks/:id`，不得用本地 fixture 代替）。
- PR branch -> GitHub checks/PR URL（DoD/E2E 必须真查 git/gh 现状，禁止只 grep 文档）。

## 接缝清单

- Brain API 接缝：真实 `localhost:5221` task payload 暴露 model/role_assignments；E2E 用 curl+jq 断言。
- PostgreSQL 接缝：真实 `harness_attempts` 和 `initiative_runs` 行暴露五角色执行与 verdict；E2E 用 psql 时间窗/定点查询断言。
- GitHub PR 接缝：真实 PR URL 与 checks 暴露可合并性；E2E 用 gh 和 git diff allowlist 断言。

## 未覆盖真实链路清单

- 本合同无 mock 豁免，N/A。
- concern: generator 不能真实记录未来 evaluator/judge PASS；最终 PASS 必须由 evaluator/judge 后的 DB/PR 真相确认，交付文档不得用预填 PASS 冒充真验。

## Golden Path

独立小路（无父路）

[task payload] -> [五角色 fresh session 接力] -> [generator 只写 fire-drill 文档] -> [DB/CI/evaluator/judge 全 PASS] -> [PR 可合并]

### Step 1: Harness 读取 task payload 并锁定 GPT-5.5/team4 路由

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条与 task payload 明确 `model=gpt-5.5`、五个 role assignment 为 `provider=codex/account=team4`。

**可观测行为**: 真实 Brain task API 返回 payload 中 model、executor_account、role_assignments 与 PRD 字面一致。

**验证命令**:
```bash
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TASK_ID="${TASK_ID:-6449cebb-8f6f-4561-ba5f-350691bd6cec}"
TASK_JSON=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$TASK_JSON" | jq -e '.payload.model == "gpt-5.5"'
echo "$TASK_JSON" | jq -e '.payload.executor == "codex" and .payload.executor_account == "team4"'
for role in planner proposer reviewer generator evaluator; do
  echo "$TASK_JSON" | jq -e --arg role "$role" '.payload.role_assignments[$role].provider == "codex" and .payload.role_assignments[$role].account == "team4"'
done
```

**硬阈值**: 五个 role 的 provider/account 全部逐字匹配；payload model 逐字等于 `gpt-5.5`；任一字段缺失或不同即 FAIL。

### Step 2: planner/proposer/reviewer/generator/evaluator 以 fresh session 完成接力

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条。

**可观测行为**: `harness_attempts` 中五个角色均出现，provider/account 为 codex/team4，status 为终态成功集合，且五个 `provider_session_id` 非空且互不相同。

**验证命令**:
```bash
DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://localhost/cecelia}}"
RUN_ID="${RUN_ID:-ee037a92-8061-4729-a67b-cc9fc7d9db56}"
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 && [ "$DB_URL" = "postgresql://localhost/cecelia" ]; then
  DB_URL="postgresql://host.docker.internal/cecelia"
fi
ROLE_COUNT=$(psql "$DB_URL" -tAc "SELECT count(DISTINCT role) FROM harness_attempts WHERE run_id='$RUN_ID'::uuid AND role IN ('planner','proposer','reviewer','generator','evaluator') AND provider='codex' AND account_id='team4' AND status IN ('completed','completed_with_concerns') AND created_at > NOW() - interval '7 days'")
[ "$ROLE_COUNT" = "5" ] || { echo "FAIL: codex/team4 success roles=$ROLE_COUNT"; exit 1; }
SESSION_COUNT=$(psql "$DB_URL" -tAc "SELECT count(DISTINCT provider_session_id) FROM harness_attempts WHERE run_id='$RUN_ID'::uuid AND role IN ('planner','proposer','reviewer','generator','evaluator') AND provider_session_id IS NOT NULL AND created_at > NOW() - interval '7 days'")
[ "$SESSION_COUNT" = "5" ] || { echo "FAIL: fresh sessions=$SESSION_COUNT"; exit 1; }
```

**硬阈值**: role_count = 5；distinct non-null provider_session_id = 5；任一角色缺失、非 codex/team4、非成功终态或复用 session 即 FAIL。

### Step 3: generator 只交付 fire-drill 文档

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条与范围限定。

**可观测行为**: `docs/fire-drills/kernel-v1-gpt55-team4-20260725.md` 存在，包含 task id、run id、payload model、五角色 provider/account、PR URL、evaluator/judge verdict 字段和 Judge 模型说明；文档不得含 secret。

**验证命令**:
```bash
DOC="docs/fire-drills/kernel-v1-gpt55-team4-20260725.md"
node -e "const fs=require('fs');const p='$DOC';if(!fs.existsSync(p))throw new Error('missing '+p);const c=fs.readFileSync(p,'utf8');for(const s of ['6449cebb-8f6f-4561-ba5f-350691bd6cec','ee037a92-8061-4729-a67b-cc9fc7d9db56','gpt-5.5','planner','proposer','reviewer','generator','evaluator','provider=codex','account=team4','PR URL','evaluator','judge','deepseek-v4-flash']){if(!c.includes(s))throw new Error('missing '+s)}if(/ghp_|gho_|ghs_|github_pat_|sk-[A-Za-z0-9]/.test(c))throw new Error('secret leaked');"
```

**硬阈值**: 文档存在且字段全；不含 GitHub/OpenAI token 形态；不得用「judge 使用 GPT-5.5」等错误表述。

### Step 4: PR diff 保持非破坏性且 CI/evaluator/judge 出口全 PASS

**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条与边界情况。

**可观测行为**: PR diff 只包含允许路径；`initiative_runs` 对当前 run 写入 PR URL、evaluate_verdict=PASS、judge_verdict=PASS；judge attempt provider 为 independent-judge；PR required checks 通过。

**验证命令**:
```bash
DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://localhost/cecelia}}"
RUN_ID="${RUN_ID:-ee037a92-8061-4729-a67b-cc9fc7d9db56}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07251630-kernel-gpt55-team4}"
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 && [ "$DB_URL" = "postgresql://localhost/cecelia" ]; then
  DB_URL="postgresql://host.docker.internal/cecelia"
fi
PR_URL=$(psql "$DB_URL" -tAc "SELECT COALESCE(pr_url,'') FROM initiative_runs WHERE id='$RUN_ID'::uuid" | tr -d ' ')
[ -n "$PR_URL" ] || { echo "FAIL: initiative_runs.pr_url empty"; exit 1; }
psql "$DB_URL" -tAc "SELECT evaluate_verdict='PASS' AND judge_verdict='PASS' FROM initiative_runs WHERE id='$RUN_ID'::uuid" | grep -qx t || { echo "FAIL: evaluator/judge verdict not PASS"; exit 1; }
psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$RUN_ID'::uuid AND role='judge' AND provider='independent-judge' AND status IN ('completed','completed_with_concerns') AND created_at > NOW() - interval '7 days'" | grep -qx 1 || { echo "FAIL: independent judge attempt missing"; exit 1; }
git fetch origin main >/dev/null 2>&1
BASE_REF="${BASE_REF:-origin/main}"
git rev-parse --verify "$BASE_REF^{commit}" >/dev/null 2>&1 || { echo "FAIL: base ref missing"; exit 1; }
DIFF_FILES=$(git diff --name-only "$BASE_REF"...HEAD)
UNEXPECTED=$(printf '%s\n' "$DIFF_FILES" | awk -v sprint="$SPRINT_DIR" 'NF && $0 !~ ("^(docs/fire-drills/kernel-v1-gpt55-team4-20260725\\.md|" sprint "/)") { print }')
[ -z "$UNEXPECTED" ] || { echo "FAIL: forbidden diff"; printf '%s\n' "$UNEXPECTED"; exit 1; }
gh pr view "$PR_URL" --json url --jq '.url' | grep -q '^https://github.com/' || { echo "FAIL: PR URL invalid"; exit 1; }
gh pr checks "$PR_URL" --required --watch --interval 10 --fail-fast
```

**硬阈值**: PR URL 非空；evaluate_verdict=PASS；judge_verdict=PASS；judge provider=independent-judge；diff 仅允许 fire-drill 文档与本 sprint Harness 产物；required checks 全绿。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

TASK_ID="${TASK_ID:-6449cebb-8f6f-4561-ba5f-350691bd6cec}"
RUN_ID="${RUN_ID:-ee037a92-8061-4729-a67b-cc9fc7d9db56}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07251630-kernel-gpt55-team4}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://localhost/cecelia}}"
DOC="docs/fire-drills/kernel-v1-gpt55-team4-20260725.md"

curl -sf "$BRAIN_URL/api/brain/health" | jq -e '.status == "healthy" or .status == "ok"' >/dev/null
TASK_JSON=$(curl -sf "$BRAIN_URL/api/brain/tasks/$TASK_ID")
echo "$TASK_JSON" | jq -e '.payload.model == "gpt-5.5"' >/dev/null
echo "$TASK_JSON" | jq -e '.payload.executor == "codex" and .payload.executor_account == "team4"' >/dev/null
echo "$TASK_JSON" | jq -e '.payload.target_environment == "local_api"' >/dev/null
for role in planner proposer reviewer generator evaluator; do
  echo "$TASK_JSON" | jq -e --arg role "$role" '.payload.role_assignments[$role].provider == "codex" and .payload.role_assignments[$role].account == "team4"' >/dev/null
done

if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 && [ "$DB_URL" = "postgresql://localhost/cecelia" ]; then
  DB_URL="postgresql://host.docker.internal/cecelia"
fi
psql "$DB_URL" -tAc "SELECT 1 FROM harness_attempts LIMIT 1" >/dev/null

ROLE_COUNT=$(psql "$DB_URL" -tAc "SELECT count(DISTINCT role) FROM harness_attempts WHERE run_id='$RUN_ID'::uuid AND role IN ('planner','proposer','reviewer','generator','evaluator') AND provider='codex' AND account_id='team4' AND status IN ('completed','completed_with_concerns') AND created_at > NOW() - interval '7 days'")
[ "$ROLE_COUNT" = "5" ] || { echo "FAIL: expected 5 codex/team4 roles, got $ROLE_COUNT"; exit 1; }

SESSION_COUNT=$(psql "$DB_URL" -tAc "SELECT count(DISTINCT provider_session_id) FROM harness_attempts WHERE run_id='$RUN_ID'::uuid AND role IN ('planner','proposer','reviewer','generator','evaluator') AND provider_session_id IS NOT NULL AND created_at > NOW() - interval '7 days'")
[ "$SESSION_COUNT" = "5" ] || { echo "FAIL: expected 5 fresh sessions, got $SESSION_COUNT"; exit 1; }

psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='$RUN_ID'::uuid AND role='judge' AND provider='independent-judge' AND status IN ('completed','completed_with_concerns') AND created_at > NOW() - interval '7 days'" | grep -qx 1 || { echo "FAIL: independent judge attempt missing"; exit 1; }
psql "$DB_URL" -tAc "SELECT evaluate_verdict='PASS' AND judge_verdict='PASS' FROM initiative_runs WHERE id='$RUN_ID'::uuid" | grep -qx t || { echo "FAIL: evaluate/judge verdict not PASS"; exit 1; }
PR_URL=$(psql "$DB_URL" -tAc "SELECT COALESCE(pr_url,'') FROM initiative_runs WHERE id='$RUN_ID'::uuid" | tr -d ' ')
[ -n "$PR_URL" ] || { echo "FAIL: PR URL missing in initiative_runs"; exit 1; }

node -e "const fs=require('fs');const p='$DOC';if(!fs.existsSync(p))throw new Error('missing '+p);const c=fs.readFileSync(p,'utf8');for(const s of ['$TASK_ID','$RUN_ID','gpt-5.5','planner','proposer','reviewer','generator','evaluator','provider=codex','account=team4','PR URL','evaluator','judge','deepseek-v4-flash']){if(!c.includes(s))throw new Error('doc missing '+s)}if(!c.includes('$PR_URL'))throw new Error('doc missing current PR URL');if(/ghp_|gho_|ghs_|github_pat_|sk-[A-Za-z0-9]/.test(c))throw new Error('secret leaked');"

git fetch origin main >/dev/null 2>&1
BASE_REF="${BASE_REF:-origin/main}"
git rev-parse --verify "$BASE_REF^{commit}" >/dev/null 2>&1 || { echo "FAIL: base ref missing"; exit 1; }
DIFF_FILES=$(git diff --name-only "$BASE_REF"...HEAD)
UNEXPECTED=$(printf '%s\n' "$DIFF_FILES" | awk -v sprint="$SPRINT_DIR" 'NF && $0 !~ ("^(docs/fire-drills/kernel-v1-gpt55-team4-20260725\\.md|" sprint "/)") { print }')
[ -z "$UNEXPECTED" ] || { echo "FAIL: forbidden diff files"; printf '%s\n' "$UNEXPECTED"; exit 1; }

gh pr view "$PR_URL" --json url --jq '.url' | grep -q '^https://github.com/' || { echo "FAIL: gh cannot read PR URL"; exit 1; }
gh pr checks "$PR_URL" --required --watch --interval 10 --fail-fast

echo "OK: Kernel v1 GPT-5.5 team4 canary verified"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| fire-drill 文档 | `sprints/07251630-kernel-gpt55-team4/tests/kernel-gpt55-canary.test.ts` | fire-drill 文档存在并记录 task/run/model/roles | 生成前文档不存在，测试 FAIL |
| fire-drill 文档 | `sprints/07251630-kernel-gpt55-team4/tests/kernel-gpt55-canary.test.ts` | fire-drill 文档记录 PR URL 与 verdict 字段 | 生成前文档不存在或缺字段，测试 FAIL |
| 非破坏性边界 | `sprints/07251630-kernel-gpt55-team4/tests/kernel-gpt55-canary.test.ts` | fire-drill 文档不得泄露 secret | 生成前文档不存在，测试 FAIL |

## notes

- target_environment: local_api。
- 第三方 API: 无新增第三方业务 API；`gh` 仅用于真实 PR/checks 读取。
- mock: 本合同无 mock 豁免。
- generator 不得修改本 sprint tests 文件来迁就实现；tests 是 Red 合同产物。
