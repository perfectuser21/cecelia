# Sprint Contract Draft (Round 1)

## 合同边界与 notes

- 仅恢复现有 Draft PR `#4457` / `cp-kernel-phase5b-a1-review-fixes`；禁止新建或合并 PR、启用 auto-merge、stage、deploy、改 branch protection 或弱化 CodeQL。
- 权威运行回执只写 Git 树外 `${ATTEMPT_ARTIFACT_DIR}`、Brain append-only events 或 GitHub Actions artifacts；禁止把回执提交到目标分支。
- `contract-gate: enabled`（`packages/brain/src/lib/contract-gate.js` 存在）。
- Registry 非空但快照已陈旧 353h；本单不新增 HTTP/DB schema，按 PRD 与 GitHub 当前只读事实起草。

## Response Schema（推导来源: PRD字面）

N/A — 本任务不新增 HTTP 响应。可观测合同是 Git SHA、GitHub PR/check-run 状态和 Git 树外 oracle manifest。

## 已知约束（来自回归测试与累积 FR）

- `[回归测试] packages/brain/scripts/ci/__tests__/skill-contract.test.mjs` → evaluator 只消费可信 exact-head 证据，不操作 GitHub。
- `[回归测试] packages/brain/src/orchestrator/__tests__/release-run-surfaces.test.js` → CodeQL 当前对 shell 命令构造报告 warning，修复后不得以 suppress/allow-failure 代替真实参数边界。
- `[回归测试] packages/brain/src/orchestrator/__tests__/release-run-worker-runtime.test.js` → worker runtime 命令面须继续走参数化边界。
- `[累积FR]` 本 line 暂无历史。
- `context-manifest` 返回任务不存在；不静默补造历史 FR。

## 真实调用方请求 shape

| 调用方 | 认证与入口 | 关键字段 |
|---|---|---|
| GitHub CLI / evaluator | `gh api` 使用运行环境 GitHub token；只读 `repos/perfectuser21/cecelia/...` | PR number=`4457`、head SHA、check name/conclusion/details_url |
| recovery generator | 本地 argv 数组调用 `git`/oracle，禁止拼 shell 字符串 | `source_head_sha`、`main_sha`、`final_head_sha`、`argv[]`、`cwd` |

DoD 与 E2E 必须沿用上述 repo、PR number 和 argv shape；不得把 ref、路径或用户值拼入 shell format string。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|---|---|---|
| **FR（做什么）** | 功能需求 | 冻结现状，语义解决 40 文件/136 块冲突和 7 条 CodeQL annotation，在唯一 final SHA 收齐 CI/evaluator/judge，停在人工 review。 |
| **NFR（做得多好）** | 可靠性 | 角色总预算 28800s；每个 oracle 记录 argv/cwd/start/end/exit/raw-log sha256；exact-head 严格一致。 |
| **Invariant（永不违反）** | 安全/一致性 | 不新建/合并 PR，不 stage/deploy，不提交权威回执，不 dismiss/suppress/缩窄扫描。 |
| **判定点（怎么知道）** | 外部状态判断 | 见下表。 |
| **保质期（何时过期）** | 证据寿命 | 任一 head SHA 移动即全部回执过期；baseline 一经建立不可改。 |
| **死亡告警（停了谁知道）** | 失败发现 | oracle 非零立即阻断，manifest 缺字段/哈希不符立即失败；CI 超时由 evaluator 非零上报。 |
| **失败语义（挂了怎么办）** | 故障策略 | fail closed；stale/conflict/annotation 漂移/head 移动均作废本轮证据。 |
| **效果确认（已发≠已生效）** | 生效回执 | GitHub exact-head checks、evaluator/judge receipt 与 PR OPEN Draft/no-auto-merge 交叉核验。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ baseline 是否新鲜 | A. 沿用 R19 ledger；B. 写操作前重新读取 PR/head/main/conflict/annotation | B | PRD 明定 fresh recovery | 在错误基线上修复并假绿 |
| ⚠️ CodeQL 是否真实修复 | A. dismiss/suppress；B. exact-head CodeQL aggregate SUCCESS | B | PRD 禁止弱化扫描 | 安全缺陷进入人工 review |
| ⚠️ 流程是否停在人工 review | A. 只看 CI；B. 同时断言 OPEN、Draft、autoMerge=null | B | PRD 出口定义 | 未授权合并或发布 |

