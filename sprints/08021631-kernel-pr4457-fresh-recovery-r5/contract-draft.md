# Sprint Contract Draft (Round 2)

## 合同边界与 notes

- 仅恢复现有 Draft PR `#4457` / `cp-kernel-phase5b-a1-review-fixes`；禁止新建或合并 PR、启用 auto-merge、stage、deploy、修改 branch protection 或弱化 CodeQL。
- 权威运行回执只写 Git 树外 `${ATTEMPT_ARTIFACT_DIR}`、Brain append-only events 或 GitHub Actions artifacts；目标分支不得提交运行回执。
- `contract-gate: enabled`（`packages/brain/src/lib/contract-gate.js` 存在）。
- Round 2 仅修正 reviewer 指出的四个真实漏项：完整 identity 冻结、branch protection 精确 oracle、oracle phase 顺序、仓外 root-owned append-only 证据边界；不扩展 PRD scope。

## Response Schema（推导来源: PRD字面）

N/A — 本任务不新增 HTTP 响应。可观测合同是 Git SHA、GitHub PR/check-run/branch-protection 状态和 Git 树外 oracle manifest。

## 已知约束（来自回归测试与累积 FR）

- `[回归测试] packages/brain/scripts/ci/__tests__/skill-contract.test.mjs` → evaluator 只消费可信 exact-head 证据，不操作 GitHub。
- `[回归测试] packages/brain/src/orchestrator/__tests__/release-run-surfaces.test.js` → shell 命令构造须继续使用参数化边界。
- `[回归测试] packages/brain/src/orchestrator/__tests__/release-run-worker-runtime.test.js` → worker runtime 命令面不得退回 shell 字符串拼接。
- `[累积FR]` 本 line 暂无历史；context-manifest 无可用历史，不补造。

## 真实调用方请求 shape

| 调用方 | 认证与入口 | 关键字段 |
|---|---|---|
| GitHub CLI / evaluator | `gh api` 使用运行环境 token；只读 `repos/perfectuser21/cecelia/...` | PR=`4457`、head SHA、check `name/status/conclusion/details_url`、protection `required_status_checks.strict/contexts` |
| recovery generator | argv 数组调用 `git`/oracle，禁止拼 shell 字符串 | `source_head_sha`、`main_sha`、`final_head_sha`、`argv[]`、`cwd` |

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|---|---|---|
| **FR（做什么）** | 功能需求 | 冻结完整现状 identity，语义解决冲突和 CodeQL，在唯一 final SHA 收齐 CI、独立 evaluator/judge，停在人工 review。 |
| **NFR（做得多好）** | 可靠性 | 28800s 总预算；每个 child 记录 argv/cwd/start/end/exit/raw-log sha256；exact-head 严格一致。 |
| **Invariant（永不违反）** | 安全/一致性 | 不新建/合并 PR，不 stage/deploy，不提交权威回执，不 dismiss/suppress/缩窄扫描，不改 protection。 |
| **判定点（怎么知道）** | 外部状态判断 | 见下表。 |
| **保质期（何时过期）** | 证据寿命 | source/main 冻结事实不符即 stale；final SHA 移动则该 SHA 的全部回执失效。 |
| **死亡告警（停了谁知道）** | 失败发现 | oracle 非零、identity 漂移、证据边界不合规或 CI 超时均 fail closed。 |
| **失败语义（挂了怎么办）** | 故障策略 | 不降级放行；同一 final SHA 可重跑，SHA 移动必须全量重验。 |
| **效果确认（已发≠已生效）** | 生效回执 | exact-head checks、branch protection、独立 evaluator/judge 与 OPEN Draft/no-auto-merge 交叉核验。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ baseline 是否新鲜且完整 | A. 只比计数；B. 冻结排序后的 40 条路径和 7 条 annotation identity 及集合摘要 | B | 计数相同仍可能替换成员 | 在错误冲突/安全集合上假绿 |
| ⚠️ required gates 是否真实受保护 | A. 只看 check 成功；B. 同时读取 protection strict=true 和 contexts 精确集合 | B | PRD NFR 明定 | 未受保护的偶然绿被当门禁 |
| ⚠️ evaluator/judge 是否独立复核 | A. generator manifest 预填；B. 本地 oracle 完成并推 final SHA 后再由独立角色追加 receipt | B | PRD Golden Path 顺序 | generator 自证冒充独立复核 |
| ⚠️ 权威证据是否不可自引用 | A. 只声明仓外；B. realpath/owner/mode/hash-chain 机械验证 | B | PRD 边界情况 | 回执提交导致 HEAD 自引用或可篡改 |

