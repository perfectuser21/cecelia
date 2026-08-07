# Sprint PRD — 背靠背服务端裁剪 + 三 token 分权（D3）

task_id: 0b7df1ca-da50-4928-9d24-bfbb8ae7cd90
sprint_dir: sprints/w2-backtoback-d3
journey_type: autonomous
target_environment: local_api

---

## 背景

发版验收一体两面（GP `7790f728-f490-4243-b166-03f3250a0938`，v7-final）的第三交付物 D3——在 D1 数据层地基（AI 四列 + 36 格建单生成器 + 7 值状态机，cecelia 1.270.0）已并入主干的前提下，补齐员工填表期的背靠背保护：

- **服务端 SQL 列白名单**：`loadChecks` / `loadRunsWithChecks` 默认不 SELECT AI 四列（`ai_verdict`/`ai_evidence`/`ai_run_at`/`adjudication`），员工在填表期间无论经哪条通路都看不见 AI 列；
- **gp 级跨轮闸**：同 gp 存在活跃 run（`status IN ('pending','in_review')`，与 `loadPendingRuns` 同款谓词）时，该 gp 全部历史轮 AI 列 + `adjudication` 一并隐藏；
- **`view` 参数 + `human_complete` 服务端校验**：出口 3 默认态不带 AI 列，`?view=review` 仅在 run 已达 `human_complete` 时才解锁；
- **9 条读侧出口全覆盖 + 反向断言**：含出口 1（内网 5221 `/acceptance/pending`）、出口 2（`/runs?gp_id=`）、出口 3（`/runs/:run_key` 默认态）、合看态 403、出口 6（Staff Hub 反代）、出口 7（gate token 不回原文）、出口 8（产物不进 git）；
- **三 token 分权**：`createBearerAuth` 从 `acceptance-public-server.js` app 级下沉到路由级，`ACCEPTANCE_AI_TOKEN` 只管 `POST /acceptance/ai-results`，`ACCEPTANCE_GATE_TOKEN` 只管 `GET /acceptance/gate`，`ACCEPTANCE_API_TOKEN` 只管 `GET /acceptance/catalog`；任一 token 缺失只降级该端点（不挂载 + 启动日志告警），不拖挂整个 listener；
- **公网 5223 人列写端点休眠**：`POST /acceptance/results` 与 `GET /acceptance/pending` 解挂路由（不删码，决策 `fc7b5dc0` 休眠语义），上线前核查 5223 近 30 天访问日志确认无活跃调用方；
- **写侧断言**：AI token 打人列写端点必须 4xx；AI token 打 `ai-results` 夹带 `result`/`submitted_by` 字段，服务端忽略这两个字段，人列不变。

本任务纯服务端（`packages/brain`） curl/psql 验证，**零真机、零 UI**。

---

## 真机边界声明

本 sprint 不涉及任何真机、android、移动设备或物理设备操作。合同中出现「S12」「android」「staging」等名词均为规程格号引用，**全部验收动作通过 curl + psql 在本地完成**，零真机动作。theater 闸已语境化（决策 `457ab116`），本任务无需额外处理。

---

## Golden Path（核心场景）

员工登录 Staff Hub 查看待验收单 → 填表期间翻遍所有出口（包括 F12 查内网接口、公网反代接口）都看不到 AI 列 → 人列提交完毕 run 转 `human_complete` 后，`?view=review` 解锁 AI 列与裁决列可见。

具体断言路径：
1. [填表期] 存在活跃 run（`status IN ('pending','in_review')`），9 条读侧出口的响应体中 AI 四列字段个数 == 0
2. [gp 级闸] 同 gp 下同时存在 1 个 `adjudicated` run + 1 个活跃 run，历史轮（含已定案轮）也不得暴露 AI 列
3. [解锁] run 转 `human_complete` 后，出口 2 与出口 3 的 `?view=review` 返回 200 且含 AI 四列
4. [写侧分权] AI token → `POST /acceptance/results`（人列写端点）→ 4xx；gate token → `POST /acceptance/ai-results` → 401

---

## 边界情况

