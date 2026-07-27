# Sprint Contract Draft (Round 8)

## Response Schema（推导来源: PRD字面）

N/A — 本任务不新增对外 HTTP response；核心输出是内部 canonical manifest、DB 批准记录、attempt bundle/verdict detail 与 CI/merge gate 判定结果。

### Internal Result Schema: ApprovedContractManifest

```json
{
  "run_id": "uuid",
  "contract_version": "integer",
  "source_commit_sha": "git sha",
  "sprint_dir": "string",
  "artifacts": [
    {
      "path": "string",
      "git_blob_oid": "string",
      "sha256": "string",
      "size": "integer",
      "kind": "prd|contract_draft|contract_dod|task_plan|test|fixture|golden|root_dod|migration"
    }
  ],
  "manifest_digest": "sha256",
  "approved_at": "ISO-8601",
  "reviewer_verdict": {
    "attempt_id": "uuid|string",
    "verdict": "APPROVED",
    "reviewer": "string"
  }
}
```

- `run_id` (uuid, 必填): 来源 — PRD canonical manifest 字面要求。
- `contract_version` (integer, 必填): 来源 — PRD 同一 version 覆写拒绝。
- `source_commit_sha` (git sha, 必填): 来源 — PRD Reviewer 批准瞬间 Git 对象。
- `sprint_dir` (string, 必填): 来源 — PRD frozen scope。
- `artifacts[]` (array, 必填): 来源 — PRD artifacts(path, git_blob_oid, sha256, size, kind)。
- `manifest_digest` (sha256, 必填): 来源 — PRD Generator/Evaluator/CI/merge gate 共同可信输入。
- `approved_at` (ISO-8601, 必填): 来源 — PRD approved_at。
- `reviewer_verdict` (object, 必填): 来源 — PRD reviewer verdict identity。
- **禁用字段名**: `approved_sha_only`, `contract_content_only`, `latest_branch`, `mutable_contract_branch`, `force_manifest_digest`。

## 已知约束（来自回归测试 / 累积FR）

