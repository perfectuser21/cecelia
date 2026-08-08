# Bug PrepPRD：kernel 收敛终局修理——投影器分支死结 + 账号解析 + claude 凭据 loader

## 症状
kernel run b4ac3396：generator 实际修好并让 required CI 全绿（PR #4725，V5 三闸 pass），但编排器"看不见"这个 PR，连派两轮 generator-fix 后以 no_progress_same_sha 收死。另：claude 执行体在 fleet 路径必"Not logged in"；不带 executor_account 的任务必 all_execution_targets_exhausted。

## 根因（三个独立缺陷，全部行级实锤）
1. **投影器分支死结**：harness-callback.js:302 严格比对 `headRef === workspace_spec.branch`（服务端发 `cp-fleet-generator-<attempt8>`），generator 按 SKILL 惯例自建 `cp-<MMDDHHNN>-<task8>` 分支开 PR → branch_mismatch → run 视角 pr==null → derive.js 走 no-PR 路线派 generator-fix → attempt3 无新 commit → no_progress_same_sha 终局。合法产出被机制拒收。
2. **账号解析缺失**：dispatcher.js:585 构造 target 时 account=roleAssignment.account ?? payload.executor_account ?? null；null 不在 execution-targets.js VERIFIED_TARGETS（claude 必须 account1/account2）→ isVerifiedExecutionTarget 跳过候选 → 零探针 exhausted（run c06b79af 实证）。
3. **claude 凭据 loader 未建**：credential-broker.js:83 硬编码读 `<accountHome>/auth.json`（codex 约定）+ tokenExpiry 读 auth.tokens.access_token（codex schema）；claude 凭据在 `.credentials.json`（claudeAiOauth schema）→ claude 执行体 fleet 路径必 Not logged in（attempt d80312c0 实证）。

## 关联上下文
- Journey：e6f803f2（kernel Harness 战役）；前序 task 65334686（#4722 repin 收官）
- 相关历史病：harness-evaluator-verdict-bug（relay 时代 FIXED=PASS 同型病）
- 案卷：run b4ac3396 三 attempt + harness-callback verifyUrl + capability-gate evaluate

## 修法
1. **投影器**（harness-callback.js verifyUrl）：branchMatches 放宽为 `headRef === expectedBranch || headRef.toLowerCase().includes(taskShort)`——taskShort 匹配与"无 expectedBranch 时"的既有保证等强（证明 PR 属于本 task），保留 repo 校验与 frozen lineage 校验不动。
2. **dispatcher**（dispatcher.js）：preferredTarget.account 为 null 时，按 provider+machine 从 listVerifiedExecutionTargets() 展开为具体账号候选列表（claude→account1/account2、codex→team1-5、grok→grok），preferred 取第一个，其余进 candidateTargets；显式指定 account 时行为不变。
3. **credential-broker**（credential-broker.js）：loader 按 provider 分流——codex 读 auth.json（现状不动）；claude 读 .credentials.json 且 expiry 解析 claudeAiOauth.expiresAt；grok 维持现状或显式 fail。broker 签发接口不变。

## Regression Test 计划（三个 failing test 先行，永留 CI）
- harness-callback 投影器：headRef=cp-xxx-<task8> ≠ expectedBranch 时应 verified（现红后绿）
- capability-gate/dispatcher：account=null 的 claude preferred target 应展开出 account1/account2 候选并可通过 gate（现红后绿）
- credential-broker：claude 账号 home 放 .credentials.json 时 loadCredential 应返回其内容且 expiry 正确（现红后绿）

## 验收标准
- [ ] 三个 failing test 先 commit，修复后全绿
- [ ] 既有测试不回归（orchestrator 相关 vitest 套 + fleet shell 套）
- [ ] CI 全绿合并
- [ ] 终局 E2E：重跑 kernel 验证任务（playground），run 推进过 generator 且 PR 被投影器 verified（不再 branch_mismatch 死循环）
