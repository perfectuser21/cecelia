---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Draft PR #4457 Fresh Recovery R5

**范围**: 冻结当前事实、完整冲突与 CodeQL 修复、真实 oracle 证据、exact-head CI/evaluator/judge、人工 review gate。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] recovery verifier 与回归测试存在，且不含 shell string execution/suppress 绕过
  Test: node -e "const fs=require('fs');const p='scripts/harness/kernel-recovery-contract.mjs';const c=fs.readFileSync(p,'utf8');for(const x of ['verify-resolution','verify-manifest','verify-checks','verify-final-gate','spawn'])if(!c.includes(x))throw Error('missing '+x);for(const x of ['exec(','execSync(','--upload-pack','dismiss-alerts','continue-on-error: true'])if(c.includes(x))throw Error('forbidden '+x)"

- [ ] [ARTIFACT] CodeQL 7 条 annotation 的修复与必要回归覆盖均在目标分支 diff 内
  Test: node scripts/harness/kernel-recovery-contract.mjs verify-resolution --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --head "$FINAL_HEAD_SHA"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 写操作前冻结 PRD 指定的恢复事实
  动作: 从 GitHub 与 merge oracle 读取 source/main、冲突计数和 check-run 90903873908 annotations，写入仓外只创建一次的 baseline。
  预期观察: baseline 精确为 40 files、136 blocks、3 failure、4 warning，且 immutable=true；任一漂移判 stale。
  等待预算: 30s
  留证: ${ATTEMPT_ARTIFACT_DIR}/baseline.json 与冻结命令 raw log
  Test: manual:bash -c 'jq -e '\''.source_head_sha=="008fce85e1394a021b749a41187fac487c22b462" and .main_sha=="42a6a8aa502779d7a45fbc21ebece4ed8197233a" and .conflict_file_count==40 and .conflict_block_count==136 and .codeql.check_run_id==90903873908 and .codeql.failure_count==3 and .codeql.warning_count==4 and .immutable==true'\'' "$ATTEMPT_ARTIFACT_DIR/baseline.json"'

- [ ] [BEHAVIOR] [L2] B-02: 完整冲突与 7 条 CodeQL findings 语义收敛 [接缝×2]
  动作: 在既有 PR 分支对 frozen main 做真实 merge graph 校验，并对 annotation 修复与回归逐条核验两次。
  预期观察: conflict files/blocks 均为 0，main 为 final SHA 祖先，7/7 findings 有真实修复，PR head ref 未改变。
  等待预算: 120s
  留证: ${ATTEMPT_ARTIFACT_DIR}/resolution-run-1.log 与 resolution-run-2.log
  Test: manual:bash -c 'node scripts/harness/kernel-recovery-contract.mjs verify-resolution --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --head "$FINAL_HEAD_SHA" && node scripts/harness/kernel-recovery-contract.mjs verify-resolution --repo perfectuser21/cecelia --pr 4457 --baseline "$ATTEMPT_ARTIFACT_DIR/baseline.json" --head "$FINAL_HEAD_SHA"'

- [ ] [BEHAVIOR] [L2] B-03: 每个真实 child oracle 的 manifest 字段与 raw-log hash 可核验
  动作: 对 conflict、CodeQL regression、本地回归、required-context、evaluator、judge 的真实 child 逐行校验 argv/cwd/start/end/exit/raw log。
  预期观察: 所需 oracle 名无缺失，全部 child_started=true、exit_code=0，sha256 重算一致且绑定 final SHA。
  等待预算: 60s
  留证: ${ATTEMPT_ARTIFACT_DIR}/oracle-manifest.jsonl 与对应 raw logs
  Test: manual:bash -c 'node scripts/harness/kernel-recovery-contract.mjs verify-manifest --manifest "$ATTEMPT_ARTIFACT_DIR/oracle-manifest.jsonl" --head "$FINAL_HEAD_SHA"'

- [ ] [BEHAVIOR] [L2] B-04: 唯一 final SHA 的 CodeQL 与 required contexts 全部 SUCCESS [接缝×2]
  动作: 读取真实 GitHub exact-head check-runs，等待四类 gate 收敛后立即复读一次 PR head 与 checks。
  预期观察: CodeQL aggregate、ci-passed、Harness V5 Gate Passed、Smoke Glob Runner Passed 均为 SUCCESS，两次 head 都等于 final SHA。
  等待预算: 7200s
  留证: ${ATTEMPT_ARTIFACT_DIR}/github-checks-run-1.log 与 github-checks-run-2.log
  Test: manual:bash -c 'node scripts/harness/kernel-recovery-contract.mjs verify-checks --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --required "ci-passed,Harness V5 Gate Passed,Smoke Glob Runner Passed" --timeout-seconds 7200 && node scripts/harness/kernel-recovery-contract.mjs verify-checks --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --required "ci-passed,Harness V5 Gate Passed,Smoke Glob Runner Passed" --timeout-seconds 30'