- `ACCEPTANCE_AI_TOKEN` 未注入：`POST /acceptance/ai-results` 端点不挂载（返回 404/401），**不得**让整个 5223 listener 起不来（决策 `fc7b5dc0`，P2-19）
- `ACCEPTANCE_GATE_TOKEN` 未注入：`GET /acceptance/gate` 端点不挂载，不阻塞其他端点
- `ACCEPTANCE_API_TOKEN` 未注入：`GET /acceptance/catalog` 不挂载；原来守全 router 的 `createBearerAuth(token)` 在 token=undefined 时会 throw，需先改为路由级按需挂载再分别判 token 非空
- 上线前核查 5223 访问日志：若发现非本 GP 的活跃调用方（Notion Worker 以外），改走候选 B（保持端点活跃但加强鉴权）并回报主理人
- 反向断言②（非活跃 run 不持锁）：`stale` / `expired` / `abandoned` 三种非活跃态，已定案轮的 `?view=review` 应返回 200 并含 AI 列（不被同 gp 的非活跃 run 遮挡）

---

## 范围限定

**在范围内（cecelia `packages/brain`）**：
- `packages/brain/src/routes/acceptance.js`：`loadChecks` / `loadRunsWithChecks` 添加 SQL 列白名单（默认排除 AI 四列）；`view` 参数处理 + `human_complete` 门控；gp 级跨轮闸（`status IN ('pending','in_review')` 谓词）；9 条读侧出口覆盖；内网 `GET /acceptance/pending` 保留（只清 AI 列），内网 `POST /results` 不动
- `packages/brain/src/acceptance-public-server.js`：`createBearerAuth` 职责限缩（app 级 → 路由级）；三 token 分权；`startAcceptancePublicServer` 容错改造（token 缺失 → 降级不崩）；公网 `POST /acceptance/results` 与 `GET /acceptance/pending` 解挂路由（不删码）
- 新增 `packages/brain/src/__tests__/acceptance-d3-backtoback.test.js`：含 9 条读侧 + 3 条反向断言 + 写侧 3 条
- CI：`brain-ci.yml` 覆盖新测试文件

**不在范围内**：
- 不改 `apps/`（Staff Hub / Dashboard）
- 不改 migrations（D1 已完成）
- 不改 `acceptance-ai.js`（D2 工作）
- 不实现合看页或裁决 API（D4 工作）
- 不实现放行闸（D5 工作）
- 不发布到生产，不跑 promote-all-prod.yml

---

## 假设

- [ASSUMPTION: D1 已并入主干（cecelia 1.270.0 / migration 392-393），`acceptance_checks` 表已有 `ai_verdict` / `ai_evidence` / `ai_run_at` 列，`acceptance_runs.status` CHECK 含 7 值状态机（含 `human_complete`）]
- [ASSUMPTION: 公网 5223 listener 当前以单 token 守全 router，`ACCEPTANCE_API_TOKEN` 守着包含人列写端点 `POST /acceptance/results` 在内的所有公网路由]
- [ASSUMPTION: `createBearerAuth` 当前在 `createAcceptancePublicApp` 内 app 级调用，token 为空时直接 throw 导致整个 listener 起不来]
- [ASSUMPTION: 近 30 天 5223 的 `/acceptance/pending` 与 `/acceptance/results` 无非本 GP 的活跃调用方（Notion Worker 已于 07-31 停摆，决策 `fc7b5dc0`）]

---

## 预期受影响文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/brain/src/routes/acceptance.js` | 修改 | `loadChecks`/`loadRunsWithChecks` 列白名单；`view` 参数门控；gp 级闸；9 出口覆盖 |
| `packages/brain/src/acceptance-public-server.js` | 修改 | `createBearerAuth` 下沉路由级；三 token 分权；容错启动；两端点解挂 |
| `packages/brain/src/__tests__/acceptance-d3-backtoback.test.js` | 新增 | D3 全套断言（读侧 + 反向 + 写侧） |
| `.github/workflows/brain-ci.yml` | 修改（可能） | 确认新测试文件在 CI 覆盖范围内 |

---

## FR（本 sprint 交付）

