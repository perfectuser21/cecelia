# Kernel Equivalence Signer/Adapter Handoff

- 合同：`kernel-equivalence-2026-07-28`
- Brain：`1.268.7`
- Engine：`19.7.1`
- 矩阵：11 behaviors × 3 providers × 3 scenarios = 99 cells
- 当前：0/99 trusted bundles；99/99 blocked
- 统一 blocker：`seam_receipt_signer_missing`

本报告是实现交接，不是等价证明。每个 seam 必须部署自己的 Ed25519
`effect_receipt` signer 和真实 isolated adapter，完成 normal、violation、recovery
三场景；collector key 只能封包，不能替 seam 签名。根 trust registry 在 signer
部署前保持空，不允许提交 synthetic/private key。

本分支新增可信 runtime，但没有注册任何生产 adapter、cleanup verifier 或公钥：

- CLI 只有显式追加 `--trusted-runtime` 才进入可信加载路径；未追加时仍在原 wiring
  gate 无写退出。
- collector 只接受
  `KERNEL_EQ_COLLECTOR_KEY_FILE`（绝对路径、regular file、单 hard link、
  当前 UID、`0400|0600`）和 `KERNEL_EQ_COLLECTOR_KEY_ID`。任何
  `KERNEL_EQ_*PRIVATE_KEY|SECRET|KEY_PEM|KEY_VALUE` 原始秘密环境值都会拒绝。
- `--grant` 同样从受保护的绝对路径 regular file 读取。CLI/controller 不加载
  `effect_receipt` 私钥；只有对应 seam service 可调用冻结的
  `{ key_id, purpose, service_id, signEffectResult }` 端口。
- PostgreSQL runtime migration 为 **376**，明确排在 ReleaseRun `374` 与其
  closure `375` 之后，不覆盖两者。
  ledger 对 nonce/audit/bundle 为 append-only，head 用 revision + hash CAS。
  head trigger 同时禁止重根/跳 revision，并要求每个新 head 是旧 head 的已存 successor；
  recovery predecessor 只可来自当前 head→genesis 的 recursive ancestry。
- 当前分支不修改 Brain/Engine 版本面。集成者在迁移编号稳定后分配 release
  version 与 rollback target；回退 runtime 代码不删除 ledger 数据。

以下 11 行就是全部剩余生产 gap；每行均缺少三个独立部署项：
seam effect signer、表中 exact adapter、独立 cleanup verifier。

| Behavior | Actual seam | Exact adapter gap | Cells | 剩余生产部署 |
|---|---|---|---:|---|
| KERNEL-P0-01-BRANCH-PROTECTION | `kernel.workspace.protected_ref_guard` (`packages/brain/scripts/fleet-worker/github-mutation-broker.cjs`) | `kernel.drill.branch_protection.v1` | 9 | signer + adapter + independent cleanup verifier |
| KERNEL-P0-02-CREDENTIAL-GUARD | `kernel.credential.attempt_lease` (`packages/brain/src/orchestrator/credential-broker.js`) | `kernel.drill.credential_guard.v1` | 9 | signer + adapter + independent cleanup verifier |
| KERNEL-P0-03-BRANCH-PUSH-GUARD | `kernel.github.mutation_broker` (`packages/brain/scripts/fleet-worker/github-mutation-broker.cjs`) | `kernel.drill.branch_push_guard.v1` | 9 | signer + adapter + independent cleanup verifier |
| KERNEL-P0-04-CI-MERGE-AUTHORITY | `kernel.merge.effect_executor` (`packages/brain/src/orchestrator/merge-effect-executor.js`) | `kernel.drill.ci_merge_authority.v1` | 9 | signer + adapter + independent cleanup verifier |
| KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE | `kernel.evaluation.independent_judge` (`packages/brain/src/harness-judge.js`) | `kernel.drill.independent_evaluator_judge.v1` | 9 | signer + adapter + independent cleanup verifier |
| KERNEL-P0-06-HUMAN-REVIEW-AUTHORITY | `kernel.merge.human_review_authority` (`packages/brain/src/orchestrator/merge-authority.js`) | `kernel.drill.human_review_authority.v1` | 9 | signer + adapter + independent cleanup verifier |
| KERNEL-P0-07-RELEASE-PROMOTION | `kernel.release.staging_promotion` (`packages/brain/src/staging-promote.js`) | `kernel.drill.release_promotion.v1` | 9 | signer + adapter + independent cleanup verifier |
| KERNEL-P1-08-STOP-ORPHAN-LIVENESS | `kernel.liveness.orphan_recovery` (`packages/brain/src/lib/kernel-liveness.js`) | `kernel.drill.stop_orphan_liveness.v1` | 9 | signer + adapter + independent cleanup verifier |
| KERNEL-P1-09-DEVGATE-TDD-DOD | `kernel.quality.devgate` (`packages/engine/scripts/devgate/check-tdd-commit-order.sh`) | `kernel.drill.devgate_tdd_dod.v1` | 9 | signer + adapter + independent cleanup verifier |
| KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION | `kernel.controller.attempt_ownership` (`packages/brain/src/orchestrator/attempt-store.js`) | `kernel.drill.controller_session_isolation.v1` | 9 | signer + adapter + independent cleanup verifier |
| KERNEL-P1-11-REPORT-LEARNING-CLOSURE | `kernel.closure.report_learning` (`packages/brain/src/auto-learning.js`) | `kernel.drill.report_learning_closure.v1` | 9 | signer + adapter + independent cleanup verifier |

完成单个 handoff 的定义：

1. seam service 生成并安全托管私钥，只把 public key/lifecycle 登记到根 registry；
2. adapter 只操作 `equivalence-drill/{run_id}/{attempt_id}` 隔离资源；
3. adapter 支持 AbortSignal、cancel confirmation、partial-resource compensation；
4. seam 为真实 effect/denial 签发完整 receipt，recovery 引用已验 violation；
5. collector 验证 grant/effect/chain 后签 bundle；
6. 三 Provider × 三场景的 9 个 content-addressed bundles 写回 proof matrix；
7. `--check` 和 golden path 通过后，该 behavior 才可从 gap 改为 proven。

当前根校验：0 keys、0 trusted bundles、11 gaps、99/99 blocked。provisional
migration 会创建持久 ledger；回退应用代码不得删除或回写这些对象。
