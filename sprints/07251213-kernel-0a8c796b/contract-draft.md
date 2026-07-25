# Sprint Contract Draft (Round 3)

## 合同边界

- PRD 是唯一功能边界；本合同不引入新 API、自动 migration、自动清库或自动 merge。
- 本轮仅定义实现与非破坏性验收。生产 migration、存量删除和第 7 天抽检均由主 session 在独立评审通过后执行。
- `contract-gate`: enabled（`packages/brain/src/lib/contract-gate.js` 存在）。

## Response Schema（推导来源: PRD字面）

N/A — 本任务无 HTTP 响应。对外可观测契约是 PostgreSQL 表、启动命令环境、capture/working_memory 数据和脚本退出码。

Registry 非空但无本任务 HTTP schema；`db_schema` 已确认现有 `captures`，`test` registry 未提供比冻结 PRD 更高优先级的字段约束，因此字段继续逐字采用 PRD。

## 已知约束（来自回归测试与累积 FR）

- `[回归测试] packages/brain/src/__tests__/conversation-capture-claude.test.js` → `-private-tmp-` 项目目录必须继续被排除，真实项目目录继续保留。
- `[回归测试] packages/brain/src/__tests__/conversation-capture-codex.test.js` → 同一历史文件内按 `session_id` 正确分组，跨账号目录聚合。
- `[回归测试] packages/brain/src/__tests__/conversation-capture-grok.test.js` → 按 `session_id` 分组，缺目录时不抛异常。
- `[回归测试] packages/brain/src/__tests__/conversation-capture.test.js` → dedupe key 只绑定 source/sessionId，摘要失败返回 null 而不抛出。
- `[回归测试] packages/brain/src/__tests__/integration/conversation-capture.integration.test.js` → 闲置阈值、固定回看窗口、多轮重扫不重复付费、复聊更新不新增、pushCapture 返回 null 时计入 errors。
- `[回归测试] packages/brain/src/__tests__/headed-dispatch.test.js` → headed Claude 必须走 `claude-launch.sh`，不注入 CODEX_HOME，且保留 evaluator gate 所需的 HARNESS 环境。
- `[累积FR]` 本 line 暂无历史。
- `context-manifest: unavailable`（PRD 未提供有效 journey_id，`/api/brain/line/none/context-manifest` 返回不可用）。

## 真实调用方请求 shape

本任务无 HTTP 调用方，认证方式 N/A。生产进程调用 shape 必须逐字保持如下：

| 调用方 | 入口 | 环境/字段 |
|---|---|---|
| Alex 交互 alias | `bash scripts/claude-launch.sh ...`，stdin/stdout 均为 TTY | 无 `CECELIA_DISPATCH`；launcher 生成/继承 `CLAUDE_SESSION_ID` |
| Brain 无头派发 | `packages/brain/scripts/cecelia-run.sh` 首次 attempt 调 `claude-launch.sh` | `CECELIA_DISPATCH=1`、`CECELIA_LAUNCHED_BY=cecelia-run`、`HARNESS_TASK_ID=<uuid>`、稳定 `CLAUDE_SESSION_ID` |
| headed Claude relay | `harness-skill-relay.js` 生成 tmux `innerCmd` 调 `claude-launch.sh` | `CECELIA_DISPATCH=1`、`CECELIA_LAUNCHED_BY=skill-relay-claude-headed`、`HARNESS_TASK_ID=<uuid>` |
| capture scheduler | `runConversationCapture(pool, {llm})` | 在 idle 过滤后以全部不同 `session_id` 执行一次 `WHERE session_id = ANY($1::text[])` |