| # | 文件 | 变更描述 |
|---|------|---------|
| FR-1 | `routes/acceptance.js` · `loadChecks` | SQL 改为显式列（排除 `ai_verdict`/`ai_evidence`/`ai_run_at`/`adjudication` 四列）；当 `view=review` 且 run 已达 `human_complete` 时才包含这四列 |
| FR-2 | `routes/acceptance.js` · `loadRunsWithChecks` | 同 FR-1，`SELECT *` → 列白名单；gp 级跨轮闸：`GET /runs?gp_id=` 时若该 gp 下存在活跃 run，则全部 run 的 AI 四列 + `adjudication` 置空后返回（不依赖 `view` 参数） |
| FR-3 | `routes/acceptance.js` · `GET /runs/:run_key` | 默认态（无 `?view=review`）剥 AI 四列；`?view=review` 先检 `status == 'human_complete'`，不满足返 403 |
| FR-4 | `routes/acceptance.js` · 内网 `GET /acceptance/pending` | `loadPendingRuns` 结果中剥 AI 四列（员工看 pending list 期间不可见） |
| FR-5 | `acceptance-public-server.js` | `createBearerAuth` 从 app 级移到路由级；公网 `POST /acceptance/results` 不再挂载（解挂路由，不删函数）；公网 `GET /acceptance/pending` 不再挂载 |
| FR-6 | `acceptance-public-server.js` | 三 token 路由级分权：`ACCEPTANCE_AI_TOKEN` → `POST /acceptance/ai-results`；`ACCEPTANCE_GATE_TOKEN` → `GET /acceptance/gate`；`ACCEPTANCE_API_TOKEN` → `GET /acceptance/catalog`；token 缺失 → 不挂载该路由 + 启动告警，不抛不崩 |
| FR-7 | `routes/acceptance.js` · `POST /acceptance/ai-results` | 已由 `acceptance-ai.js` 实现（FR-7 = 校验该路由已受 `ACCEPTANCE_AI_TOKEN` 守卫且 `result`/`submitted_by` 被服务端过滤） |
| FR-8 | `__tests__/acceptance-d3-backtoback.test.js` | failing test 先入库：读侧 9 出口 + 反向断言 2 组 + 写侧 3 条（共 ≥14 个断言） |
| FR-9 | `brain-ci.yml` | 确认 `acceptance-d3-backtoback.test.js` 在 CI `include` 范围内，不手动排除 |

---

## 累积 FR（D1 已验收，本 sprint 不得回退）

以下行为由 D1（cecelia 1.270.0）已验收，本 sprint 不得回退：
- `acceptance_checks` 表含 `ai_verdict`/`ai_evidence`/`ai_run_at` 三列（migration 392）
- `acceptance_runs.status` CHECK 含 7 值状态机：`pending`/`in_review`/`human_complete`/`adjudicated`/`stale`/`expired`/`abandoned`
- `acceptance.js:88` 的三元式 `pass===total?'passed':'in_review'` 已替换为 `computeRunStatus`（`passed`/`failed` 退为历史兼容只读值）
- `POST /acceptance/ai-results` 端点已存在，且只吃 `ai_verdict`/`ai_evidence`/`ai_run_at`，`reason` 与静态属性的服务端校验已实现
- `reason='scenario_not_triggered'`（任何格）→ 400 拒收
- `UNIQUE (run_id, check_key)` 替换全局 UNIQUE；`submitAcceptanceResults` 全链路带 `run_id` 作用域

---

## NFR 约束

- **NFR-1 安全·默认隐藏**：所有读侧端点默认响应中不含 AI 四列字段；字段遗漏视为 P0。
- **NFR-2 安全·token 零崩**：任意单个 token env 变量缺失，整个 listener 必须正常启动（缺失的端点不挂载，其余端点可用）。
- **NFR-3 性能**：列白名单 SQL 改造不增加额外 JOIN，P99 读取延迟增量 < 5ms（只是减少 SELECT 列数，应有轻微降）。
- **NFR-4 可观测性**：token 缺失时启动日志打印 `[acceptance-public] ACCEPTANCE_*_TOKEN 未配置，端点 <name> 不挂载`；端点解挂时打印 `[acceptance-public] POST /acceptance/results 已休眠（决策 fc7b5dc0）`。
- **NFR-5 不删码**：公网端点函数体保留（`createAcceptancePublicRouter` 里的 handler 保留），只解挂路由注册，为将来外部集成留复活口（决策 `fc7b5dc0` 休眠语义）。
- **NFR-6 向后兼容**：内网 5221 `POST /acceptance/results` 行为不变（人列写，带 `run_key` 作用域）；内网 `GET /acceptance/pending` 只清 AI 列，其余字段不动。
- **NFR-7 回归保护**：新测试文件必须入 CI 回归，永久留存，不可在任何后续 PR 中删除。

---

## E2E 验收（Final E2E，local_api）

### 读侧——Active Run 期（员工填表期）

