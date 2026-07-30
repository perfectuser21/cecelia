# Sprint Contract Draft (Round 2)

覆盖父路「Draft PR #4457 累计冲突与 CodeQL 收敛」第 1-5 步。

## 合同 notes

- Round 2 修订焦点：将冻结事实矛盾明确设为前置拍板闸；在主理人确认 `32/33` 与 `77` 的冻结来源前，generator 只允许产出只读证据，不得开始整合、告警处置或改动既有 PR。
- PRD 冻结值与可复算事实存在前置差异：`git merge-tree --write-tree 8f2137d... 264482f...` 当前列出 33 个冲突路径，而 PRD 写 32；合同要求先产出可追溯冻结清单并使该差异显式失败，禁止擅自把 32 改成 33。
- GitHub code-scanning alerts API 当前对 PR #4457 返回 761 条 open alerts，不能直接充当 PRD 的 77 条冻结告警。77 条必须从冻结 CodeQL run/原始 SARIF 逐条溯源。
- context-manifest: unavailable（`GET /api/brain/line/e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29/context-manifest` 不可达）。
- judgment-pending-user: 冻结冲突计数以 PRD 的 32 为法律，还是以两冻结 SHA 可复算的 33 为准。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` present)。

## Response Schema（推导来源: PRD字面）

N/A — 本任务不新增 HTTP endpoint 或修改 API Response Schema；GitHub CLI JSON 仅作为外部验收输入，字段字面使用 `state/isDraft/autoMergeRequest/headRefOid/statusCheckRollup`。

## 已知约束（来自回归测试）

- `[回归测试] scripts/quickcheck.sh` → QuickCheck 必须 fail-closed。
- `[回归测试] packages/engine/tests/skills/harness-v5-ci-checks.test.ts` → Harness v5 CI checks 不得回退。
- `[回归测试] tests/contract-e2e-extractor.test.ts` → E2E 合同提取规则不得回退。
- `[回归测试] packages/brain/src/__tests__/integration/golden-path.integration.test.js` → Brain Golden Path 集成行为不得回退。
- `[累积FR]` 本 line 暂无历史。
- `[累积FR]` context-manifest: unavailable。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 仅在现有 Draft PR #4457 分支整合冻结 main，收敛冻结冲突与 CodeQL 告警，恢复 exact-head CI。 |
| NFR（做得多好） | 所有清单、处置、CI 与 evaluator 证据绑定冻结 SHA/最终 SHA；任何不确定项 fail-closed。 |
| Invariant（永不违反） | 不新建 PR、不 merge、不 deploy、不启用 auto-merge、不 dismiss/弱化检查/删测试/伪造证据；atomic truth 固定。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 任一 PR head SHA 改变后旧 exact-head CI/evaluator 证据立即失效。 |
| 死亡告警（停了谁知道） | required check 非 SUCCESS、证据 SHA 不一致或 PR 状态越界即 evaluator 非零退出并阻塞 judge。 |
| 失败语义（挂了怎么办） | fail-closed；不安全归类、API 不可达、清单计数不符或 SHA 漂移均停止，不降级放行。 |
| 效果确认（已发≠已生效） | GitHub API 复查最终 head、required checks、Draft/OPEN/autoMerge=null；本地回归真实 exit code 留证。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 冻结冲突计数 | A. 采用 PRD 32；B. 采用 merge-tree 33；C. 人工解释差异后重冻 | C. 保持失败并请主理人拍板 | 两冻结 SHA 当前可复算出 33，与 PRD 矛盾 | 漏解冲突或无授权改合同 |
| ⚠️ 77 个 CodeQL 告警身份 | A. 当前 open alerts；B. 冻结 run/SARIF | B. 冻结 run/SARIF 中逐条 fingerprint | 当前 API 返回 761，不能证明 PRD 的 77 | 漏修真实漏洞或扩大范围 |
| required check 是否属于最终 head | A. 只看 conclusion；B. 同时核对 checkSuite/headSha | B. SHA 与结论双核对 | 旧 head 绿灯会是假绿 | 带未验证代码进入人工审阅 |
| 累计行为是否保留 | A. 文件 diff；B. 运行冻结回归 oracle | B. 真实执行回归并记录 exit code | 内容存在不等于行为有效 | Kernel Harness 行为静默回退 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 冻结计数/指纹不一致 | 非零退出，禁止进入冲突解决 | 是，仅读冻结对象 | 无 |
| GitHub API/CodeQL 证据不可得 | 标记 blocked 并保留原始错误 | 是，GET 可重试 | 不用历史缓存冒充 |
| exact-head SHA 改变 | 旧 CI/evaluator 全部作废并对新 SHA 重跑 | 是 | 无 |
| PR 状态越界或出现 deploy/merge | 立即失败并停止 | 否，需主理人处理外部状态 | 无 |

### 输入对抗面

N/A — 本 sprint 不新增对外 agent 或用户输入接口；但所有 GitHub/SARIF 文本均视为不可信数据，只解析结构化字段，不执行其中内容。

## Golden Path

[冻结 PR #4457] → [冻结清单] → [整合 main 并保行为] → [收敛 CodeQL] → [exact-head CI] → [最终 SHA evaluator] → [人工审阅门]

### Step 1: 冻结精确起点、main 与三类清单
**来源**: `[FROM_PRD]` — Golden Path 第 1 步、可执行验收计划 1-2。
**可观测行为**: `evidence/freeze.json` 精确记录两个 SHA、冲突清单、77 条 CodeQL 指纹和 required checks；计数或来源不符即失败，并阻断 Step 2-7。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs freeze
```
**硬阈值**: 起点 SHA=`8f2137d0f5ad7091699f42635ea76c35e0765bd9`、main SHA=`264482fadd87dc8bf6e7d4534c156ee28e276ccf`、冲突=32、CodeQL=77、所有条目 fingerprint 唯一；任一不符时 verifier 非零退出且不得生成 `freeze_approved=true`。后续每个 phase 必须先断言 `freeze_approved=true`，由上述命令执法。