`CECELIA_DISPATCH=1` 优先于 TTY；`task_id` 只接受 UUID，空值写 NULL。不得另造 body 参数或第二套 provenance 判定路径。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 启动端声明 session 出处；采集端只放行已登记 human；machine/unknown 可观测跳过；提供显式清理 SOP。 |
| **NFR（做得多好）** | 性能/可靠性 | launcher DB 连接上限 2 秒且失败不阻塞；每轮仅一次批量 provenance 查询；migration 幂等；默认失败关闭。 |
| **Invariant（永不违反）** | 安全/一致性 | 首次声明不可覆盖；只有 human 可进入 dedupe/push/summary；查询失败整轮零捕获；生产删除绝不自动触发。 |
| **判定点（怎么知道）** | 现实状态判断 | 见下方登记表。 |
| **保质期（何时过期）** | 数据/能力寿命 | provenance 行与 session_id 同寿命，当前不自动退役；第 7 天验收是一次性观察窗，后续清理由另案处理。 |
| **死亡告警（停了谁知道）** | 停止工作后的发现 | sentinel 每轮记录 lookup failure、errors 与跳过计数；查询失败立即可见；连续失败告警沿既有后台 job 监控，不新增通知链。 |
| **失败语义（挂了怎么办）** | 放行/拦截/重试 | 注册失败不阻塞 Claude但后续漏采；查询失败整轮拦截；清理备份失败时 DELETE 前终止。 |
| **效果确认（已发≠已生效）** | 真实生效回执 | real-PG 查询 provenance/captures/working_memory；清理记录 backup path 与 before/backed_up/deleted/after；第 7 天人工抽检。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ session 是否为机器派发 | A. cwd/role 黑名单；B. 启动端 `CECELIA_DISPATCH=1` 声明 | B. 启动端声明优先 | PRD 已由 Alex 拍板；启动端掌握真实来源 | 把机器 prompt 当人声灌入收件箱 |
| ⚠️ session 是否为人类交互 | A. 仅 TTY；B. 无派发标记且 stdin/stdout 均为 TTY | B. 双 TTY 且 env 优先 | 覆盖交互 alias，同时避免无头未知来源放行 | 误放机器内容或漏采 Alex 输入 |
| provenance 是否允许采集 | A. 未登记默认 human；B. 仅 `kind='human'` allowlist | B. 显式 allowlist | 三次复发证明黑名单不可靠 | 未知会话再次污染 captures |
| 清理是否可继续 | A. 有命令即删；B. `--confirm` 且仓外 CSV 非空/行数一致 | B. 备份成功后限定删除 | PRD 数据安全边界 | 不可恢复删除或误删其他 source |

上述两个 ⚠️ 判定点已在本 PRD 的 Alex 拍板中明确，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| launcher INSERT 连接/SQL 失败 | 吞掉登记错误并继续启动 Claude；该 session 后续因未登记被跳过 | 是；`ON CONFLICT DO NOTHING` 保持首次声明 | 宁可漏采，不放机器噪音 |
| provenance 批量查询失败 | 本轮所有 session 均不进入 dedupe/push/summary，`errors` 增加且 `provenance_lookup_failed=true` | 下个扫描周期可重试 | 整轮 fail closed |
| raw/summary capture 写入失败 | 保持既有失败计数语义，不把失败当成功 | dedupe key 保证重扫幂等 | 下轮可重扫 |
| 清理备份失败/备份空 | DELETE 前非零退出 | 人工修复后可重新执行 | 不删除任何 captures |
| 生产部署失败 | 非零失败，不降级为 warning | 按正常部署恢复流程 | 不执行后续 7 天验收计时 |

### 输入对抗面

N/A — 本任务不新增对外 agent/API；transcript 正文沿既有本地适配器进入 capture，且本改动不把正文或凭据写入日志。

## Golden Path

独立小路（无父路）

[登记表] → [启动端声明] → [机器派发透传] → [闲置批量核验] → [失败关闭并记哨兵] → [多适配器回归] → [主 session 清理与 7 天复查]

### Step 1: 建立 session_provenance 出处登记表

**来源**: `[FROM_PRD]` — PRD 第 18、48、60-64 行。

**可观测行为**: 真 PostgreSQL 可写入 human/machine，非法 kind 被 CHECK 拒绝，`task_id` 为可空 UUID；同一 migration 重跑成功且同一 session 首次声明不被覆盖。

**验证命令**:
```bash
cd packages/brain
DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run src/__tests__/integration/session-provenance.integration.test.js
```

**硬阈值**: 测试 exit code = 0；human/machine 各 1 行；非法 kind 被拒绝；migration 连续应用 2 次均成功。

### Step 2: Claude launcher 声明 human/machine/unknown

**来源**: `[FROM_PRD]` — PRD 第 19、28、30-31、49、60-61 行。

**可观测行为**: dispatch env 优先登记 machine；双 TTY 且无 dispatch 登记 human；无 TTY/无声明不登记；dry-run 不写库；psql 两秒内失败仍启动 fake Claude。

**验证命令**:
```bash
bash -n scripts/claude-launch.sh
bash scripts/__tests__/claude-launch-session-provenance.test.sh
DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run \
  --config sprints/07251213-kernel-0a8c796b/vitest.config.mjs \
  tests/live/kernel-0a8c796b/launcher-provenance.contract.test.ts
```

**硬阈值**: 三条命令 exit code = 0；fake-psql 分支覆盖 machine/human/unknown/dry-run/失败继续启动；真 PostgreSQL 回读必须逐字等于 `session_id|machine|cecelia-run|task_id`；每次可判定启动至多一次 INSERT；连接上限 `PGCONNECT_TIMEOUT=2`。

### Step 3: 所有已知 Claude 派发路径透传 machine 声明

**来源**: `[FROM_PRD]` — PRD 第 20、50-51、60-61 行。

**可观测行为**: cecelia-run 首次 attempt 与 headed Claude tmux 命令均把 task UUID、派发标记、启动方传给真实 launcher；resume 不重复登记；Codex/Grok 不伪造 human 声明。

**验证命令**:
```bash
TEST_TASK_ID="00000000-0000-4000-8000-00000000cafe"
DRY_OUTPUT=$(bash packages/brain/scripts/cecelia-run.sh --dry-run \
  "$TEST_TASK_ID" checkpoint-contract /tmp/prompt-contract)
printf '%s\n' "$DRY_OUTPUT" | grep -Fq 'CECELIA_DISPATCH=1'
printf '%s\n' "$DRY_OUTPUT" | grep -Fq 'CECELIA_LAUNCHED_BY=cecelia-run'
printf '%s\n' "$DRY_OUTPUT" | grep -Fq "HARNESS_TASK_ID=$TEST_TASK_ID"
printf '%s\n' "$DRY_OUTPUT" | grep -Fq 'claude-launch.sh'
npx vitest run \
  --config sprints/07251213-kernel-0a8c796b/vitest.config.mjs \
  tests/regression/kernel-0a8c796b/dispatch-provenance.contract.test.ts
```

**硬阈值**: 每条 grep 与 Vitest exit code = 0；dry-run 和 headed `innerCmd` 均逐字包含三个 provenance env 字段及真实 launcher；首次 attempt 仅一次声明；既有 HARNESS_NODE/evaluator gate 环境不回退。

### Step 4: 闲置批次只放行 human 并保持原始+摘要

**来源**: `[FROM_PRD]` — PRD 第 21、28-30、52、61 行。

**可观测行为**: idle 后对不同 session_id 只发一次真实 PostgreSQL 批量查询；仅 human 进入既有 dedupe、raw capture、summary capture；混合批次只处理 human。

**验证命令**:
```bash
DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run \
  --config sprints/07251213-kernel-0a8c796b/vitest.config.mjs \
  tests/live/kernel-0a8c796b/conversation-human-gate.contract.test.ts
cd packages/brain
DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run \
  src/__tests__/conversation-capture-human-gate.test.js \
  src/__tests__/integration/conversation-capture.integration.test.js \
  -t "registered human|mixed batch|原始文本"
```

**硬阈值**: 测试 exit code = 0；混合批次 `sessions_processed=human 数`；human 产生 nature=NULL 与 `session_summary` 各 1 行；provenance SELECT 每轮 = 1 次；`local_api` 终验必须设置 `RUN_LIVE_HAIKU=1`，通过生产 `callLLM` 的真实 Anthropic transport 请求 `claude-haiku-4-5-20251001`（默认 Claude Code 订阅 bridge；可显式选择 `anthropic-api`），响应 `text` 非空且五分钟窗内 summary capture 内容匹配 `^1\.\s+\S+`；终验凭据不可用直接 FAIL，不 SKIP。PRD 只要求真 Haiku 摘要，不授权把直付 API 运输层写成唯一合同。

### Step 5: machine、unknown 与查询故障失败关闭且可观测

**来源**: `[FROM_PRD]` — PRD 第 22、28-31、63-64 行。

**可观测行为**: machine/unknown 均零 capture；分别增加 skipped 计数；lookup error 时零 dedupe、零 push、零 LLM，并写入完整 sentinel。

**验证命令**:
```bash
cd packages/brain
DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run src/__tests__/conversation-capture-human-gate.test.js -t "registered machine|unregistered|provenance query error"
```

**硬阈值**: 测试 exit code = 0；`pushed=0`；LLM 调用数 = 0；sentinel 含六个指定字段；lookup error 时 `errors>=1`。

### Step 6: Codex/Grok 失败关闭且既有采集约束不回退

**来源**: `[FROM_PRD]` — PRD 第 23、37-39、54 行。

**可观测行为**: 未登记 Codex/Grok worker 零 capture；Claude `-private-tmp-`、idle、dedupe、复聊、多轮扫描与错误计数回归均保持。

**验证命令**:
```bash
cd packages/brain
DB_NAME="${DB_NAME:-cecelia_test}" npx vitest run src/__tests__/conversation-capture.test.js src/__tests__/conversation-capture-claude.test.js src/__tests__/conversation-capture-codex.test.js src/__tests__/conversation-capture-grok.test.js src/__tests__/conversation-capture-human-gate.test.js src/__tests__/integration/conversation-capture.integration.test.js
```