```bash
# 前提：构造一个活跃 run（status IN ('pending','in_review')）
GP_ID="<test-gp-id>"
RUN_KEY="<test-run-key>"
STAFF_HUB="http://100.86.118.99:8091"
BRAIN="http://localhost:5221"
AI_COLS="ai_verdict|ai_evidence|ai_run_at|adjudication"

# 出口1：内网 /acceptance/pending
test "$(curl -s "$BRAIN/api/brain/acceptance/pending" | grep -cE "$AI_COLS" || true)" = "0"

# 出口2：/runs?gp_id=（gp 级闸）
test "$(curl -s "$BRAIN/api/brain/acceptance/runs?gp_id=$GP_ID" | grep -cE "$AI_COLS" || true)" = "0"

# 出口3 默认态
test "$(curl -s "$BRAIN/api/brain/acceptance/runs/$RUN_KEY" | grep -cE "$AI_COLS" || true)" = "0"

# 出口3 合看态——活跃 run 时应 403
test "$(curl -s -o /dev/null -w '%{http_code}' "$BRAIN/api/brain/acceptance/runs/$RUN_KEY?view=review")" = "403"

# 出口7：gate token 不回 AI 原文（端点已用 ACCEPTANCE_GATE_TOKEN 守卫）
GATE_TOKEN="$ACCEPTANCE_GATE_TOKEN"
test "$(curl -s -H "Authorization: Bearer $GATE_TOKEN" "$BRAIN/api/brain/acceptance/gate?gp_id=$GP_ID" | grep -cE "$AI_COLS" || true)" = "0"

# 出口8：AI 产物不进 git
test "$(cd /workspace && git ls-files 'acceptance-spec/runs/*/ai-column.json' | grep -c "$RUN_KEY" || true)" = "0"
```

### 反向断言①（解锁）

```bash
# run 转 human_complete 后，出口2 与出口3 的 ?view=review 应含 AI 四列
# psql 直接更新测试 run status = 'human_complete'
psql -c "UPDATE acceptance_runs SET status='human_complete' WHERE run_key='$RUN_KEY'"

test "$(curl -s "$BRAIN/api/brain/acceptance/runs/$RUN_KEY?view=review" | grep -cE "$AI_COLS" || true)" != "0"
test "$(curl -s "$BRAIN/api/brain/acceptance/runs?gp_id=$GP_ID&view=review" | grep -cE "$AI_COLS" || true)" != "0"
```

### 反向断言②（非活跃 run 不持锁）

```bash
# 构造：同 gp 下 1 个 adjudicated run + 1 个 stale run（无活跃 run）
# adjudicated run 的 ?view=review 应返回 200 且含 AI 列
test "$(curl -s "$BRAIN/api/brain/acceptance/runs/$ADJUDICATED_RUN_KEY?view=review" | grep -cE "$AI_COLS" || true)" != "0"
test "$(curl -s -o /dev/null -w '%{http_code}' "$BRAIN/api/brain/acceptance/runs/$ADJUDICATED_RUN_KEY?view=review")" = "200"
# stale run 默认态不含 AI 列
test "$(curl -s "$BRAIN/api/brain/acceptance/runs/$STALE_RUN_KEY" | grep -cE "$AI_COLS" || true)" = "0"
# expired / abandoned 各跑一遍，结果一致
```

### 写侧——三 token 分权

```bash
# 出口10：AI token 打人列写端点（公网已休眠，断言 404 或 401，不得 2xx）
PUBLIC_5223="https://brain-acceptance.zenjoymedia.media"
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $ACCEPTANCE_AI_TOKEN" \
  "$PUBLIC_5223/acceptance/results" \
  -d '{"results":[{"check_key":"S3-c1","result":"通过"}]}')" != "200"

# 出口11：AI token 打 ai-results，body 夹带人列字段，服务端必须过滤
RUN_KEY_TEST="<active-test-run-key>"
curl -s -X POST -H "Authorization: Bearer $ACCEPTANCE_AI_TOKEN" \
  "$BRAIN/api/brain/acceptance/ai-results" \
  -H "Content-Type: application/json" \
  -d "{\"run_key\":\"$RUN_KEY_TEST\",\"results\":[{\"check_key\":\"S3-c1\",\"ai_verdict\":\"通过\",\"result\":\"通过\",\"submitted_by\":\"员工甲\"}]}"
# psql 复核：该格 result 仍为 NULL，submitted_by 仍为 NULL
psql -c "SELECT result, submitted_by FROM acceptance_checks WHERE run_key_scope='$RUN_KEY_TEST' AND check_key='S3-c1'"
# 断言：result IS NULL，submitted_by IS NULL

# 出口12：gate token 打任何 POST → 401
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $ACCEPTANCE_GATE_TOKEN" \
  "$PUBLIC_5223/acceptance/ai-results" \
  -H "Content-Type: application/json" \
  -d '{}')" = "401"
```

### 启动容错断言