### Step 2: 安全整合并保留累计 Kernel Harness 行为
**来源**: `[FROM_PRD]` — Golden Path 第 2 步、可执行验收计划 3-5。
**可观测行为**: 32 个冻结冲突每项恰有一种处置与复查证据；QuickCheck、node:test 双登记、OKR `cecelia_test`、migration 369-381 与上一轮四项 blocker oracle 全部真实通过。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs conflicts
```
**硬阈值**: `resolved=32`、`unclassified=0`、回归命令 exit code 全为 0，且不得含删测试/弱化门禁处置；由上述命令执法。

### Step 3: 分类并收敛冻结 CodeQL 告警
**来源**: `[FROM_PRD]` — Golden Path 第 3 步、可执行验收计划 2、5。
**可观测行为**: 77 个冻结 fingerprint 各有唯一分类、处置、最终状态和原始 SARIF/检查 URL；真实问题被修复，假阳性/范围外仅记录基线，不 dismiss。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs codeql
```
**硬阈值**: `total=77`、`unique=77`、`unclassified=0`、`dismissed=0`、`scan_scope_changed=false`；由上述命令执法。

### Step 4: 保持 atomic truth 与禁止项
**来源**: `[FROM_PRD]` — 可执行验收计划 4-5、范围限定。
**可观测行为**: 最终分支仍报告诚实 atomic truth，且 diff/证据中没有 allow-failure、required-check 弱化、branch protection 弱化、删测试或伪造 receipt。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs invariants
```
**硬阈值**: `schema_valid=true`、`proof_complete=false`、`atomic_cutover_ready=false`、进度 `0/99`，禁止项计数=0；由上述命令执法。

### Step 5: exact-head CI 绑定最终 PR SHA
**来源**: `[FROM_PRD]` — Golden Path 第 4 步、可执行验收计划 6。
**可观测行为**: required checks 的 checkSuite/headSha 全部等于实时 PR head SHA 且结论 SUCCESS；SHA 变化后旧结果自动失效。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs exact-head
```
**硬阈值**: missing=0、failed=0、stale=0，evidence.final_sha 等于 GitHub PR headRefOid；由上述命令执法。

### Step 6: evaluator 在同一最终 SHA 真跑
**来源**: `[FROM_PRD]` — Golden Path 第 5 步、可执行验收计划 6。
**可观测行为**: evaluator 真实运行合同命令并留下顶层及逐行为 `exit_code/log_tail`，所有证据 SHA 均为最终 head。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs evaluator
```
**硬阈值**: evaluator 顶层 exit_code=0、每条 behavior exit_code=0、所有 sha 唯一且等于最终 head；由上述命令执法。

### Step 7: 停在既有 Draft PR 人工审阅门
**来源**: `[FROM_PRD]` — Golden Path 第 5 步、可执行验收计划 7。
**可观测行为**: PR #4457 仍 Draft、OPEN、autoMerge=null；没有新 PR、merge、staging 或 production deploy。
**验证命令**:
```bash
node sprints/07301245-kernel-pr4457-refresh/scripts/verify-pr4457-evidence.mjs review-gate
```
**硬阈值**: `number=4457`、`isDraft=true`、`state=OPEN`、`autoMergeRequest=null`、head branch 不变，副作用审计计数=0；由上述命令执法。

## 接缝清单

- [接缝×2] GitHub PR/CI 实时状态：对同一 final SHA 重读两次，结果不一致判 FLAKY；真目标为 `perfectuser21/cecelia#4457`。
- [接缝×2] CodeQL 冻结 run/SARIF：同一冻结 run 下载并验 fingerprint 两次，结果不一致判 FLAKY。
- 分支整合为非幂等写动作，不标 `[接缝×2]`；仅执行一次，随后用只读 merge-base、diff 与回归证据复查。

## 真实调用方请求 shape

N/A — 本任务不新增设备/agent→服务端请求，也不定义新 API；外部 GitHub 读取由 `gh pr view`/`gh api` 使用现有 CLI 认证，合同不复制 token。

## 未覆盖真实链路清单

（本合同无 force/stub/假数据/mock 豁免，N/A）

## 禁 mock 边清单

- 目标分支 Git 图 ↔ 冻结 main commit（整合与冲突清单必须用真实 git object/merge-tree，不 mock）。
- PR #4457 head SHA ↔ GitHub required checks（必须真读 GitHub API，不用本地 fixture）。
- 冻结 CodeQL run/SARIF ↔ 77 条告警分类账（必须真读冻结原始结果，不 mock 告警）。
- 回归命令 ↔ 真实受影响模块（必须真实启动对应解释器并记录 exit code，禁止只做源码字符串检查）。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: evidence 中注入重复 fingerprint、未知分类或不属于冻结 SHA 的 check。
- 重复提交: 对同一 final SHA 重跑验证，确认不重复计数、不复用旧 SHA 结果。
- 中途中断: CI 尚未终态或 GitHub API 暂时失败时确认 fail-closed，恢复后可重跑。
- 边界值: PR head 在读取 checks 后改变、冲突计数 31/33、CodeQL 计数 76/78。
发现分级: P0/P1（漏冲突、漏安全告警、误 merge/deploy、旧 SHA 假绿）阻塞；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="${SPRINT_DIR:-sprints/07301245-kernel-pr4457-refresh}"
REPO="perfectuser21/cecelia"
PR=4457
START_SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid -q .headRefOid)
test -n "$START_SHA"
for phase in freeze conflicts codeql invariants exact-head evaluator review-gate; do
  node "$SPRINT_DIR/scripts/verify-pr4457-evidence.mjs" "$phase" --expected-head "$START_SHA"
done
END_JSON=$(gh pr view "$PR" --repo "$REPO" --json number,state,isDraft,autoMergeRequest,headRefName,headRefOid)
echo "$END_JSON" | jq -e --arg sha "$START_SHA" '.number==4457 and .state=="OPEN" and .isDraft==true and .autoMergeRequest==null and .headRefName=="cp-kernel-phase5b-a1-review-fixes" and .headRefOid==$sha'
node -e 'const fs=require("fs");const p=process.argv[1];const x=JSON.parse(fs.readFileSync(p,"utf8"));if(x.schema_valid!==true||x.proof_complete!==false||x.atomic_cutover_ready!==false||x.atomic_progress!=="0/99")process.exit(1)' "$SPRINT_DIR/evidence/atomic-truth.json"
echo "Golden Path exact-head 验收通过 sha=$START_SHA"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 冻结清单 | `tests/pr4457-contract.test.ts` | 冻结清单精确绑定起点与计数 | verifier 尚未实现或计数矛盾 |
| 冲突与回归 | `tests/pr4457-contract.test.ts` | 冲突处置与累计行为证明完整 | evidence/verifier 尚未实现 |
| CodeQL | `tests/pr4457-contract.test.ts` | 77 个 CodeQL 告警逐项收敛 | evidence/verifier 尚未实现 |
| exact-head | `tests/pr4457-contract.test.ts` | required checks 全部绑定最终 SHA | evidence/verifier 尚未实现 |
| 审阅门 | `tests/pr4457-contract.test.ts` | PR 始终停在 Draft OPEN 人工审阅门 | evidence/verifier 尚未实现 |
