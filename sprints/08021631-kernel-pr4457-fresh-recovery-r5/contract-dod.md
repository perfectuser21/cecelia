---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Draft PR #4457 Fresh Recovery R5

**范围**: 完整 identity 冻结、冲突与 CodeQL 修复、分 phase 真 oracle、strict exact-head CI、独立 evaluator/judge、仓外 root-owned append-only 证据、人工 review gate。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] recovery verifier 和回归测试存在，且 verifier 提供 baseline identity/preflight order、single-push、protection exact-set、manifest phase、artifact boundary 校验
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('scripts/harness/kernel-recovery-contract.mjs','utf8');for(const x of ['verify-baseline','verify-preflight-order','verify-single-push','verify-resolution','verify-manifest','verify-checks','verify-final-gate','verify-artifact-boundary'])if(!c.includes(x))throw Error('missing '+x)"

- [ ] [ARTIFACT] Sprint 独立 Vitest 配置存在并只收集本 Sprint Red tests
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/08021631-kernel-pr4457-fresh-recovery-r5/vitest.config.mjs','utf8');if(!c.includes('kernel-pr4457-fresh-recovery-r5/tests'))throw Error('wrong include')"

- [ ] [ARTIFACT] 权威运行回执未进入目标 Git 树
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('scripts/harness/kernel-recovery-contract.mjs','utf8');for(const x of ['realpath','uid','entry_sha256','prev_entry_sha256'])if(!c.includes(x))throw Error('missing boundary '+x)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 冻结完整 conflict path 与 CodeQL annotation identity [接缝×2]
  动作: 在全新 attempt 中先启动 freeze，完成真实 merge oracle/check-run 集合冻结后才允许 fetch、merge 或任何 write。
  预期观察: journal 第 1/2 行为 freeze start/complete，之前敏感动作数为零；两次均为同一 40 path、136 blocks、7 annotation identity，canonical hash 相同。
  等待预算: 60s
  留证: ${ATTEMPT_ARTIFACT_DIR}/baseline.json 与 baseline-freeze-run-1.log、baseline-freeze-run-2.log
  Test: manual:bash -c 'node scripts/harness/kernel-recovery-contract.mjs verify-preflight-order --journal "$ATTEMPT_ARTIFACT_DIR/attempt-journal.jsonl" --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --forbid-before-freeze "fetch,merge,checkout_write,file_write,commit,push" && node scripts/harness/kernel-recovery-contract.mjs verify-baseline --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --source 008fce85e1394a021b749a41187fac487c22b462 --main 42a6a8aa502779d7a45fbc21ebece4ed8197233a --check-run 90903873908 --conflict-files 40 --conflict-blocks 136 --failures 3 --warnings 4'

- [ ] [BEHAVIOR] [L2] B-02: 完整冲突与七条 CodeQL findings 语义收敛 [接缝×2]
  动作: 在既有 PR 分支对 frozen main 做真实 merge graph 校验，并按 baseline identity 逐条核验修复与回归两次。
  预期观察: 40/40 path、136/136 block 清零，7/7 identity 有真实修复，main 为 final SHA 祖先，PR head ref 未改变。
  等待预算: 180s
  留证: ${ATTEMPT_ARTIFACT_DIR}/resolution-run-1.log 与 resolution-run-2.log
  Test: manual:bash -c 'node scripts/harness/kernel-recovery-contract.mjs verify-resolution --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --head "$FINAL_HEAD_SHA" && node scripts/harness/kernel-recovery-contract.mjs verify-resolution --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --head "$FINAL_HEAD_SHA"'