上述判定点均由冻结 PRD明确，无 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 冻结事实不一致 | 标 stale，停止使用旧 ledger | 是，新 attempt 重新冻结 | 无放行 |
| child oracle 非零/字段或 hash 缺失 | 当前 manifest 行及整体验收失败 | 修复后可在同 final SHA 重跑 | 无自报 delegation |
| final SHA 移动 | 全部既有 receipts 失效 | 新 SHA 全量重跑 | 无中间 HEAD 绿复用 |
| required check 非 SUCCESS/超时 | 非零退出 | GitHub 重跑仍须绑定同 SHA | 不 allow-failure |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| PR ref、GitHub annotation、冲突文件路径 | 不可信外部输入 | 只作 argv 数组元素/JSON 数据，不作 shell 源码 | 拒绝 `--upload-pack`、选项注入、路径越界和格式字符串执行 |

## Golden Path

独立小路（无父路）

[冻结恢复事实] → [语义解决冲突与 CodeQL] → [真实逐 oracle manifest] → [唯一 SHA exact-head gates] → [独立 evaluator/judge] → [人工 review gate]

### Step 1: 写操作前冻结不可变恢复基线

**来源**: `[FROM_PRD]` — Golden Path 第 1 步与背景段。

**可观测行为**: 仓外 `baseline.json` 同时记录 source=`008fce85e1394a021b749a41187fac487c22b462`、main=`42a6a8aa502779d7a45fbc21ebece4ed8197233a`、40 files、136 blocks、check-run `90903873908` 的 3 failure/4 warning；R19 33-path 仅列为 regression input。

**验证命令**:
```bash
jq -e '.source_head_sha=="008fce85e1394a021b749a41187fac487c22b462" and .main_sha=="42a6a8aa502779d7a45fbc21ebece4ed8197233a" and .conflict_file_count==40 and .conflict_block_count==136 and .codeql.check_run_id==90903873908 and .codeql.failure_count==3 and .codeql.warning_count==4 and .immutable==true' "$ATTEMPT_ARTIFACT_DIR/baseline.json"
```

**硬阈值**: 所有字段字面相等，baseline 只创建一次；命令 exit=0。

### Step 2: 仅在既有 PR 分支语义收敛完整冲突与 CodeQL

**来源**: `[FROM_PRD]` — Golden Path 第 2 步、范围限定与边界情况。

**可观测行为**: 目标分支仍为 `cp-kernel-phase5b-a1-review-fixes`；current main 完整进入祖先链；mergeability 不再 conflicting；7 条真实 annotation 均由代码/回归修复，未新增 suppress/allow-failure/扫描缩窄。

**验证命令**:
```bash
node scripts/harness/kernel-recovery-contract.mjs verify-resolution --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --head "$FINAL_HEAD_SHA"
```

**硬阈值**: exit=0；conflict files=0、blocks=0；7/7 annotation 有真实修复归属；main 是 final SHA 祖先；PR head ref 不变。

### Step 3: 每个 manifest 行真实启动 child oracle并留证

**来源**: `[FROM_PRD]` — Golden Path 第 3 步与 NFR 可观测约束。

**可观测行为**: 每行记录非空 argv array、cwd、RFC3339 start/end、整数 exit_code、raw_log_path、64 位 sha256；hash 可重算；至少覆盖 conflict、CodeQL regression、本地回归、required-context、evaluator、judge。

**验证命令**:
```bash
node scripts/harness/kernel-recovery-contract.mjs verify-manifest --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl" --head "$FINAL_HEAD_SHA"
```

**硬阈值**: 每行 child_started=true、exit_code=0、hash 重算一致；oracle 名唯一且所需集合无缺失。

### Step 4: 唯一 final SHA 收齐 CodeQL 与三个 required contexts

**来源**: `[FROM_PRD]` — Golden Path 第 4 步。

**可观测行为**: CodeQL aggregate、`ci-passed`、`Harness V5 Gate Passed`、`Smoke Glob Runner Passed` 全部在同一 final SHA 为 SUCCESS，等待期间 SHA 不移动。

