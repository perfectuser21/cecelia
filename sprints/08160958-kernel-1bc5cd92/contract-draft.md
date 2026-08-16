# Sprint Contract Draft (Round 1) — gan_no_push_streak 误判修复

**锚定父路声明**: 独立小路（无父路）— journey e6f803f2 现有 ability 均为 planned 态，无父 golden_path step（PRD `step_id: none`）。

contract-gate: 代码层 Contract Gate 存在（packages/brain/src/lib/contract-gate.js），本合同断言按合规惯用法速查表书写。
gp-anchor: skipped (product-map.json not found)

---

## Response Schema（推导来源: PRD 字面 + api_registry 无相似端点 → 内部函数为主）

本单为纯 `packages/brain` orchestrator + 建任务口内部改动，无新增 HTTP 端点，无对外 JSON 响应契约。
观测契约以三个内部函数的返回/落库为准：

### 1. `resolveProposalRemote(taskPayload)` → `{ remote, unresolved }`（ground-truth.js 新增导出）
```json
{"remote": "\"https://github.com/perfectuser21/cecelia.git\"", "unresolved": false}
```
- `remote` (string|null, 必填): 解析成功时 = 可直接拼进 `git ls-remote --heads <remote>` 的**带引号完整 GitHub clone URL**；解析失败时 = `null`。来源——PRD Golden Path 第 2 步字面。
- `unresolved` (boolean, 必填): `parseBaseRepo(base_repo) ?? parseBaseRepo(repo)` 都解析不到 → `true`（**禁止退 'origin'**）。来源——PRD 第 2 步 + 边界情况。
- **禁用取值**: `remote` 严禁为 `'origin'` / `"origin"`（本单核心根因即误退 origin）。

### 2. `collectGroundTruth(deps, opts)` 返回的 `observed` 新增字段
```json
{"proposeBranchRn": 1, "proposalRemoteUnresolved": false}
```
- `proposalRemoteUnresolved` (boolean, 必填): 镜像 `resolveProposalRemote().unresolved`；解析成功恒 `false`。unresolved 时**不执行** `git ls-remote`，`proposeBranchRn` 保持 `0`。
- **禁用字段名**: 不得引入 `remoteUnresolved` / `proposeRemoteMissing` 等同义替换；字面用 `proposalRemoteUnresolved`。

### 3. `derive(observed)` → `{ phase, action, reason }`（derive.js，已有 shape，本单新增 reason 取值）
```json
{"phase": "failed", "action": "mark_failed", "reason": "proposal_remote_unresolved"}
```
- 新增合法 `reason` 值：`proposal_remote_unresolved`、`proposal_observation_mismatch`。
- **禁用**: 上述两种情形**严禁**再记 `reason: "gan_no_push_streak"`（PRD NFR：不得复用 gan_no_push_streak 标签）。

### 4. 建任务口落库（work-routing-store.js）
```json
{"base_repo": "https://github.com/perfectuser21/cecelia.git"}
```
- coding_mutation 且 `payload.base_repo` 缺失 → 从 `map_scope_repositories` 的 repo/aliases 规范化写入完整 URL。短名 `cecelia` / 别名一律规范化为 `https://github.com/perfectuser21/cecelia.git`。

---

## 已知约束（来自回归测试 + 累积 FR）

- [derive.test.js] `守护：no_push_streak >= 2 → failed`（reason=gan_no_push_streak）—— **本单必须保留此语义于 `crossCheckMismatch===false` 分支**（零回归红线）。
- [derive.test.js] `守护：no_verdict_streak >= 3 → failed` —— 不触碰。
- [ground-truth.test.js] rN 解析 / inflight label 过滤 / lastAgentExit hop 作用域 —— 只在 remote 解析处改，rN 正则与匹配逻辑不动。
- [counters.test.js] `crossCheckMismatch = proposerCount !== proposeBranchMaxRn` —— 复用现有信号，**不改 counters.js after>before 语义**（PRD 范围限定）。
- [累积FR] 本 line（journey e6f803f2）暂无已验收历史 ability，无行为可回退（context-manifest: 依赖 Brain 运行时，本轮以 PRD 为准）。
- [Invariant] generator_retry_identity / planner_role_branch / fleet_brain_url_authority / evaluator_validation_clock —— 本单不触碰调度身份/planner 分支/BRAIN_URL/validation_clock，四铁律 N/A（见 DoD INV 条目）。

---

## Golden Path

[proposer 真实 push 提案分支到 GitHub] → [ground-truth 用 base_repo→repo 兜底解析出 GitHub URL 观测] → [derive 尊重 crossCheckMismatch，观测故障重新观测而非假失败] → [建任务口回填规范 URL 断绝复发] → [proposeBranchRn 反映真实分支数，不再假 gan_no_push_streak]