- [ ] [BEHAVIOR] [L2] B-05: evaluator 与 judge 绑定 exact head，PR 停在人工 review gate
  动作: 读取仓外 evaluator/judge receipts 与真实 PR 状态，交叉核验同一 final SHA。
  预期观察: 两个 verdict exit_code=0；PR state=OPEN、isDraft=true、autoMergeRequest=null，且没有 merge/deploy/staging 动作。
  等待预算: 60s
  留证: ${ATTEMPT_ARTIFACT_DIR}/evaluator.json、judge.json、final-pr-state.json
  Test: manual:bash -c 'node scripts/harness/kernel-recovery-contract.mjs verify-final-gate --repo perfectuser21/cecelia --pr 4457 --head "$FINAL_HEAD_SHA" --receipts "$ATTEMPT_ARTIFACT_DIR"'

## Invariant 铁律逐条映射

- INV-01 LaunchAgent/服务双信号/常驻 manifest：N/A，本单不新增宿主服务。
- INV-02 status 枚举、时间常数、多轮扫描、定时入口、付费重扫：N/A，本单不改状态机或周期任务。
- INV-03 共享 CI 禁区：仅允许修复 PR 当前冲突/CodeQL 必要文件；共享 workflow/allowlist 无明确修复归属不得改。
- INV-04 跨端语义一致：B-03/04/05 对 final SHA 使用同一字面判定，unknown 不得在任一端放行。
- INV-05 Test Contract：contract-draft 表固定 4 列且 Test File 使用反引号。
- INV-06 表认领/消费者/DB 长度/DB_NAME：N/A，本单不新增或改 DB 写路径。
- INV-07 提前合并/merge 权：B-05 强制 OPEN Draft/no-auto-merge；generator 不得 merge。
- INV-08 git ref：verifier 仅允许 `rev-parse --verify <ref>^{commit}` 或 GitHub OID，不裸解析。
- INV-09 headed payload/环境透传/白名单：N/A，本单不改 headed 派发；不得凭历史合同假设路径。
- INV-10 oracle 真跑：B-02 至 B-05 记录真实 child exit 与解释器 argv，禁止 source inspection 代替行为验收。
- INV-11 真环境 done：GitHub/merge graph/receipts 接缝未真验只可 `logic-done-pending`。
- INV-12 Brain smoke/version：若冲突修复触及 `packages/brain/src`，必须按 DevGate 与 smoke/allowlist/version 现行规则全过。
- INV-13 错误不可 warning 降级：所有非零、超时、null/false、缺字段显式失败，不靠外层 catch。
- INV-14 依赖 advisory：若本轮真实出现则查 fixAvailable；不在本 PR findings 时不得扩 scope。
- INV-15 日志/凭据：raw logs 不含 token、PII、聊天内容；secret 不进 git。
- INV-16 TDD：Red commit 精确 add test path；毕业前跑 lint-tdd-commit-order 与 coverage。
- INV-17 端点 auth/多租户/租户隔离：N/A，本单不新增 endpoint 或租户数据面。
- INV-18 生产真相：B-01/04/05 用 GitHub 与 production PR 自报状态，不用 workspace diff 冒充。
- INV-19 通知语义/旅程停滞：N/A，本单不发通知、不改 journey_features。
- INV-20 新 task_type 七点接线：N/A，本单不新增 task type。
- INV-21 环境假设：repo、PR、SHA 来自显式 argv/baseline；不硬编码机器坐标、env 存在或 host 白名单。
- INV-22 恢复路径：fresh baseline 禁复用旧 worktree/中间 HEAD/R19 ledger；B-01 机械锁定。
- INV-23 单 slot 串行：task-plan 只有 ws1；实现者单写手。
- INV-24 部署安全：不 stage/deploy；失败不降级，不触碰生产资源。
- INV-25 CodeQL 命令安全：7 条 annotation 全真实修复；拒绝 shell format、second-order git option injection 与环境路径拼接。
- INV-26 judge 格式：judge receipt 必含顶层 exit_code/log_tail/behavior_tests，B-05 机械校验。
- INV-27 决策与回执：权威 receipts 仓外 append-only 且 exact-head；禁止提交造成自引用。
- INV-28 target_environment：task payload 与合同均为 local_api。

## 失败出口

- 任一 baseline/manifest/hash/check/receipt/PR 状态不符均 exit 非零；禁止 skip、allow-failure、dismiss 或旧证据补齐。