```bash
# 验证 5223 listener 在三个 token 均已注入时正常启动
# 验证移除任一 token env 后，对应端点返回 404，其余端点仍可访问
```

---

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant（area 级），step + GP decisions，安全铁律 -->

- **[SQL列白名单默认隐藏]** 服务端读取路径默认不返回 AI 四列（`ai_verdict`/`ai_evidence`/`ai_run_at`/`adjudication`），必须显式传 `view=review` 且 run 已达 `human_complete` 才解锁；新增列不得绕过白名单自动泄露（J6 判据，决策 `fdeb48aa` ②）
- **[gp级跨轮闸活跃run谓词]** 跨轮 AI 列隐藏的判据必须用 `status IN ('pending','in_review')` 口径（与 `loadPendingRuns` 同款），不得用宽泛的「存在 run」判据——宽泛判据会让第一次 stale 之后该 gp 的人侧视图永久瞎（r4-P1-1，J2 判据②）
- **[createBearerAuth容错]** token 参数为空时不得 throw（现状），改为该路由不挂载 + 启动告警；三把钥匙任一缺失只降级该端点，不拖挂 listener（P2-19，决策 `fc7b5dc0`）
- **[公网端点休眠不删码]** 解挂路由实现为不注册 `app.use('/acceptance/results', ...)` 而非删函数体，保留代码与配置备将来外部集成（决策 `fc7b5dc0` 原文「转休眠」语义）
- **[上线前核日志]** `POST /acceptance/results` 与 `GET /acceptance/pending` 下线前必须核查 5223 近 30 天访问日志；若发现非预期活跃调用方，改走候选 B 并回报，不得跳过（D3 规格）
- **[AI token 不得持有人列写权]** `ACCEPTANCE_AI_TOKEN` 所对应的路由必须只挂 `POST /acceptance/ai-results`；`POST /acceptance/results`（人列写）在公网路由中不得被该 token 守卫（决策 `fdeb48aa` ②，r2-P0-3）
- **[写侧过滤]** `POST /acceptance/ai-results` handler 收到 `result` / `submitted_by` / `adjudication` 字段时，服务端必须静默忽略而非报错，并保证这三个字段不写入 DB（J19 三 token 分权落法表）
- **[端点鉴权]** 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area, id=50954d28）
- **[凭据安全]** secrets 不硬编码、不进 git、不进日志（来源: area, id=564802ee）
- **[租户隔离]** 碰租户数据的查询/写入必须 scope 到当前租户（来源: area, id=68976b17）
- **[failing test 先 commit]** FR-8 的 failing tests 必须在修复代码 commit 之前独立入库（来源: CLAUDE.md Bug Fix 流程）
- **[proposer起草涉及DB字段的合同前先psql核对]** 合同中列出的字段名必须先 `\d acceptance_checks` / `\d acceptance_runs` 核对真实列名（来源: area, id=e6513dff）

---

## 实施顺序

1. **上线前**：`curl` 查 5223 访问日志，确认近 30 天 `/acceptance/results` 与 `/acceptance/pending` 无非 GP 调用方；若有则停止并回报
2. **FR-8 先行**：写 `acceptance-d3-backtoback.test.js`，含全部 failing tests（读侧 9 出口 + 反向断言 + 写侧分权），独立 commit（格式：`test: D3 failing tests — SQL column allowlist + 3-token auth`）
3. **FR-1/2/3/4**：`routes/acceptance.js` 列白名单 + gp 级闸 + `view` 参数门控，failing test 转绿
4. **FR-5/6**：`acceptance-public-server.js` token 下沉路由级 + 三 token 分权 + 容错启动 + 两端点解挂，failing test 转绿
5. **FR-7 校验**：确认 `routes/acceptance-ai.js` 中 `POST /acceptance/ai-results` 的写侧过滤已到位（D1 已实现，本步仅校验）
6. **FR-9**：确认 `brain-ci.yml` 覆盖新测试
7. **整体 E2E**：按上方 Final E2E 脚本跑完读侧 + 反向 + 写侧全部断言，curl + psql 双证

---

## journey_type: autonomous
## journey_type_reason: 纯服务端 Brain API 改造，无用户可见 UI 交互；验收通过 curl localhost:5221 + psql 完成
## target_environment: local_api
## target_environment_reason: 验收信号来自本地 Brain API localhost:5221 与本地 PostgreSQL 查询，无需浏览器或远端 runner
## journey_id: 2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6
## step_id: 817f59f5-02ff-4a70-bd81-f7ae65f77e02
## gp_id: 7790f728-f490-4243-b166-03f3250a0938