以上判定均已由冻结 PRD 与 reviewer 反馈明确，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 完整路径或 annotation identity 不一致 | baseline stale，写操作禁止开始 | 新 attempt 可重新冻结 | 不按计数补齐 |
| protection strict/contexts 不符 | 验收失败 | 管理者在本 sprint 外纠正后重验 | 本 sprint 禁止修改 protection |
| child 字段/hash/phase 不符 | 对应行及整体验收失败 | 同 final SHA 可真重跑 | 禁止预填 evaluator/judge |
| evidence 位于 Git 树内、非 root owner 或 hash-chain 断裂 | 权威证据无效 | 新仓外目录重跑 | 不提交 receipt |
| final SHA 移动 | 既有 CI/evaluator/judge 全 stale | 新 SHA 全量重跑 | 不复用中间 HEAD 绿 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| PR ref、annotation、冲突路径、artifact path | 不可信外部输入 | 只作 argv/JSON 值；路径 realpath 后做边界判定 | 拒绝选项注入、路径越界、shell format 与 repo 内证据目录 |

## Golden Path

独立小路（无父路）

[冻结完整恢复 identity] → [语义解决冲突与 CodeQL] → [本地真实 oracle] → [推唯一 final SHA 并收齐严格 CI] → [独立 evaluator/judge] → [人工 review gate]

### Step 1: 写操作前冻结完整、不可变的恢复基线

**来源**: `[FROM_PRD]` — Golden Path 第 1 步、背景与边界情况。

**可观测行为**: `baseline.json` 不仅记录 40/136 与 3/4 计数，还保存排序后的完整 `conflict_paths[40]`，以及 7 条 annotation 的稳定 identity（`classification_level/path/start_line/end_line/rule_id/message_sha256`）；各集合另存 canonical sha256。R19 33-path 只在 `historical_regression_paths` 中出现。

**验证命令**:
```bash
node scripts/harness/kernel-recovery-contract.mjs verify-baseline --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --source 008fce85e1394a021b749a41187fac487c22b462 --main 42a6a8aa502779d7a45fbc21ebece4ed8197233a --check-run 90903873908 --conflict-files 40 --conflict-blocks 136 --failures 3 --warnings 4
```

**硬阈值**: 路径数组恰好 40 个唯一规范化 repo-relative path；annotation identity 恰好 7 个唯一项（3 failure/4 warning）；两集合 canonical hash 可重算；baseline `O_EXCL` 只创建一次、mode=0444；exit=0。

### Step 2: 仅在既有 PR 分支语义收敛完整冲突与 CodeQL

**来源**: `[FROM_PRD]` — Golden Path 第 2 步、范围限定与边界情况。

**可观测行为**: 既有 head ref 不变；frozen main 进入 final SHA 祖先链；基线中的 40 条冲突路径逐条归零；7 条 annotation identity 逐条具有代码修复与真实回归归属，禁止 dismiss、allow-failure 或扫描缩窄。

**验证命令**:
```bash
node scripts/harness/kernel-recovery-contract.mjs verify-resolution --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --head "$FINAL_HEAD_SHA"
```

**硬阈值**: 40/40 path 与 136/136 block 收敛；7/7 identity 有真实修复归属；main 为祖先；PR head ref 未改变；exit=0。