**验证命令**:
```bash
node scripts/harness/kernel-recovery-contract.mjs verify-checks --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --required 'ci-passed,Harness V5 Gate Passed,Smoke Glob Runner Passed' --timeout-seconds 7200
```

**硬阈值**: 四类 gate 均 SUCCESS；head_before=head_after=`$FINAL_HEAD_SHA`；超时/缺项/重复歧义均非零。

### Step 5: evaluator 与 judge exact-head 通过并停在人工 review

**来源**: `[FROM_PRD]` — Golden Path 第 5 步与范围外约束。

**可观测行为**: evaluator、judge receipt 均绑定 final SHA 且通过；PR 仍 OPEN、Draft、autoMerge=null，无 deployment/staging/merge。

**验证命令**:
```bash
node scripts/harness/kernel-recovery-contract.mjs verify-final-gate --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --receipts "$ATTEMPT_ARTIFACT_DIR"
```

**硬阈值**: evaluator/judge exit_code=0 且 receipt.sha 精确相等；PR 三个状态断言全部成立。

## 接缝清单

1. 本地恢复 worktree ↔ Git merge graph：[接缝×2] 重复解析完整 conflict set，两次结果不一致判 FLAKY。
2. final SHA ↔ GitHub CodeQL/required contexts：[接缝×2] 两次读取 exact-head checks，两次不一致或 SHA 移动判 FLAKY。
3. oracle child process ↔ 仓外 manifest/raw logs：真实 spawn、真实退出码、真实 sha256 重算；未真验为 `logic-done-pending`。

## 禁 mock 边清单

- `kernel-recovery-contract.mjs` ↔ 真实 `git` child/merge graph（不得 mock child_process 或伪造 conflict 清单）。
- `kernel-recovery-contract.mjs` ↔ 真实 GitHub API PR/check-run（不得用 fixture 代替 exact-head 终验）。
- child oracle ↔ Git 树外 manifest/raw log（不得 mock spawn、exit_code、文件 hash）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 向 verifier 传不存在的 SHA、PR 或非 JSON receipt，必须 fail closed。
- 重复提交: 对同一 final SHA 重跑 manifest/check verifier，结果必须幂等且不得改 PR。
- 中途中断: checks 等待中模拟 head 移动，旧 receipts 必须全部 stale。
- 边界值: annotation 6/8 条、required context 同名多条、空 raw log、hash 大小写异常均必须失败。
发现分级: P0/P1（安全假绿、未授权 merge/deploy、证据错绑）阻塞 merge；P2/P3 记 findings 不阻塞。

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

jq -e '.source_head_sha=="008fce85e1394a021b749a41187fac487c22b462" and .main_sha=="42a6a8aa502779d7a45fbc21ebece4ed8197233a" and .conflict_file_count==40 and .conflict_block_count==136 and .codeql.check_run_id==90903873908 and .codeql.failure_count==3 and .codeql.warning_count==4 and .immutable==true' "$ATTEMPT_ARTIFACT_DIR/baseline.json"

node scripts/harness/kernel-recovery-contract.mjs verify-resolution --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --head "$FINAL_HEAD_SHA"
node scripts/harness/kernel-recovery-contract.mjs verify-manifest --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl" --head "$FINAL_HEAD_SHA"
node scripts/harness/kernel-recovery-contract.mjs verify-checks --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --required 'ci-passed,Harness V5 Gate Passed,Smoke Glob Runner Passed' --timeout-seconds 7200
node scripts/harness/kernel-recovery-contract.mjs verify-final-gate --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --receipts "$ATTEMPT_ARTIFACT_DIR"

test "$(git rev-parse HEAD)" = "$FINAL_HEAD_SHA"
echo "PASS: PR #4457 exact-head recovery 已停在人工 review gate"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fresh recovery 合同执行器 | `sprints/08021631-kernel-pr4457-fresh-recovery-r5/tests/kernel-recovery-contract.test.ts` | `拒绝缺失的 baseline`、`拒绝 hash 不匹配的 oracle manifest`、`拒绝移动的 final head`、`只接受 OPEN Draft 且 autoMerge=null` | 实现文件尚不存在，4 tests 在 import 阶段 Red |