- [ ] [BEHAVIOR] [L2] B-03: local manifest 只含已真实执行的本地 oracle
  动作: push 前逐个真实启动 conflict、CodeQL regression、local regression child，并校验 local phase manifest。
  预期观察: 三个 local oracle 的 argv/cwd/start/end/exit/raw hash/head/sequence/hash-chain 完整；不存在提前填写的 evaluator 或 judge 行。
  等待预算: 600s
  留证: ${ATTEMPT_ARTIFACT_DIR}/oracle-manifest.jsonl 与 local raw logs
  Test: manual:bash -c 'node scripts/harness/kernel-recovery-contract.mjs verify-manifest --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl" --head "$FINAL_HEAD_SHA" --phase local --required "conflict-resolution,codeql-regression,local-regression"'

- [ ] [BEHAVIOR] [L2] B-04: branch protection strict 与 required contexts 精确集合成立 [接缝×2]
  动作: 在 final SHA 上读取真实 base branch protection 与 check-runs，等待成功后复读 PR head 和同一组 gates。
  预期观察: strict=true；contexts 恰为 ci-passed、Harness V5 Gate Passed、Smoke Glob Runner Passed；CodeQL aggregate 与三项同 SHA SUCCESS，无额外/缺失 context。
  等待预算: 7200s
  留证: ${ATTEMPT_ARTIFACT_DIR}/github-protection.json、github-checks-run-1.log、github-checks-run-2.log
  Test: manual:bash -c 'node scripts/harness/kernel-recovery-contract.mjs verify-checks --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --required "ci-passed,Harness V5 Gate Passed,Smoke Glob Runner Passed" --strict true --exact-contexts --timeout-seconds 7200 && node scripts/harness/kernel-recovery-contract.mjs verify-checks --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --required "ci-passed,Harness V5 Gate Passed,Smoke Glob Runner Passed" --strict true --exact-contexts --timeout-seconds 30'

- [ ] [BEHAVIOR] [L2] B-04A: 目标分支仅推送一次 final SHA [接缝×2]
  动作: 从 attempt journal 与 GitHub 真实 ref update 对账既有目标分支的本轮更新次数和 old/new OID。
  预期观察: push_started/push_completed 各一行，唯一更新从 frozen source 直接到 final SHA，不存在中间 SHA push。
  等待预算: 60s
  留证: ${ATTEMPT_ARTIFACT_DIR}/attempt-journal.jsonl 与 single-push-run-1.log、single-push-run-2.log
  Test: manual:bash -c 'node scripts/harness/kernel-recovery-contract.mjs verify-single-push --repo perfectuser21/cecelia --pr 4457 --journal "$ATTEMPT_ARTIFACT_DIR/attempt-journal.jsonl" --old 008fce85e1394a021b749a41187fac487c22b462 --new "$FINAL_HEAD_SHA" --ref refs/heads/cp-kernel-phase5b-a1-review-fixes --count 1 && node scripts/harness/kernel-recovery-contract.mjs verify-single-push --repo perfectuser21/cecelia --pr 4457 --journal "$ATTEMPT_ARTIFACT_DIR/attempt-journal.jsonl" --old 008fce85e1394a021b749a41187fac487c22b462 --new "$FINAL_HEAD_SHA" --ref refs/heads/cp-kernel-phase5b-a1-review-fixes --count 1'

- [ ] [BEHAVIOR] [L2] B-05: evaluator 后 judge 独立追加 exact-head receipt
  动作: CI 成功后先由独立 evaluator 真跑并追加 receipt/manifest 行，再由独立 judge 真跑并追加下一行。
  预期观察: phase 顺序为 local*、evaluator、judge；两者 exit_code=0 且 sha 等于 final SHA；PR 仍 OPEN Draft、autoMergeRequest=null。
  等待预算: 1800s
  留证: ${ATTEMPT_ARTIFACT_DIR}/evaluator.json、judge.json、oracle-manifest.jsonl、final-pr-state.json
  Test: manual:bash -c 'node scripts/harness/kernel-recovery-contract.mjs verify-final-gate --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --receipts "$ATTEMPT_ARTIFACT_DIR" --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl"'

- [ ] [BEHAVIOR] [L2] B-06: 权威证据目录机械满足仓外 root-owned append-only
  动作: 对 repo 与 artifact realpath、owner、mode、baseline 只读位、manifest sequence/hash-chain、raw-log hash 执行真实文件系统校验。
  预期观察: artifact 不在 Git root 内，uid=0，目录无 group/other write，baseline=0444，旧 manifest entry 不可改写且 hash-chain 连续。
  等待预算: 30s
  留证: ${ATTEMPT_ARTIFACT_DIR}/artifact-boundary.log 与 stat/realpath 输出
  Test: manual:bash -c 'node scripts/harness/kernel-recovery-contract.mjs verify-artifact-boundary --repo-root "$(git rev-parse --show-toplevel)" --artifact-dir "$ATTEMPT_ARTIFACT_DIR" --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl"'

## Invariant 铁律逐条映射

- INV-01 常驻服务/LaunchAgent/双信号：N/A，本单不新增宿主服务。
- INV-02 status/时间常数/周期扫描：N/A，本单不改状态机或周期任务。
- INV-03 共享 CI 禁区：workflow/allowlist 无冻结冲突或 annotation 归属不得改。
- INV-04 跨端语义一致：所有阶段对 final SHA、SUCCESS、stale 使用同一判定。
- INV-05 Test Contract：固定四列，Test File 用反引号。
- INV-06 DB 表/消费者/长度/DB_NAME：N/A，本单不改 DB 写路径。
- INV-07 merge 权与提前合并：B-05 强制 OPEN Draft/no-auto-merge；generator 不得 merge。
- INV-08 git ref：实现只用 `rev-parse --verify <ref>^{commit}` 或 GitHub OID。
- INV-09 headed payload/环境：N/A，本单不改派发，不从先例假设执行历史。
- INV-10 oracle 真跑：B-01 至 B-06 均真实执行并记录解释器 argv/exit。
- INV-11 真环境 done：GitHub/merge graph/filesystem 接缝未真验只可 logic-done-pending。
- INV-12 Brain DevGate/smoke/version：若 resolution 触及 Brain，现行门禁和版本同步必须全过。
- INV-13 错误不降级：非零、超时、null/false、缺字段全部 fail closed。
- INV-14 advisory：若真实出现则查 fixAvailable；否则不扩 scope。
- INV-15 日志/凭据：raw log 脱敏，token/PII/secret 不进 git。
- INV-16 TDD：Red 只 add 精确测试路径；毕业前跑 TDD 顺序与 coverage 门禁。
- INV-17 auth/多租户/隔离：N/A，本单不新增 API 或租户数据面。
- INV-18 生产真相：B-01/04/05 用 GitHub 与真实 Git graph，不用 workspace diff 冒充。
- INV-19 通知/旅程停滞：N/A，本单不发通知、不改 journey_features。
- INV-20 新 task_type 七点：N/A，本单不新增 task type。
- INV-21 环境假设：repo/PR/SHA/path 均来自显式参数并 realpath，不假设 host/env。
- INV-22 fresh recovery：禁止旧 worktree、中间 HEAD 绿或 R19 ledger 冒充当前集合。
- INV-23 单 slot：task-plan 仅 ws1，单实现者。
- INV-24 部署安全：不 stage/deploy，不触碰生产资源。
- INV-25 CodeQL：七条 identity 真修，拒绝 shell format、dismiss 与扫描缩窄。
- INV-26 judge 格式：顶层 exit_code/log_tail/behavior_tests 完整，B-05 校验。
- INV-27 决策与回执：B-01 证明 freeze 是首动作，B-04A 证明唯一 push，B-06 证明仓外 root-owned hash-chain，禁止 Git 自引用。
- INV-28 target_environment：task payload 与合同均为 local_api。

## 失败出口

- 任一 identity、protection、manifest phase/hash、artifact boundary、exact-head receipt 或 PR 状态不符均 exit 非零；禁止 skip、allow-failure、dismiss 或旧证据补齐。