### Step 1: proposer 真实 push 提案分支（回调数 > 0）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步。
**可观测行为**: GitHub 上存在 `cp-harness-propose-r1-<task8>-r<run8>-a*` 分支；`crossCheckMismatch = proposerCount !== proposeBranchMaxRn` 为观测信号（回调数 > 观测 rn 时为 true）。
**验证命令**: 见 DoD B-02（derive 门控单测，构造 crossCheckMismatch=true）。
**硬阈值**: 无独立断言（此步为前置事实，由后续步骤的门控行为间接验证）。

### Step 2: ground-truth 提案 remote 解析（base_repo→repo 兜底，禁退 origin）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2、3 步 + 根因①。
**可观测行为**: `resolveProposalRemote({base_repo:null, repo:'cecelia'})` 返回带引号 `https://github.com/perfectuser21/cecelia.git`，不再退 'origin'；`git ls-remote --heads <URL>` 命中真实提案分支 → `proposeBranchRn>=1`。base_repo 与 repo 皆空 → `unresolved=true`，**不执行 ls-remote origin**。
**验证命令**:
```bash
npx vitest run sprints/08160958-kernel-1bc5cd92/tests/ground-truth-proposal-remote.test.js sprints/08160958-kernel-1bc5cd92/tests/regression-run-7a8e5319-rn.test.js --reporter=basic
```
**硬阈值**: 两文件全 PASS；回归夹具 `observed.proposeBranchRn === 1`（旧代码退 origin → 0，红）。

### Step 3: derive 尊重 crossCheckMismatch（观测故障重新观测，不假失败）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4、5 步 + 根因③。
**可观测行为**:
- `crossCheckMismatch===false` 且 `noPushStreak>=MAX_NO_PUSH_STREAK` → 仍 `mark_failed / gan_no_push_streak`（原语义保留）。
- `crossCheckMismatch===true` 且 `observationMismatchStreak < MAX_OBSERVATION_MISMATCH_STREAK(3)` → **不判 gan_no_push_streak**，返回非终局动作、`reason='proposal_observation_mismatch'`，不递增 noPushStreak（重新观测）。
- `crossCheckMismatch===true` 连续 3 次仍 mismatch → `mark_failed / proposal_observation_mismatch`。
- `observed.proposalRemoteUnresolved===true` → `mark_failed / proposal_remote_unresolved`（独立 reason，不复用 gan_no_push_streak）。
**验证命令**:
```bash
npx vitest run sprints/08160958-kernel-1bc5cd92/tests/derive-observation-gate.test.js --reporter=basic
```
**硬阈值**: 4 用例全 PASS（含 1 条零回归守卫）。

### Step 4: 建任务口回填规范 clone URL（断绝复发）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 步 + 根因（29/146 缺 base_repo）。
**可观测行为**: `createRoutedTask` 对 coding_mutation 缺 base_repo 时，从 map_scope_repositories repo/aliases 推出 `https://github.com/perfectuser21/cecelia.git` 写入 `payload.base_repo`。
**验证命令**:
```bash
npx vitest run sprints/08160958-kernel-1bc5cd92/tests/work-routing-base-repo-backfill.test.js --reporter=basic
```
**硬阈值**: 落库 payload 参数 `base_repo === 'https://github.com/perfectuser21/cecelia.git'`。