- [packages/brain/src/orchestrator/__tests__/contract-store.test.js] → upserts the approved version, supersedes older versions, and attaches the run atomically（旧行为会覆写，本 Sprint 要改为同 version 不同 manifest 拒绝）。
- [packages/brain/src/orchestrator/__tests__/loop.test.js] → persist_contract_approval 在 contract 行缺失时从冻结分支物化并继续 generator。
- [packages/brain/src/orchestrator/__tests__/loop.test.js] → APPROVED 没有不可变合同 SHA 时 fail closed，不读取可变 branch。
- [packages/brain/src/orchestrator/__tests__/dispatcher.test.js] → generator bundle 从已批准合同导出 contract_branch，供 launcher 注入环境。
- [packages/brain/src/orchestrator/__tests__/dispatcher.test.js] → evaluator 工作树可写，以便切 PR 分支、真启服务并固化验收证据。
- [packages/brain/src/orchestrator/__tests__/gates.test.js] → evaluate/judge PASS 必须锚定当前 pr_head_sha。
- [packages/brain/src/orchestrator/__tests__/ground-truth.test.js] → evaluateVerdict/judgeVerdict 取最新 verdict:* 行 detail。
- [packages/brain/src/__tests__/harness-ci-gate.test.js] → CI 任一失败项必须 FAIL，pending 必须等待或超时。
- [累积FR] context-manifest: `GET /api/brain/warroom/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 返回本 line 暂无历史 FR；近期 runs 包含 `13d41c64` 事故上下文。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | 生成 approved contract canonical manifest；append-only 记录批准；Generator dispatch/callback、Evaluator、CI required check、merge gate 全部用同一 `manifest_digest` 与 current PR SHA 校验；approved artifact drift fail-closed。 |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 每次进入 Generator/Evaluator/CI/merge 前先验 manifest；缺失/不可达/stale 均 fail-closed；manifest canonical 序列稳定，重复生成 digest 一致。 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | Reviewer 批准的 Git blob 集合不可被 Generator 改语义；同一 `contract_version` 不得用不同 `manifest_digest` 覆写；secrets 不进 manifest；租户/运行上下文不得跨 run 误用。 |
| **判定点（怎么知道）** | 对模糊现实的判断假设（详见"判定点登记表"） | 见下方登记表。 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | manifest 对应一次 approved contract version，直到重新 GAN 产生新 version/digest；callback token 仍按 attempt lease 生命周期失效。 |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道，用什么告警手段 | CI required check、mergeGate、Evaluator/Judge verdict 均输出结构化 reason；fail-closed reason 进入 orchestrator_decision_log 与 PR check。 |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | 缺 manifest/不可达/stale/digest mismatch → 拦截；批准后 main migration 冲突 → `requires_re_gan`，不得进入普通 generator fix；同 digest 重放幂等。 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效？回执方式/时限/拿不到算什么 | DB 中 `initiative_contracts.manifest_digest/source_commit_sha/approved_manifest` 可查且 `approved_at` 在 5 分钟内；attempt bundle/verdict detail/CI output 与 DB digest 一致。 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ approved artifact drift 是否只是 Root DoD 机械变化 | A. 全文件 byte-for-byte；B. Root DoD 归一化忽略 checkbox/evidence/provenance 行，其他字段严格比较 | B | PRD 明确 Root DoD 只允许 checkbox/evidence/provenance 机械变化 | 误放行会让 Generator 改 Test command/动作/预期/环境/安全语义后仍合并 |
| ⚠️ stale manifest digest 判定 | A. 只看 PR SHA；B. evaluate/judge/callback/CI/merge gate 同时匹配 current PR SHA 与 approved `manifest_digest` | B | PRD 要求 Generator、Evaluator、CI、merge gate 只信同一 manifest | 旧合同 PASS 被新 PR 复用，漂移静默进 main |
| ⚠️ 批准后 main migration 冲突判定 | A. Generator 自行改号；B. 检测批准时固定 migration 编号在新 main 已冲突则 `requires_re_gan` | B | PRD 明确批准后 main 冲突不得普通 fix loop | 事后改号破坏 Reviewer 批准的精确合同 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| manifest 缺失/不可达 | 返回 `{ok:false, reason:"approved_contract_manifest_missing"}` 或 CI 非 0 | 是，同一输入重复同一 reason | 无降级，fail-closed |
| current PR SHA 缺失或与 verdict 不一致 | merge/evaluate/CI 拒绝，reason=`current_pr_sha_missing` 或 stale sha | 是 | 等待真实 PR SHA 后重跑 |
| manifest_digest 与 approved digest 不一致 | 拒绝，reason=`stale_manifest_digest` / `stale_evaluate_manifest_digest` | 是 | 重新 GAN 或重新 evaluator/judge |
| artifact 删除/重命名/修改 | 拒绝，reason=`approved_contract_drift`，列出 drift path | 是 | 还原 approved artifact 或重新 GAN |
| 同一 contract_version 不同 manifest 覆写 | DB 写入拒绝，reason=`approved_contract_manifest_conflict` | 是，同 digest 重放可通过 | 无降级 |
| main migration 编号冲突 | 输出 `requires_re_gan`，不派 generator-fix | 是 | 回到 GAN 重新批准新编号 |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| Generator / Evaluator / Judge callback body | 不可信 agent 输出 | `parseHarnessResult` 后只采信结构化字段；新增 `manifest_digest` 与 `pr_head_sha` 必须对 DB/Git 真相二次校验 | callback 声称 digest/SHA 不匹配则 409/FAIL，不写 allow verdict |
| Git worktree / PR branch artifact 内容 | 半可信（Generator 可写） | 以 approved Git blob oid + sha256 对比，不读分支文本自证 | 合同语义 drift 拒绝 merge |
| CI 环境变量中的 digest/SHA | 半可信 | CI script 读取 DB manifest 并核对 current git SHA，不只信 env | 缺 env 或 env 与 DB 不一致直接非 0 |

## 真实调用方请求 shape

生产调用方为 Harness attempt runner 通过 Brain callback 路由上报结果：

- Endpoint: `POST /api/brain/harness/attempts/:attemptId/callback`
- Auth: `Authorization: Bearer $HARNESS_CALLBACK_TOKEN`
- Lease: `X-Harness-Lease-Owner: $HARNESS_LEASE_OWNER`
- Content-Type: `application/json`
- Body: `parseHarnessResult` 协议，顶层必须含 `status`、`summary`、`artifacts[]`、`checks[]`、`decision`、`provider_metadata`；generator/evaluator/judge 还必须在 `decision` 或 `provider_metadata` 中携带 `manifest_digest`，generator/evaluator 还必须携带或由服务端解析 `pr_head_sha`。
- 服务端认证顺序：attempt 存在 → bearer token 与 `callback_secret_hash` 匹配 → lease owner 匹配 → result schema 通过 → provider/machine attestation 匹配 → manifest digest 与 current PR SHA 二次校验。

Dispatcher 注入给真实 attempt 的 shape：

- `task_bundle.inputs.contract.approved_manifest.manifest_digest`
- `task_bundle.inputs.contract.manifest_digest`
- `task_bundle.inputs.contract.source_commit_sha`
- `APPROVED_CONTRACT_MANIFEST_DIGEST`
- `APPROVED_CONTRACT_SOURCE_SHA`
- Evaluator 既有 `PR_HEAD_SHA` 必须保留并与 digest 一起验证。

## 接缝清单

- Git object store ↔ canonical manifest：批准 SHA 下每个 artifact 必须用真实 `git ls-tree/git cat-file/git show` 取 blob oid、sha256、size；不可从工作区当前文件或 branch tip 推断。
- Brain orchestrator ↔ PostgreSQL `initiative_contracts` / `initiative_runs`：批准记录 append-only，DB 真写并由 dispatch/evaluator/merge gate 读取同一 row。
- Attempt callback ↔ `orchestrator_decision_log` verdict：callback 上报的 manifest/pr SHA 必须服务端校验后才落 allow verdict。
- CI / merge gate ↔ current PR SHA：CI 和 merge gate 必须读取 current PR head 与 approved manifest digest，stale verdict/digest 拒绝。

## 禁 mock 边清单

- `harness-gan` APPROVED SHA ↔ `materializeApprovedContractManifest` ↔ PostgreSQL `initiative_contracts`（本单改批准记录写路径，测试必须真 PG temp table 验同 version 不同 digest 拒绝）。
- `initiative_contracts.approved_manifest` ↔ dispatcher `buildBundle/buildInputs`（本单改跨模块数据传递，测试不得 mock contract row shape）。
- Attempt callback route ↔ `appendAttemptVerdict` / `appendGeneratorFixCallback` ↔ `orchestrator_decision_log`（本单改 callback lifecycle hook，测试不得 mock 掉 verdict 写入边）。
- Approved manifest ↔ Git artifact tree（本单改 Git 对象冻结与 drift 判定，测试必须用真实临时 Git repo，不得用纯内存 fake 文件列表代替）。
- `mergeGate` ↔ evaluate/judge verdict detail（本单改 merge gate 判定，测试必须调用真实 `mergeGate` 函数）。
- CI required check script ↔ current worktree Git SHA / manifest row（本单改 CI gate，E2E 必须真跑脚本，不以 echo/grep 自证）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；不涉及第三方 API 真 key。PR #4372 只作为 fixture/evidence，不修改、不复用。）

## Golden Path

独立小路（无父路）

Reviewer 批准合同资产 → canonical manifest 冻结 Git 对象与 append-only 记录 → Generator/Evaluator/CI/merge gate 共同校验同一 manifest_digest + current PR SHA → drift fail-closed 或 requires_re_gan。

### Step 1: Reviewer APPROVED 后生成 canonical manifest

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 点要求 manifest 包含 `run_id`、`contract_version`、`source_commit_sha`、`sprint_dir`、按序 `artifacts(path, git_blob_oid, sha256, size, kind)`、`manifest_digest`、`approved_at`、`reviewer verdict identity`。

**可观测行为**: approved SHA 下的 `sprint-prd.md`、`contract-draft.md`、`contract-dod.md`、`task-plan.json`、`tests/**`、引用 fixture/golden、root `DoD.md`、批准时固定 migration 文件被排序写入 manifest；同输入重复生成 `manifest_digest` 完全一致。

**验证命令**:
```bash
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "canonical manifest freezes approved PRD contract DoD task-plan tests and fixture artifacts"
```

**硬阈值**: artifacts `(path, kind)` 顺序字面等于测试期望（`root_dod/migration/golden/contract_dod/contract_draft/prd/task_plan/test`）；每项 `git_blob_oid` 非空、`sha256` 为 64 位 hex、`size > 0`；重复生成 digest 一致。

---

### Step 2: 批准记录 append-only，禁止同 version 不同 manifest 覆写

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 点要求 append-only；第 6 点要求同一 `contract_version` 已有不同 manifest 时拒绝覆写。

**可观测行为**: `initiative_contracts` 新增/扩展 `approved_manifest jsonb`、`manifest_digest text`、`source_commit_sha text`、`reviewer_verdict jsonb`；同一 version + 同 digest 重放幂等且不得覆写已批准正文；同一 version + 不同 digest 抛 `approved_contract_manifest_conflict`，不更新原批准记录。

**验证命令**:
```bash
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "append-only approval rejects same contract_version with a different manifest_digest"
```

**硬阈值**: 真 PostgreSQL temp table 中同 digest 重放后 row 数仍为 1 且 `prd_content/contract_content` 保持首次批准值；第二次不同 digest 写入必须 reject；原 row 的 `manifest_digest` 不变。

---

### Step 3: Generator dispatch / callback / Evaluator / CI / merge gate 校验同一 digest + current PR SHA

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点要求这些节点都验证 current PR SHA + `manifest_digest`，缺 manifest、不可达、stale SHA/digest fail-closed。

**可观测行为**: dispatcher 在 launch 前对 approved manifest row 做 fail-closed preflight，缺 manifest 或 stale digest 不创建 attempt；dispatcher 将 approved manifest digest/source SHA 注入 task_bundle 与 env；Evaluator preflight 在跑 final-e2e 前校验 current PR SHA + manifest digest；callback 上报 verdict 时先服务端校验 `manifest_digest` 与 current PR SHA，校验通过才写 verdict；ground-truth 读取 verdict 时保留 digest；merge gate 只有 evaluate/judge 均 PASS 且 `pr_head_sha == current PR SHA` 且 `manifest_digest == approved digest` 才 allow；CI required check 脚本同样校验。

**验证命令**:
```bash
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "generator and evaluator dispatch carry approved manifest digest and source sha"
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "dispatch preflight rejects missing manifest stale digest and stale pr_head_sha before launch"
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "callback refuses stale manifest_digest before writing evaluator verdict"
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "callback refuses stale pr_head_sha before writing generator verdict"
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "generator callback refuses stale manifest_digest before writing generator verdict"
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "CI required check rejects missing stale digest and stale pr_head_sha fail closed"
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "mergeGate refuses PASS verdicts that do not carry the approved manifest_digest"
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "mergeGate refuses missing approved manifest_digest and stale judge manifest_digest"
```

**硬阈值**: dispatch env 必须含 `APPROVED_CONTRACT_MANIFEST_DIGEST` 与 `APPROVED_CONTRACT_SOURCE_SHA`；Generator launch preflight 缺 manifest 返回 `approved_contract_manifest_missing`、stale digest 返回 `stale_manifest_digest`；Evaluator preflight 缺 current PR SHA 返回 `current_pr_sha_missing`、stale PR SHA 返回 `stale_pr_head_sha`；evaluator callback stale digest 在写 verdict 前返回 `stale_evaluate_manifest_digest`；generator callback stale digest 在写 verdict 前返回 `stale_generator_manifest_digest`；callback stale generator PR SHA 在写 verdict 前返回 `stale_generator_pr_head_sha`；CI required check 缺 manifest 返回 `approved_contract_manifest_missing`、stale digest 返回 `stale_manifest_digest`、stale PR SHA 返回 `stale_pr_head_sha`；merge gate stale evaluator digest 返回 `{allow:false, reason:"stale_evaluate_manifest_digest"}`；judge digest 同理返回 `stale_judge_manifest_digest`；缺 approved digest 返回 `approved_contract_manifest_digest_missing`。

---

### Step 4: 冻结资产 drift fail-closed，Root DoD 只允许机械变化

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3/4 点要求 sprint-prd、contract、DoD、task-plan、tests、fixture/golden 删除/重命名/修改均拒绝；Root DoD 只允许 checkbox/evidence/provenance 机械变化，artifact path、Test command、动作、预期、环境和安全语义不得漂移。

**可观测行为**: `verifyApprovedContractManifest` 对当前 PR SHA 的 Git tree 与 manifest artifacts 逐项比对；`365 -> 366` 的 root DoD Test command/action 变化与 approved migration path 重命名返回 `approved_contract_drift`；Root DoD 的 Test command、动作、预期、环境、安全语义任一变化都返回 `approved_contract_drift`；checkbox-only、evidence-only、provenance-only 各自返回 ok 并列 `allowed_mechanical_changes`。

**验证命令**:
```bash
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "approved migration 365 changed to 366 is rejected as approved_contract_drift"
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "checkbox-only evidence-only and provenance-only root DoD edits are allowed"
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "root DoD Test command action expected environment and safety semantic edits are each rejected as approved_contract_drift"
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "approved sprint PRD contract DoD task-plan tests fixture golden deletion rename and content edits are each rejected as approved_contract_drift"
```

**硬阈值**: `365->366` 必须 `ok:false reason=approved_contract_drift` 且 drift 覆盖 root `DoD.md` 与原 365 migration path；Root DoD Test command/Action/Expected/Environment/Safety 任一单独语义变化必须 `approved_contract_drift`；checkbox-only/evidence-only/provenance-only 各自必须 `ok:true`；sprint-prd、contract-draft、contract-dod、task-plan、tests/**、fixture/golden 的任一单独删除/重命名/内容修改均列 drift path，且不得把 rename 当新 artifact 放行。

---

### Step 5: 缺 manifest / stale SHA / stale digest fail-closed

**来源**: `[FROM_PRD]` — PRD 边界情况要求 manifest 缺失、不可读、digest 不匹配、source/current PR SHA 不一致均 fail-closed。

**可观测行为**: validation helper、CI script、Evaluator preflight 与 merge gate 对缺 manifest、manifest digest mismatch、current PR SHA 缺失输出结构化拒绝 reason，不继续普通实现/修复流程。

**验证命令**:
```bash
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "missing manifest unreachable stale sha and stale manifest digest fail closed"
```

**硬阈值**: manifest load error → `approved_contract_manifest_unreachable`；缺 manifest → `approved_contract_manifest_missing`；digest 不匹配 → `stale_manifest_digest`；current PR SHA 缺失 → `current_pr_sha_missing`；命令 exit 0 只在这些拒绝 reason 被断言命中时成立。

---

### Step 6: 批准后 main migration 冲突输出 requires_re_gan

**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 点与边界情况要求批准后 main 冲突导致合同不可实现时输出 `requires_re_gan`，不得进入普通 fix loop；本合同基于当前 main 最新 migration 365，若需要 DB migration 固定使用 366。

**可观测行为**: 若 approved manifest/contract 固定 `packages/brain/migrations/366_approved_contract_provenance_manifest.sql`，但批准后 main 已出现另一个 366 migration，则 validation 输出 `{ok:false, reason:"requires_re_gan", conflict:"migration_number", migration_number:366}`，dispatcher/derive 不派 `spawn:generator-fix`。

**验证命令**:
```bash
npx vitest run sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts --testNamePattern "main migration conflict after approval returns requires_re_gan"
```

**硬阈值**: conflict reason 必须字面为 `requires_re_gan`；不得返回 `approved_contract_drift` 或普通 product failure。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> evaluator 需在当前 PR head 上执行；脚本必须看到真实 Git worktree、真实 Node/Vitest、真实 Postgres（`DB_URL` 或 `DATABASE_URL`），并且当前 PR SHA 与 approved manifest digest 由环境或 DB 读取。

```bash
#!/bin/bash
set -euo pipefail

SPRINT_DIR="${SPRINT_DIR:-sprints/0727184802-approved-contract-provenance}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://localhost/cecelia}}"
export DB_URL="$DB"
START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Step 1: sprint regression tests"
npx vitest run "$SPRINT_DIR/tests/approved-contract-provenance.test.ts" --reporter=verbose

echo "Step 2: existing orchestrator regression surface"
npx vitest run \
  packages/brain/src/orchestrator/__tests__/contract-store.test.js \
  packages/brain/src/orchestrator/__tests__/loop.test.js \
  packages/brain/src/orchestrator/__tests__/dispatcher.test.js \
  packages/brain/src/orchestrator/__tests__/ground-truth.test.js \
  packages/brain/src/orchestrator/__tests__/gates.test.js \
  --reporter=verbose

echo "Step 3: CI required check script validates approved manifest"
: "${APPROVED_CONTRACT_MANIFEST_DIGEST:?APPROVED_CONTRACT_MANIFEST_DIGEST required}"
: "${PR_HEAD_SHA:?PR_HEAD_SHA required}"
CI_JSON="$(node scripts/ci/approved-contract-provenance-check.mjs \
  --sprint-dir "$SPRINT_DIR" \
  --manifest-digest "$APPROVED_CONTRACT_MANIFEST_DIGEST" \
  --pr-head-sha "$PR_HEAD_SHA" \
  --repo-root "$(pwd)" \
  --json)"
echo "$CI_JSON" | jq -e '.ok == true and .manifest_digest == env.APPROVED_CONTRACT_MANIFEST_DIGEST'

echo "Step 4: approved manifest row is recently persisted"
COUNT="$(psql "$DB" -t -c "SELECT count(*) FROM initiative_contracts WHERE manifest_digest = '$APPROVED_CONTRACT_MANIFEST_DIGEST' AND approved_manifest IS NOT NULL AND source_commit_sha IS NOT NULL AND approved_at > NOW() - interval '5 minutes'" | tr -d ' ')"
[ "$COUNT" -ge 1 ] || { echo "FAIL: no recent approved manifest row since $START_TS"; exit 1; }

echo "OK: approved contract provenance final e2e passed"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| canonical manifest | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | canonical manifest freezes approved PRD contract DoD task-plan tests and fixture artifacts | `approved-contract-provenance.js` 不存在或未生成 artifacts/digest → FAIL |
| append-only DB approval | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | append-only approval rejects same contract_version with a different manifest_digest | 旧 `materializeApprovedContract` 覆写同 version 或同 digest 重放改正文 → FAIL |
| 365→366 drift | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | approved migration 365 changed to 366 is rejected as approved_contract_drift | 旧系统不比较 approved root DoD 语义或 approved migration path → FAIL |
| Root DoD 机械变化 | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | checkbox-only evidence-only and provenance-only root DoD edits are allowed | 任一 checkbox-only/evidence-only/provenance-only 机械变化被过严拒绝，或其他语义变化被误放行 → FAIL |
| Root DoD 安全语义漂移 | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | root DoD Test command action expected environment and safety semantic edits are each rejected as approved_contract_drift | Test command/动作/预期/环境/安全任一单独漂移仍通过 → FAIL |
| fail-closed reference | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | missing manifest unreachable stale sha and stale manifest digest fail closed | 缺 manifest/stale digest 被放行 → FAIL |
| dispatch digest propagation | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | generator and evaluator dispatch carry approved manifest digest and source sha | 现有 dispatch env 不注入 approved digest/source SHA → FAIL |
| dispatch/evaluator preflight | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | dispatch preflight rejects missing manifest stale digest and stale pr_head_sha before launch | launch/final-e2e 前未 fail-closed，缺 manifest 或 stale digest/SHA 仍创建 attempt/继续执行 → FAIL |
| callback digest preflight | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | callback refuses stale manifest_digest before writing evaluator verdict | 旧 callback 只落 verdict，不在写入前校验 digest → FAIL |
| callback PR SHA preflight | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | callback refuses stale pr_head_sha before writing generator verdict | generator callback stale PR SHA 被写入 verdict → FAIL |
| generator callback digest preflight | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | generator callback refuses stale manifest_digest before writing generator verdict | generator callback stale manifest_digest 被写入 verdict → FAIL |
| CI required check digest/SHA | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | CI required check rejects missing stale digest and stale pr_head_sha fail closed | CI 脚本缺失、只看 env、不读真实 Git/DB 或 stale digest/SHA 放行 → FAIL |
| merge gate digest | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | mergeGate refuses PASS verdicts that do not carry the approved manifest_digest | 现有 mergeGate 只看 pr_head_sha → FAIL |
| merge gate missing/stale digest | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | mergeGate refuses missing approved manifest_digest and stale judge manifest_digest | 缺 approved digest 或 stale judge digest 被放行 → FAIL |
| frozen artifact deletion/rename | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | approved sprint PRD contract DoD task-plan tests fixture golden deletion rename and content edits are each rejected as approved_contract_drift | sprint-prd、contract-draft、contract-dod、task-plan、tests/**、fixture/golden 任一单独删除/重命名/内容修改被放行 → FAIL |
| requires_re_gan | `sprints/0727184802-approved-contract-provenance/tests/approved-contract-provenance.test.ts` | main migration conflict after approval returns requires_re_gan | migration 冲突进入普通 fix loop 或被改号 → FAIL |

## 预期实现边界

| 文件 | 要求 |
|---|---|
| `packages/brain/src/orchestrator/approved-contract-provenance.js` | 新增 manifest 构建、digest canonicalization、Git artifact drift 验证、Root DoD 机械变化归一化、manifest reference 校验、dispatch context 构建、execution preflight、callback digest preflight、main migration conflict 检测。 |
| `packages/brain/src/orchestrator/contract-store.js` | `materializeApprovedContract` 升级或旁路到 `materializeApprovedContractManifest`；同 version 不同 digest 拒绝覆写。 |
| `packages/brain/src/orchestrator/loop.js` | `persist_contract_approval` 用 approved SHA 生成 manifest，并冻结 `sprint-prd/contract-draft/contract-dod/task-plan/tests/**/fixtures/golden/DoD.md/migration`。 |
| `packages/brain/src/orchestrator/dispatcher.js` | generator/evaluator/judge bundle 与 env 注入 approved manifest digest/source SHA；缺 manifest fail-closed。 |
| `packages/brain/src/routes/harness-callback.js` | evaluator/generator callback verdict 写入前核对 digest + PR SHA；decision_log detail 持久化 `manifest_digest`。 |
| `packages/brain/src/orchestrator/ground-truth.js` | collect evaluate/judge verdict 时保留 `manifest_digest` 并暴露 approved manifest row。 |
| `packages/brain/src/orchestrator/gates.js` | `mergeGate` 新增 `approvedManifestDigest` 必填校验，拒绝 stale/missing digest。 |
| `scripts/ci/approved-contract-provenance-check.mjs` | CI required check 入口；导出 `runApprovedContractProvenanceCheck({repoRoot,sprintDir,manifestDigest,prHeadSha,dbConfig})`，CLI 支持 `--repo-root --sprint-dir --manifest-digest --pr-head-sha --json`；读取 DB approved manifest 与当前 Git HEAD，验证 artifact drift。 |
| `packages/brain/migrations/366_approved_contract_provenance_manifest.sql` | 基于当前 main 最新 365 的下一个唯一 migration，添加 manifest 字段/索引/约束；若 main 已占用 366，必须 `requires_re_gan`。 |

## Notes

- contract-gate: present at `packages/brain/src/lib/contract-gate.js`; 本合同未跳过代码层 Contract Gate。
- PR #4372 只作为事故证据，不修改、不复用；回归 fixture 用本 sprint 测试临时 Git repo 自造 365→366 drift。
- Android/微信/第三方 API 不涉及，target_environment 固定 `local_api`。
- Round 8 修订：不扩 PRD scope，仅把三类弱 oracle 从“组合修改一次”收紧为“逐项单独证伪”：manifest artifact kind 字面映射、Root DoD checkbox/evidence/provenance 各自允许、Root DoD Test/Action/Expected/Environment/Safety 与冻结资产各自单独 drift 必须 fail。