**硬阈值**: 全部测试 exit code = 0；连续两轮相同 human session 的 LLM 总调用数 = 1；Codex/Grok unknown 的 capture 行数 = 0。

### Step 7: 提供受保护清理 SOP，生产执行权留给主 session

**来源**: `[FROM_PRD]` — PRD 第 24、32-33、53、64、149-151 行。

**可观测行为**: 非破坏性测试证明脚本无 `--confirm` 时拒绝、备份失败时 DELETE 前退出、只删 `source LIKE 'conversation%'` 并输出四组计数；生产清理和第 7 天抽检不由 worker 执行。

**验证命令**:
```bash
bash packages/brain/scripts/__tests__/cleanup-conversation-captures.test.sh
bash scripts/check-version-sync.sh
```

**硬阈值**: 两条命令 exit code = 0；cleanup 测试只连接 disposable test DB；备份失败时 conversation fixture 行数不变；成功时非 conversation fixture 行数不变。

## 接缝清单

1. launcher/派发脚本 ↔ 真 PostgreSQL `session_provenance`：自动验收以 psql 转发器改写目标库但执行真实 SQL，并回读完整行；未过不得 done。
2. 三适配器真实 transcript fixture ↔ `runConversationCapture` ↔ `session_provenance/captures/working_memory`：自动验收调用生产入口与真 PostgreSQL，不 mock allowlist、dedupe 或 DB。
3. `runConversationCapture` ↔ Anthropic Haiku ↔ summary capture：自动验收必须真 key、真请求、真响应并在五分钟窗内查到落库摘要。
4. cleanup SOP ↔ 生产 `captures`：自动阶段只在 disposable test DB 验逻辑；生产备份/删除由主 session 验，完成前状态为 `logic-done-pending`。
5. 部署后 7 天真实内容质量：必须人工抽检生产新增行；到期前状态为 `logic-done-pending`。

## 禁 mock 边清单

- `360_session_provenance.sql` ↔ 真 PostgreSQL（schema、CHECK、UUID、幂等均在隔离 schema 真执行）。
- `cecelia-run.sh` / `harness-skill-relay.js` ↔ `claude-launch.sh` 的环境透传（执行生产命令构造器；不得只做 `source.includes()`）。
- `claude-launch.sh` ↔ `session_provenance`（fake psql 只覆盖分支；冻结合同测试另以 psql 转发器执行真 test DB INSERT/回读，不得以 fake 取代真接缝）。
- `extractClaude/Codex/GrokSessions` ↔ `runConversationCapture` ↔ `session_provenance/captures/working_memory`（真实 fixture、生产函数、真 PostgreSQL；不得 mock 被改的 allowlist 或 DB 查询）。
- `runConversationCapture` ↔ `callLLM` ↔ Anthropic Haiku（至少一条冻结合同测试使用真实 Anthropic transport，不得用 fake LLM 替代；默认订阅 bridge，直付 API 可显式选择）。
- `cleanup-conversation-captures.sh` ↔ disposable test PostgreSQL（真备份/真限定 DELETE；生产库仅主 session执行）。

## 未覆盖真实链路清单

| 未覆盖点 | 原因 | 补位计划 |
|---|---|---|
| human gate 其余错误/混合批次用例中的确定性 LLM 替身 | 控制调用次数并验证零调用失败语义；不能替代真实摘要链路 | BEH-04 同轮另跑冻结合同的真 Anthropic Haiku 请求、响应字段和 summary 落库断言 |
| 生产 `conversation%` 备份与删除 | 冻结 PRD 明禁 worker 执行生产清库 | 独立评审通过后主 session 按 SOP 执行并记录 backup path 与四组计数 |
| 部署后第 7 天机器噪音抽检 | 必须等待真实时间窗 | 主 session 在 day 7 记录新增量、machine-noise=0 与两类 skipped 汇总 |

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

> 自动脚本只连接测试库并验证非破坏性路径；严禁自动执行生产 migration、生产 cleanup 或第 7 天抽检。

```bash
#!/usr/bin/env bash
set -euo pipefail

export DB_NAME="${DB_NAME:-cecelia_test}"
case "$DB_NAME" in
  *_test|*_scratch) ;;
  *) echo "FAIL: E2E 只允许测试库，当前 DB_NAME=$DB_NAME"; exit 1 ;;
esac

# local_api evaluator 在容器中运行时使用宿主测试库与订阅 bridge；宿主直跑保持 localhost。
if [[ -f /.dockerenv ]]; then
  export DB_HOST="${DB_HOST:-host.docker.internal}"
  export PGHOST="${PGHOST:-host.docker.internal}"
  export EXECUTOR_BRIDGE_URL="${EXECUTOR_BRIDGE_URL:-http://host.docker.internal:3457}"
fi
export RUN_LIVE_HAIKU=1
export LIVE_HAIKU_PROVIDER="${LIVE_HAIKU_PROVIDER:-anthropic}"

npx vitest run \
  --config sprints/07251213-kernel-0a8c796b/vitest.config.mjs \
  tests/live/kernel-0a8c796b/session-provenance.contract.test.ts \
  tests/live/kernel-0a8c796b/launcher-provenance.contract.test.ts \
  tests/regression/kernel-0a8c796b/dispatch-provenance.contract.test.ts \
  tests/live/kernel-0a8c796b/conversation-human-gate.contract.test.ts \
  tests/live/kernel-0a8c796b/cleanup-sop.contract.test.ts

cd packages/brain
npx vitest run src/__tests__/integration/session-provenance.integration.test.js
npx vitest run src/__tests__/conversation-capture-human-gate.test.js src/__tests__/integration/conversation-capture.integration.test.js
npx vitest run src/__tests__/headed-dispatch.test.js
npx vitest run src/__tests__/conversation-capture.test.js src/__tests__/conversation-capture-claude.test.js src/__tests__/conversation-capture-codex.test.js src/__tests__/conversation-capture-grok.test.js
cd ../..

bash -n scripts/claude-launch.sh
bash -n packages/brain/scripts/cecelia-run.sh
bash scripts/__tests__/claude-launch-session-provenance.test.sh
bash packages/brain/scripts/__tests__/cleanup-conversation-captures.test.sh
bash scripts/check-version-sync.sh

echo "OK: 非破坏性 Golden Path 验收通过；生产接缝保持 logic-done-pending"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| provenance 真 PostgreSQL schema | `../../tests/live/kernel-0a8c796b/session-provenance.contract.test.ts` | session_provenance migration 在真 PostgreSQL 中约束 human/machine 并可重复应用 | migration 文件不存在，测试在任何 schema 断言前 FAIL |
| launcher 真登记接缝 | `../../tests/live/kernel-0a8c796b/launcher-provenance.contract.test.ts` | claude launcher 在真 PostgreSQL 写入 machine provenance 并回读 | migration/launcher 登记尚不存在，按 session_id 回读为空而 FAIL |
| 两条机器派发命令 shape | `../../tests/regression/kernel-0a8c796b/dispatch-provenance.contract.test.ts` | cecelia-run dry-run 输出 machine provenance 三字段并调用 launcher / headed Claude 生产命令构造器透传 machine provenance 三字段 | dry-run 与 headed tmux 命令均缺 `CECELIA_DISPATCH`/`CECELIA_LAUNCHED_BY`，值断言 FAIL |
| human allowlist + 真 Haiku | `../../tests/live/kernel-0a8c796b/conversation-human-gate.contract.test.ts` | runConversationCapture 只让 registered human 产生原始与摘要两条 capture / registered human 经真 Haiku 请求后 summary capture 在五分钟窗内落库 | migration/allowlist 尚不存在；未登记 fixture 仍会进入旧采集路径，新的 provenance 与 live-summary 断言 FAIL |
| 受保护清理 SOP | `../../tests/live/kernel-0a8c796b/cleanup-sop.contract.test.ts` | cleanup SOP 真执行先备份后限定删除且备份失败零删除 | shell test/cleanup SOP 尚不存在，真实执行 exit 非 0 |

## Notes

- 当前 migration 最大编号为 359，合同指定候选 `360_session_provenance.sql`；若生成时 main 已推进，必须使用下一个空闲编号并同步测试，禁止抢号。
- PRD 预期路径写 `packages/brain/DEFINITION.md`，当前仓库实际版本定义文件是根目录 `DEFINITION.md`；Generator 必须按现有 `scripts/check-version-sync.sh`/facts-check 的真实版本合同更新，不得新建伪定义文件。
- 本合同不批准共享 CI 基础设施变更；若 CI 自身故障，另立 sprint。
- Round 3 响应 evaluator 真跑反馈：永久测试路径与获批 DoD 统一；`local_api` E2E 强制真 Haiku；运输层回到 PRD 边界（真实 Anthropic 即可，默认订阅 bridge，直付 API 可选）；容器测试库/bridge 地址只在 `.dockerenv` 下改写。