### Step 5: 版本四处同步 + DevGate（可上线）
**来源**: `[FROM_PRD]` — PRD NFR。
**可观测行为**: Brain semver bump 四处一致；`check-version-sync.sh` 绿。
**验证命令**:
```bash
bash scripts/check-version-sync.sh
```
**硬阈值**: 退出码 0（四处版本一致）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | ①提案 remote 解析 base_repo→repo 兜底禁退 origin；②derive crossCheckMismatch 门控 + 两独立 failure_reason；③建任务口回填规范 base_repo URL |
| **NFR（做得多好）** | 非功能 | 无延迟/频控要求（PrepPRD 未指定）；`proposal_observation_mismatch`/`proposal_remote_unresolved` 各写独立 verdict/failure_reason 日志行；Brain semver 四处同步 + DevGate 三项 |
| **Invariant（永不违反）** | 不变量 | 不改 counters.js after>before 语义；不改 harness_attempts.failure_class 枚举；`crossCheckMismatch===false` 时 gan_no_push_streak 原语义逐字节保留（零回归） |
| **判定点（怎么知道）** | 判断假设 | 见下方判定点登记表 |
| **保质期（何时过期）** | 失效 | 规范 clone URL 由 DEFAULT_REPO_MAP/HARNESS_REPO_MAP 驱动，仓库别名变更时随 map 更新，无独立退役 |
| **死亡告警（停了谁知道）** | 告警 | 若门控错误重新压制真实 no-push → run 长期 mismatch，连续 3 次后 `proposal_observation_mismatch` 终局失败并入 initiative_runs.failure_reason，可被巡检查询 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 回归夹具断言 `proposeBranchRn===1`；建任务口断言落库 payload.base_repo；DB 落库真验见 ## E2E 验收 psql |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 聊天 API 不稳 | 静默丢消息 |
| ⚠️ 提案分支是否真实存在于 GitHub | A. `ls-remote` 本地 origin; B. `ls-remote` GitHub URL(base_repo→repo 兜底) | B | 本机 worktree origin 指向本地路径，看不到 GitHub 分支（根因②） | 误退 origin → rn 恒 0 → gan_no_push_streak 假失败杀死真实成功的 run |
| ⚠️ rn=0 是「真没 push」还是「观测口错」 | A. 直接判 no_push 失败; B. 对比 crossCheckMismatch（回调数 vs 观测 rn），mismatch 视为观测故障重新观测 | B | 回调数 > 观测 rn 证明 proposer 成功但观测口有误 | 误判观测故障为真失败 → 面客 run 被误杀 |
| 缺 base_repo 时规范 URL 从何推导 | A. 退 origin; B. 从 map_scope_repositories repo/aliases 规范化 | B | 短名/别名可确定性映射到 owner/repo | 推错仓库 → clone/观测指向错误仓库 |

> ⚠️ 两条判定点误判后果严重（误杀面客 run）；PrepPRD/对齐会未显式拍板门控阈值 3，notes 记 `judgment-pending-user: crossCheckMismatch 重新观测上限=3` 待确认。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503 不写库 | 是 | 客户端重试 |
| base_repo 与 repo 皆解析不到 | 不执行 ls-remote，`proposalRemoteUnresolved=true` → mark_failed `proposal_remote_unresolved` | 是（纯观测，无副作用） | 独立 failure_reason，不静默退 origin 假绿 |
| crossCheckMismatch 观测故障 | 不失败，重新观测（不递增 noPushStreak） | 是 | 连续 3 次仍 mismatch 才 `proposal_observation_mismatch` 终局 |
| 建任务口 map_scope_repositories 无对应 repo/alias | base_repo 不回填（保持原行为），不抛错阻断建单 | 是 | 下游 ground-truth 走 unresolved 独立 reason（不退 origin） |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A — 纯内部 orchestrator/建任务口改动，无对外暴露 agent 输入面 | N/A | N/A | N/A |

---

## 禁 mock 边清单

本单涉及**状态机（derive gan 门控）**、**DB 写路径（work-routing-store createRoutedTask 落 tasks.payload）**，故禁 mock 被改的边：

- derive.js 状态机 ↔ observed 输入（本单改 gan 门控判定）：failing test 真调 `derive(observed)`，**不 mock derive**，直接断言返回的 `{phase,action,reason}`。
- ground-truth.js 提案 remote 解析边（本单改 `resolveProposalRemote` + collectGroundTruth 消费）：`resolveProposalRemote` 真调纯函数；回归夹具真调 `collectGroundTruth`，只注入更外层的 pool/execCmd 传输替身（DB 驱动 / git 子进程属被改边之外的外部依赖），**被改的解析逻辑本身不 mock**。
- 代码 ↔ tasks 表 payload 写入（本单改 createRoutedTask 落 base_repo）：单测按仓库既有约定（现存 work-routing-store.test.js / .integration.test.js 均用 fake client）拦 SQL 传输、**捕获生产代码真实构造的 INSERT payload 参数**断言 base_repo URL——被改的「payload 构造」边真跑，仅 pg 驱动传输（返回 row id）这一更外层无关依赖用替身，非伪造成功。真库端到端落库真验见 ## E2E 验收 psql（DB_URL 注入时执行）。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 主机器可验 oracle = 本 sprint vitest 回归套件（真执行、exit-code 驱动、被改边不 mock）+ 三个受影响 brain 模块的零回归单测。DB 落库真验（psql）在 Fleet 注入 `DB_URL` 时附加执行；未注入时以 vitest 套件为权威 oracle（见 ## 未覆盖真实链路清单）。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 本 sprint 回归套件（复现 rn=0→rn=1 / derive 门控 / base_repo 回填）——真执行，全绿即达标
npx vitest run sprints/08160958-kernel-1bc5cd92/tests/ --reporter=basic 2>&1 | tee /tmp/e2e-sprint.log
grep -Eq "Test Files.*[0-9]+ passed" /tmp/e2e-sprint.log || { echo "FAIL: sprint 套件未全绿"; exit 1; }
grep -Eq "Test Files.*failed" /tmp/e2e-sprint.log && { echo "FAIL: sprint 套件存在 failed"; exit 1; } || true