### Step 3: 先执行本地真实 child oracle，并以 phase 约束 manifest

**来源**: `[FROM_PRD]` — Golden Path 第 3 步；`[AI_ADDED]` — Round 2 明确 phase 约束，防止预填尚未执行的 evaluator/judge。

**可观测行为**: push 前 manifest 只允许 `phase=local` 的 conflict、CodeQL regression、local regression 行；每行有 argv array、cwd、RFC3339 start/end、exit_code、raw_log_path/hash、head SHA、递增 sequence、prev_entry_sha256/entry_sha256。不得要求或预填 evaluator/judge。

**验证命令**:
```bash
node scripts/harness/kernel-recovery-contract.mjs verify-manifest --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl" --head "$FINAL_HEAD_SHA" --phase local --required 'conflict-resolution,codeql-regression,local-regression'
```

**硬阈值**: local 所需集合精确存在、child_started=true、exit_code=0、raw hash 与 entry hash-chain 均可重算；不存在未来 phase 行；exit=0。

### Step 4: 唯一 final SHA 收齐 CodeQL、严格 protection 与 required contexts

**来源**: `[FROM_PRD]` — Golden Path 第 4 步与 NFR 版本要求。

**可观测行为**: final SHA 只推一次；CodeQL aggregate 与三个 contexts 同 SHA SUCCESS；base branch protection 同时满足 `required_status_checks.strict=true` 且 contexts 排序后精确等于三项，不容许缺项或额外项。

**验证命令**:
```bash
node scripts/harness/kernel-recovery-contract.mjs verify-checks --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --required 'ci-passed,Harness V5 Gate Passed,Smoke Glob Runner Passed' --strict true --exact-contexts --timeout-seconds 7200
```

**硬阈值**: protection strict=true；required contexts 精确集合为 `ci-passed`、`Harness V5 Gate Passed`、`Smoke Glob Runner Passed`；CodeQL aggregate 与三 context 在 final SHA 均 SUCCESS；head_before=head_after；exit=0。

### Step 5: CI 完成后由独立 evaluator 与 judge 依序追加复核

**来源**: `[FROM_PRD]` — Golden Path 第 5 步；`[AI_ADDED]` — Round 2 将独立角色从 Step 3 前置集合移出，消除时序矛盾。

**可观测行为**: evaluator 先独立执行并追加 `phase=evaluator` 行与 receipt；其成功后 judge 独立执行并追加 `phase=judge` 行与 receipt。两者均绑定 final SHA，且 manifest phase 顺序只能是 local* → evaluator → judge。

**验证命令**:
```bash
node scripts/harness/kernel-recovery-contract.mjs verify-final-gate --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --receipts "$ATTEMPT_ARTIFACT_DIR" --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl"
```

**硬阈值**: evaluator/judge 均为真实 child、exit_code=0、receipt.sha 精确等于 final SHA；judge 位于 evaluator 之后；PR 为 OPEN、Draft、autoMergeRequest=null；exit=0。

### Step 6: 机械证明权威证据位于 Git 树外且 root-owned、append-only

**来源**: `[AI_ADDED]` — Round 2 reviewer 要求把 PRD 的证据边界从声明升级为机械 oracle。

**可观测行为**: verifier 对 repo top-level 与 artifact realpath 做组件边界比较；目录及权威文件 uid=0；目录禁止 group/other write；baseline 0444；manifest 仅允许带 sequence/hash-chain 的追加，所有 raw-log hash 可重算；`git ls-files` 不包含任何 artifact realpath。

**验证命令**:
```bash
node scripts/harness/kernel-recovery-contract.mjs verify-artifact-boundary --repo-root "$(git rev-parse --show-toplevel)" --artifact-dir "$ATTEMPT_ARTIFACT_DIR" --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl"
```

**硬阈值**: artifact realpath 不等于且不位于 repo realpath 下；uid=0；目录 mode 不含 0022；baseline mode=0444；manifest sequence 连续、hash-chain 完整、现有 entry 不可改写；exit=0。

## 接缝清单

1. frozen Git merge graph ↔ 完整 conflict/annotation identity：[接缝×2] 两次集合摘要不一致即 FLAKY。
2. final SHA ↔ GitHub protection/check-runs：[接缝×2] 两次 exact-head 读取不一致或 SHA 移动即 FLAKY。
3. child process ↔ 仓外 root-owned append-only manifest/raw logs：真实 spawn、真实 stat、真实 hash-chain；未真验为 `logic-done-pending`。

## 禁 mock 边清单

- recovery verifier ↔ 真实 `git` child/merge graph，不得 mock child process 或冲突集合。
- recovery verifier ↔ 真实 GitHub PR/check-run/branch-protection API，不得用 fixture 代替 exact-head 终验。
- child oracle ↔ Git 树外 root-owned artifact/manifest，不得 mock spawn、stat、exit_code 或 hash。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 传同计数但不同 conflict path/annotation identity 的 baseline，必须 stale。
- 重复提交: 对同 final SHA 重跑只读 verifier，结果幂等且不得改 PR 或改写旧 manifest 行。
- 中途中断: evaluator 后、judge 前中断，必须保持未完成且不得伪造 judge 行。
- 边界值: protection strict=false、contexts 多一/少一、artifact symlink 回 repo、manifest sequence 跳号均必须失败。
发现分级: P0/P1（安全假绿、证据自引用、未授权 merge/deploy）阻塞 merge；P2/P3 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${ATTEMPT_ARTIFACT_DIR:?必须指向 Git 树外 root-owned attempt artifacts}"
: "${FINAL_HEAD_SHA:?必须绑定唯一 final SHA}"
test "$(git branch --show-current)" = "cp-kernel-phase5b-a1-review-fixes"
test "$(git rev-parse HEAD)" = "$FINAL_HEAD_SHA"
node scripts/harness/kernel-recovery-contract.mjs verify-artifact-boundary --repo-root "$(git rev-parse --show-toplevel)" --artifact-dir "$ATTEMPT_ARTIFACT_DIR" --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl"
node scripts/harness/kernel-recovery-contract.mjs verify-baseline --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --source 008fce85e1394a021b749a41187fac487c22b462 --main 42a6a8aa502779d7a45fbc21ebece4ed8197233a --check-run 90903873908 --conflict-files 40 --conflict-blocks 136 --failures 3 --warnings 4
node scripts/harness/kernel-recovery-contract.mjs verify-resolution --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --head "$FINAL_HEAD_SHA"
node scripts/harness/kernel-recovery-contract.mjs verify-manifest --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl" --head "$FINAL_HEAD_SHA" --phase local --required 'conflict-resolution,codeql-regression,local-regression'
node scripts/harness/kernel-recovery-contract.mjs verify-checks --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --required 'ci-passed,Harness V5 Gate Passed,Smoke Glob Runner Passed' --strict true --exact-contexts --timeout-seconds 7200
node scripts/harness/kernel-recovery-contract.mjs verify-final-gate --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --receipts "$ATTEMPT_ARTIFACT_DIR" --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl"
test "$(git rev-parse HEAD)" = "$FINAL_HEAD_SHA"
echo "PASS: PR #4457 exact-head recovery 已停在人工 review gate"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fresh recovery 合同执行器 | `sprints/08021631-kernel-pr4457-fresh-recovery-r5/tests/kernel-recovery-contract.test.ts` | `拒绝同计数但路径身份漂移的 baseline`、`拒绝 annotation identity 漂移`、`拒绝 strict=false 或 contexts 非精确集合`、`拒绝 evaluator 在 local phase 预填`、`拒绝 Git 树内或非 root-owned 的证据目录`、`拒绝 hash 不匹配的 oracle manifest`、`拒绝移动的 final head`、`只接受 OPEN Draft 且 autoMerge=null` | verifier 尚不存在，测试在 import/断言阶段 Red |