# 2. 受影响 brain 模块零回归（derive / ground-truth / counters / constants / work-routing-store）
npx vitest run \
  packages/brain/src/orchestrator/__tests__/derive.test.js \
  packages/brain/src/orchestrator/__tests__/ground-truth.test.js \
  packages/brain/src/orchestrator/__tests__/counters.test.js \
  packages/brain/src/orchestrator/__tests__/constants.test.js \
  packages/brain/src/__tests__/integration/work-routing-store.test.js \
  --reporter=basic 2>&1 | tee /tmp/e2e-brain.log
grep -Eq "Test Files.*failed" /tmp/e2e-brain.log && { echo "FAIL: brain 模块回归 failed"; exit 1; } || true

# 3. 版本四处同步
bash scripts/check-version-sync.sh

# 4. DB 落库真验（仅当 Fleet 注入 DB_URL；空库先跑 migration 再断言 base_repo 落库）
if [ -n "${DB_URL:-}" ]; then
  export DATABASE_URL="$DB_URL"
  # 空库 bootstrap：运行仓库真实 migration，机检目标表存在
  node packages/brain/src/scripts/run-migrations.js 2>/dev/null || npm --prefix packages/brain run migrate 2>/dev/null || true
  psql "$DB_URL" -tAc "SELECT to_regclass('public.tasks') IS NOT NULL" | grep -qx t || { echo "FAIL: tasks 表未 bootstrap"; exit 1; }
  # 断言：缺 base_repo 的 coding_mutation 建单后 payload.base_repo 落成完整 URL（时间窗防历史数据冒充）
  BR=$(psql "$DB_URL" -tAc "SELECT payload->>'base_repo' FROM tasks WHERE task_type='harness_initiative' AND payload->>'base_repo' LIKE 'https://github.com/%' AND created_at > NOW() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
  [ -n "$BR" ] || { echo "FAIL: 近 10 分钟无 base_repo 完整 URL 落库记录"; exit 1; }
  echo "OK: base_repo 落库真验 $BR"
else
  echo "NOTE: DB_URL 未注入，DB 落库真验入未覆盖清单，本轮 oracle=vitest 套件（真执行）"
fi

echo "✅ Golden Path 验证通过"
```

---

## 未覆盖真实链路清单

- **DB 落库真验（tasks.payload.base_repo）在全量种子库上的端到端**：`createRoutedTask` 的 map_scope 校验依赖 map_projection_runs/nodes 种子，E2E 全量 bootstrap 成本与本单不成比例。补位：① 单测捕获生产代码真实构造的 INSERT payload 参数（被改边真跑）；② ## E2E 验收 psql 块在 Fleet 注入 `DB_URL` 时对 scratch 库真验落库；③ 真验补位计划：evaluator local_api 环境注入 DB_URL 即触发（谁：evaluator；何时：evaluate 阶段；环境：Fleet scratch DB）。
- **kernel `node run.js --dry-run` 全链观测**：PRD 期望 kernel dry-run 输出 observed.proposeBranchRn 来自 GitHub URL——需运行中 Brain + GitHub 网络，属接缝。补位：回归夹具 `regression-run-7a8e5319-rn.test.js` 真调 `collectGroundTruth`（注入 fake pool/execCmd 传输）复现 rn=0→rn=1，被改的解析边不 mock；kernel 全链 dry-run 标 `logic-done-pending`，上线后由巡检对真实 successor run 观测确认。
- 其余无 force_*/stub 假数据。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `resolveProposalRemote(undefined)` / `resolveProposalRemote({base_repo: 123})`（非字符串）→ 应 unresolved=true，不抛异常
- 重复提交: 同一 source_id 重复 createRoutedTask（已有 advisory lock + dedup 分支）→ base_repo 回填不得破坏幂等/去重
- 中途中断: derive 在 crossCheckMismatch 重新观测途中 proposeBranchRn 突然 >=1（观测口恢复）→ 应回落正常 GAN 路由，不再报 mismatch
- 边界值: `observationMismatchStreak` 恰为 2 / 恰为 3 的边界；base_repo 为别名（如 'perfectuser21/cecelia' 非短名）→ 规范化为 .git URL
发现分级: P0/P1（误杀面客 run / 落错仓库）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞
