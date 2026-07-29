# Kernel Atomic Inventory P1 — Normative Appendix

日期：2026-07-29
状态：规范性附录（Phase 5B review workspace）
范围：`KERNEL-INV-P1-08-*` 至 `KERNEL-INV-P1-11-*`

## 1. 规范

本附录取代设计草案中 P1-08～P1-11 的简写清单。每个 atom 只允许一个
effect owner/seam；同一 owner 下的输入、状态和攻击变体必须建模为 probe，不能继续拆成
实现入口 atom。

稳定计数如下：

| Family | Atoms | Proof-required | Probes |
|---|---:|---:|---:|
| P1-08 Stop / Orphan / Liveness | 5 | 4 | 44 |
| P1-09 DevGate / TDD / DoD | 5 | 5 | 71 |
| P1-10 Controller / Session Isolation | 4 | 4 | 40 |
| P1-11 Report / Learning Closure | 4 | 4 | 33 |
| **合计** | **18** | **17** | **188** |

分类计数：

| Classification | Count |
|---|---:|
| `active_required` | 10 |
| `drifted_required_gap` | 6 |
| `intentional_replacement` | 1 |
| `retired` | 1 |

维度标识严格使用：

`fr`、`nfr`、`invariant`、`checkpoint`、`freshness`、`death_alert`、
`failure_semantics`、`effect_confirmation`、`adversarial_surface`、
`ledger_freshness`、`axis_alignment`。

除 retired atom 外，每个 recovery probe 必须绑定：

1. 同一 invariant、Provider、case 和资源身份的 exact violation receipt；
2. 同一 artifact SHA 和 resource generation；
3. violation 的 observed outcome 必须是 `denied` 或明确的 unsafe legacy observation；
4. 修复后重新调用同一个 owner/seam，并签发新的 owner effect receipt。

## 2. P1-08 Stop / Orphan / Liveness

## KERNEL-INV-P1-08-01

| Field | Normative value |
|---|---|
| classification | `retired` |
| single owner/seam | `engine.stop.dev_router_absence` |
| legacy truth | 旧 `stop-dev.sh`、`devloop-check.sh`、`ship-finalize.sh` 会话流程 owner 已删除；`stop.sh` 不得重新路由至它们。 |
| retirement decision ref | commit `ce06281543458e3f14ae68ca57fede2f6b5d4194` / PR `#3086`：以 goal-based stop hook 替代旧 dev router |
| retirement rationale | 旧会话脚本 authority 已由 durable goal/Attempt closure 取代，恢复它会重建平行控制面。 |
| repo evidence | `packages/engine/hooks/stop.sh`; `packages/engine/tests/hooks/stop-sh-routing.test.ts`; deletion commits `ce06281543458e3f14ae68ca57fede2f6b5d4194`、`f66eb9165913d596faf24fb89a88d2095ea7cfd8` |
| canonical steps | `S12` |
| canonical dimensions | `invariant`, `checkpoint`, `adversarial_surface` |
| receipt policy | `not_required`; 只验证 retirement decision 与 4 项 fresh absence proof |
| absence proof scope | exact repository/artifact SHA、受控 hook/settings scope、独立 observer、`verified_at/expires_at` 与 absence effect digest |

Scenario mapping：本 atom 无 live normal/violation/recovery receipt；以下四项全部是
retirement absence probes，任一失败即视为旧 authority 复活。

- KERNEL-PROBE-P1-08-01-A01 | absence | `packages/engine/hooks/stop-dev.sh` 必须不存在。
- KERNEL-PROBE-P1-08-01-A02 | absence | `stop.sh` 不得包含 `stop-dev.sh` 的可执行调用。
- KERNEL-PROBE-P1-08-01-A03 | absence | `packages/engine/lib/devloop-check.sh` 必须不存在。
- KERNEL-PROBE-P1-08-01-A04 | absence | `packages/engine/scripts/ship-finalize.sh` 必须不存在。

## KERNEL-INV-P1-08-02

| Field | Normative value |
|---|---|
| classification | `intentional_replacement` |
| single owner/seam | `engine.stop.dev_mode_turn_guard` |
| legacy truth | fresh `.cecelia/lights/*.live` 存在时，Claude PreToolUse guard 阻止 `ScheduleWakeup` 和 Bash background，强迫 foreground/Stop-loop 继续。该会话级 owner 仍 active，但不迁移；其“未完成工作不得因 session 退出而丢失”的目的由 durable Attempt/controller reconciliation 替代。 |
| repo evidence | `.claude/settings.json`; `packages/engine/hooks/dev-mode-tool-guard.sh`; `packages/engine/tests/integration/dev-mode-tool-guard.test.sh` |
| canonical steps | `S2,S3,S4,S5,S6,S7,S8,S9,S10,S11,S12` |
| canonical dimensions | `nfr`, `invariant`, `checkpoint`, `freshness`, `failure_semantics`, `adversarial_surface` |
| forbidden legacy authority | dynamic prompt/Stop-loop 不得拥有 merge、quality verdict、timeout auto-PASS 或 tmux self-kill authority |
| replacement behavior | Harness Controller 维持单 Harness/Attempt 的执行活性；Kernel Global Controller 根据 Attempt、receipt 和 terminal closure 决定全局继续、阻断或完成，两者都不依赖交互 session 存活 |

Scenario mapping：normal 证明前台工具调用不被误伤；violation 证明主动逃离 turn 的工具被
旧 owner 阻止；recovery 必须从 exact denial 回到同一 Attempt 的 foreground 执行，并由
Harness Controller 接管局部执行活性，Kernel Global Controller 接管跨 Harness 与全局
closure。

- KERNEL-PROBE-P1-08-02-N01 | normal | fresh light 下 Bash `run_in_background:false` 必须允许。
- KERNEL-PROBE-P1-08-02-N02 | normal | fresh light 下未提供 background 字段的普通 Bash 必须允许。
- KERNEL-PROBE-P1-08-02-V01 | violation | fresh light 下 `ScheduleWakeup` 必须返回 block/exit 2。
- KERNEL-PROBE-P1-08-02-V02 | violation | fresh light 下 Bash `run_in_background:true` 必须返回 block/exit 2。
- KERNEL-PROBE-P1-08-02-R01 | recovery | 绑定 V01，改用 foreground wait 后同一 Attempt 可继续且不得生成第二 session owner。
- KERNEL-PROBE-P1-08-02-R02 | recovery | 绑定 V02，改用 foreground Bash 后由 durable heartbeat/receipt 延续活性。

## KERNEL-INV-P1-08-03

| Field | Normative value |
|---|---|
| classification | `active_required` |
| single owner/seam | `engine.stop.orphan_worktree_disposition` |
| legacy truth | Stop orphan-cleanup 对每个 worktree 产生 preserve/remove disposition：主 checkout、active-lock、dirty 或未 merge 均 preserve；clean+merged 才尝试 remove。旧进程锁只在 `flock` 可用时生效，remove 失败会被吞掉，不能超声明为 mandatory lock 或 durable success。 |
| repo evidence | `packages/engine/hooks/stop.sh:80`; `packages/engine/hooks/lib/worktree-guard.sh`; `packages/engine/hooks/tests/stop-worktree-guard.manual-test.sh` |
| canonical steps | `S9,S12` |
| canonical dimensions | `invariant`, `checkpoint`, `failure_semantics`, `effect_confirmation`, `adversarial_surface` |

Scenario mapping：normal 是合法 preserve/remove disposition；violation 是不满足清理准入或未
持有可用锁；recovery 从 exact preserve/failed observation 重新评估同一路径，不允许盲目
`--force` 重放。

- KERNEL-PROBE-P1-08-03-N01 | normal | clean、无 active lock、PR 已 MERGED 的 linked worktree 进入 remove candidate。
- KERNEL-PROBE-P1-08-03-N02 | normal | `flock` 可用且成功取得 common-dir lock 后才执行扫描。
- KERNEL-PROBE-P1-08-03-N03 | normal | 主 checkout 必须 preserve，不进入 remove。
- KERNEL-PROBE-P1-08-03-V01 | violation | `.dev-lock*` 存在时必须 preserve。
- KERNEL-PROBE-P1-08-03-V02 | violation | `.dev-mode.*` 存在时必须 preserve。
- KERNEL-PROBE-P1-08-03-V03 | violation | `git status --porcelain` 非空时必须 preserve。
- KERNEL-PROBE-P1-08-03-V04 | violation | PR 非 MERGED、状态未知或 `gh` 查询失败时必须 preserve。
- KERNEL-PROBE-P1-08-03-R01 | recovery | 绑定 V01/V02，锁已确认失效或释放后重新评估，仍须再次检查 dirty 与 merge state。
- KERNEL-PROBE-P1-08-03-R02 | recovery | 绑定 remove failure，重试必须重新持锁、重新快照并确认真实 worktree absence；legacy `|| true` 不构成成功 receipt。

## KERNEL-INV-P1-08-04

| Field | Normative value |
|---|---|
| classification | `drifted_required_gap` |
| single owner/seam | `kernel.liveness.recovery_admission` |
| legacy truth | `assessTaskLiveness` 已按 executor kind 返回 `alive/dead/unknown + onStale`，Kernel-process 已优先读取 heartbeat，再读 same-host PID；unknown 设计为 fail-open。漂移在于所有守护刀尚未统一消费该 authority、零-attempt 缺少一致可见记录，且旧 relay 信号仍可能旁路 Kernel 判活。 |
| repo evidence | `packages/brain/src/executor-contracts.js`; `packages/brain/src/lib/kernel-liveness.js`; `packages/brain/src/zombie-reaper.js`; executor/liveness/watchdog tests |
| canonical steps | `S2,S3,S4,S5,S6,S7,S8,S9,S10,S11,S12` |
| canonical dimensions | `nfr`, `invariant`, `checkpoint`, `freshness`, `death_alert`, `failure_semantics`, `effect_confirmation`, `adversarial_surface`, `ledger_freshness` |
| drift expected | 所有 kill/requeue/reignite/release-claim/cleanup 先消费同一 liveness receipt；只有正面 dead 证据允许破坏性恢复 |
| drift observed | kind/signal 逻辑已存在，但消费方和 zero-attempt visibility 未完全收口 |

Scenario mapping：normal 证明各 executor 的真实活性信号；violation 覆盖无证据、错误信号和
stale window；recovery 仅能从 exact dead/unknown predecessor 进入与 `onStale` 匹配的
一次性恢复。

- KERNEL-PROBE-P1-08-04-N01 | normal | brain-local `activeProcesses` 中 live PID → `alive`。
- KERNEL-PROBE-P1-08-04-N02 | normal | brain-local docker container present → `alive`。
- KERNEL-PROBE-P1-08-04-N03 | normal | relay-container present → `alive`。
- KERNEL-PROBE-P1-08-04-N04 | normal | Kernel heartbeat 在 freshness window 内 → `alive/heartbeat`，不读取 relay container。
- KERNEL-PROBE-P1-08-04-N05 | normal | Kernel heartbeat stale、same-host PID `kill(0)` 成功或 EPERM → `alive/pid`。
- KERNEL-PROBE-P1-08-04-N06 | normal | headed-session 的 claimed PID 或 tmux session 存活 → `alive`。
- KERNEL-PROBE-P1-08-04-N07 | normal | bridge `last_attempt_at` 在宽限期内 → `alive`；external-worker → `alive/onStale=never`。
- KERNEL-PROBE-P1-08-04-V01 | violation | executor kind 为 null → `unknown`，不得 kill/requeue。
- KERNEL-PROBE-P1-08-04-V02 | violation | 未知 executor kind → `unknown`，不得套用默认 destructive policy。
- KERNEL-PROBE-P1-08-04-V03 | violation | 任一 probe 抛错 → `unknown`。
- KERNEL-PROBE-P1-08-04-V04 | violation | brain-local 无记录、bridge 标记或 PID 非正数 → `unknown`。
- KERNEL-PROBE-P1-08-04-V05 | violation | relay docker 查询失败 → `unknown`；容器明确缺失才可 `dead/reignite`。
- KERNEL-PROBE-P1-08-04-V06 | violation | Kernel 无 run、DB error、无 PID、host mismatch 或未知 kill error → `unknown`。
- KERNEL-PROBE-P1-08-04-V07 | violation | Kernel same-host PID 返回 ESRCH 才可 `dead/reignite`。
- KERNEL-PROBE-P1-08-04-V08 | violation | headed-session 无 claimed owner/无法验证 → `unknown`；过 120 分钟且正面 dead 才可 release claim。
- KERNEL-PROBE-P1-08-04-V09 | violation | execution-attempts=0 且超时必须产生 durable visible incident，不能静默 reset 或依据 relay logs 判 Kernel dead。
- KERNEL-PROBE-P1-08-04-R01 | recovery | 绑定 V07，reignite 只能针对同 run/Attempt generation，且旧 controller 已确证死亡。
- KERNEL-PROBE-P1-08-04-R02 | recovery | 绑定 brain-local 正面 dead，超过 stale window 后只执行 `onStale=fail` 一次。
- KERNEL-PROBE-P1-08-04-R03 | recovery | 绑定 headed-session 正面 dead，release claim 后必须告警并由新 owner generation 认领。
- KERNEL-PROBE-P1-08-04-R04 | recovery | 绑定 V09，zero-attempt 任务恢复派发后保留 incident lineage，不覆盖原始无启动事实。

## KERNEL-INV-P1-08-05

| Field | Normative value |
|---|---|
| classification | `active_required` |
| single owner/seam | `engine.stop.decision_saved_reconciler` |
| legacy truth | Stop hook 扫描 transcript 中的 `decision_saved=<uuid>`，Brain 可达时逐项查询 decision；任一不存在则 block。Brain 不可达时旧实现 fail-open，不能宣称 durable closure。 |
| repo evidence | `packages/engine/hooks/stop.sh:124`; `packages/engine/hooks/stop-conversation.sh` |
| canonical steps | `S12` |
| canonical dimensions | `invariant`, `checkpoint`, `freshness`, `failure_semantics`, `effect_confirmation`, `ledger_freshness` |

Scenario mapping：normal 是无声明或声明全部可对账；violation 是伪造/缺失 decision；recovery
必须绑定 exact missing/unreachable observation，补写同一个 decision 后重新核验。

- KERNEL-PROBE-P1-08-05-N01 | normal | transcript 无 `decision_saved` marker → allow，且不得虚构 decision receipt。
- KERNEL-PROBE-P1-08-05-V01 | violation | Brain healthy 且任一声明 UUID 返回非 200 → block。
- KERNEL-PROBE-P1-08-05-V02 | violation | Brain 不可达时记录 `unverified`；legacy 会 allow，统一 owner 不得把它记为 confirmed。
- KERNEL-PROBE-P1-08-05-R01 | recovery | 绑定 V01，补写 exact UUID 后所有唯一 marker 均返回 200 才 allow。
- KERNEL-PROBE-P1-08-05-R02 | recovery | 绑定 V02，Brain 恢复后重查全部去重 UUID；不得沿用先前 fail-open 结果。

## 3. P1-09 DevGate / TDD / DoD

## KERNEL-INV-P1-09-01

| Field | Normative value |
|---|---|
| classification | `active_required` |
| single owner/seam | `ci.harness_v5_gate` |
| legacy truth | Harness V5 workflow 以一个 required aggregate 消费 changes、DoD purity、Test Contract coverage、Red/Green order、真实 sprint tests、skeleton shape 和 test immutability；不相关 PR 的 child jobs 可 skipped，但 aggregate 仍必须成功。 |
| repo evidence | `.github/workflows/harness-v5-checks.yml`; `packages/engine/tests/skills/harness-v5-ci-checks.test.ts`; DevGate scripts |
| canonical steps | `S2,S3,S5` |
| canonical dimensions | `fr`, `nfr`, `invariant`, `checkpoint`, `failure_semantics`, `adversarial_surface`, `axis_alignment` |

Scenario mapping：normal 覆盖适用和不适用 PR；violation 是任一合同 check 失败；recovery
绑定 exact failed check 与同一 head SHA，修复后重新运行完整 aggregate。

- KERNEL-PROBE-P1-09-01-N01 | normal | contract-related PR 的 changes job 成功并触发全部六个 child checks。
- KERNEL-PROBE-P1-09-01-N02 | normal | 无 contract-related diff 时 child jobs skipped，aggregate 仍输出 success。
- KERNEL-PROBE-P1-09-01-V01 | violation | changes job 非 success → aggregate fail。
- KERNEL-PROBE-P1-09-01-V02 | violation | DoD purity 或 Test Contract coverage failure → aggregate fail。
- KERNEL-PROBE-P1-09-01-V03 | violation | Red/Green order 或真实 sprint test failure → aggregate fail。
- KERNEL-PROBE-P1-09-01-V04 | violation | skeleton shape 或 test immutability failure → aggregate fail。
- KERNEL-PROBE-P1-09-01-R01 | recovery | 绑定 V02，修复合同/测试声明后在同一 head lineage 重跑全部适用 checks。
- KERNEL-PROBE-P1-09-01-R02 | recovery | 绑定 V03/V04，新 commit 使旧 aggregate stale，只有新 head 的 aggregate 可确认。

## KERNEL-INV-P1-09-02

| Field | Normative value |
|---|---|
| classification | `drifted_required_gap` |
| single owner/seam | `ci.ordinary_pr_quality_aggregate` |
| legacy truth | `ci-passed` 聚合 41 个 child jobs，并对 `core-regression` 要求 exact success；其余 helper 只把字面 `failure` 判失败，`cancelled` 等状态可能被误当成功，且 `invariant-bridge` 与 Harness V5 aggregate 未纳入该 owner。 |
| repo evidence | `.github/workflows/ci.yml:1743`; `.github/workflows/scripts/*`; `scripts/devgate/*` |
| canonical steps | `S4,S5` |
| canonical dimensions | `fr`, `nfr`, `invariant`, `checkpoint`, `freshness`, `failure_semantics`, `adversarial_surface`, `axis_alignment` |
| drift expected | 所有 required objective checks 对 exact base/head 产生 fail-closed aggregate；failure/cancelled/timed_out/missing 均拒绝 |
| drift observed | 41 项显式聚合，但 result state 解析和 required-context 完整性仍有旁路 |

Scenario mapping：N01 是全部适用 checks 对 exact head 成功；V01～V41 是每个现有 child
job 的独立 failure；V42/V43 是 aggregate 自身攻击面；R01 必须绑定 exact failed/missing
context 并在新 head 上重跑。

- KERNEL-PROBE-P1-09-02-N01 | normal | 41 个已登记 child jobs 均为 success 或合同允许的 path-skipped，`core-regression=success`，aggregate 绑定当前 base/head。
- KERNEL-PROBE-P1-09-02-V01 | violation | `secrets-scan` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V02 | violation | `dod-format-check` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V03 | violation | `dep-audit` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V04 | violation | `registry-lint` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V05 | violation | `eslint` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V06 | violation | `pr-size-check` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V07 | violation | `branch-naming` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V08 | violation | `engine-tests` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V09 | violation | `engine-tests-shell` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V10 | violation | `dashboard-staging-gate-smoke` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V11 | violation | `lint-migration-unique-version` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V12 | violation | `lint-auto-merge-decision` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V13 | violation | `lint-fs-guard-selection` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V14 | violation | `lint-deploy-effect-assert` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V15 | violation | `brain-unit` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V16 | violation | `brain-unit-all` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V17 | violation | `brain-diff-coverage` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V18 | violation | `brain-integration` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V19 | violation | `workspace-build` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V20 | violation | `workspace-test` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V21 | violation | `e2e-smoke` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V22 | violation | `core-regression` 的 failure、skipped、cancelled 或 missing 均必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V23 | violation | `dod-behavior-dynamic` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V24 | violation | `harness-dod-integrity` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V25 | violation | `harness-contract-lint` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V26 | violation | `docker-infra-smoke` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V27 | violation | `lint-test-pairing` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V28 | violation | `lint-feature-has-smoke` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V29 | violation | `lint-base-fresh` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V30 | violation | `lint-tdd-commit-order` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V31 | violation | `lint-learning-constraint-coverage` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V32 | violation | `lint-test-quality` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V33 | violation | `lint-no-mock-only-test` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V34 | violation | `lint-no-fake-test` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V35 | violation | `lint-single-exit` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V36 | violation | `lint-bypass-not-committed` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V37 | violation | `real-env-smoke` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V38 | violation | `workspace-api-smoke` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V39 | violation | `quality-tests` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V40 | violation | `dispatch-worker-test` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V41 | violation | `brain-version-bump-gate` failure 必须使 aggregate fail。
- KERNEL-PROBE-P1-09-02-V42 | violation | 任一 required child 的 `cancelled`、`timed_out`、`action_required`、unknown 或非许可 skipped 状态必须 fail-closed，不能走 helper 的默认 success 分支。
- KERNEL-PROBE-P1-09-02-V43 | violation | `invariant-bridge`、Harness V5 required context 或其他登记 required context 缺失时必须 fail；“未列入 needs”不得等价于 pass。
- KERNEL-PROBE-P1-09-02-R01 | recovery | 绑定 V01～V43 中的 exact predecessor，在新 head SHA 上重跑缺失/失败 context 与 aggregate；旧 aggregate 自动 stale。

## KERNEL-INV-P1-09-03

| Field | Normative value |
|---|---|
| classification | `active_required` |
| single owner/seam | `git.pre_push.quickcheck` |
| legacy truth | 当前仓库 `core.hooksPath` 指向 common `.git/hooks`，可执行 `pre-push` 调用 `scripts/quickcheck.sh`；这是本地质量 precheck，不是 push/merge authority，且 `--no-verify` 与脚本缺失均可绕过。 |
| repo evidence | runtime `git config --get core.hooksPath`; `.git/hooks/pre-push` audit; `scripts/install-global-hooks.sh`; `packages/engine/hooks/pre-push.sh`; `scripts/quickcheck.sh`; quickcheck tests |
| canonical steps | `S4,S5` |
| canonical dimensions | `fr`, `invariant`, `checkpoint`, `failure_semantics`, `effect_confirmation`, `adversarial_surface` |

Scenario mapping：normal 是 quickcheck 成功；violation 记录本地阻断或 legacy bypass；recovery
绑定 exact quickcheck failure，修复后重新执行同一 hook，不把 bypass 当恢复。

- KERNEL-PROBE-P1-09-03-N01 | normal | quickcheck exit 0 → pre-push exit 0。
- KERNEL-PROBE-P1-09-03-N02 | normal | linked worktree 解析到 common hooksPath，并调用同一 quickcheck owner。
- KERNEL-PROBE-P1-09-03-V01 | violation | quickcheck 非零 → pre-push 非零并阻断本次 push。
- KERNEL-PROBE-P1-09-03-V02 | violation | quickcheck 缺失或 `git push --no-verify` → legacy allow，但必须记录 bypass，不能生成 quality receipt。
- KERNEL-PROBE-P1-09-03-R01 | recovery | 绑定 V01，修复后重新跑完整 quickcheck；新成功不得追认先前被拒绝的 push invocation。

## KERNEL-INV-P1-09-04

| Field | Normative value |
|---|---|
| classification | `active_required` |
| single owner/seam | `engine.devgate.behavior_test_executor` |
| legacy truth | `light-evaluator.cjs` 被调用时扫描 DoD，执行可解析的 `[BEHAVIOR] Test: manual:bash -c`，记录 command、exit code、tail 和时间；无条目、目录缺失、扫描错误或 dry-run 会 skipped。不能超声明为默认 push admission。 |
| repo evidence | `packages/engine/scripts/devgate/light-evaluator.cjs`; `packages/engine/skills/dev/steps/light-evaluator.md`; regression tests |
| canonical steps | `S4,S6` |
| canonical dimensions | `fr`, `invariant`, `checkpoint`, `failure_semantics`, `effect_confirmation`, `adversarial_surface`, `axis_alignment` |

Scenario mapping：normal 是真实命令全部成功；violation 是任一真实命令失败或输入无法形成可信
执行；recovery 绑定 exact failed entry，并在同一 artifact lineage 重跑。

- KERNEL-PROBE-P1-09-04-N01 | normal | 所有可解析 BEHAVIOR commands exit 0 → `overall=PASS`。
- KERNEL-PROBE-P1-09-04-V01 | violation | 任一 command 非零/timeout → `overall=FAIL` 且 evaluator exit 1。
- KERNEL-PROBE-P1-09-04-V02 | violation | 无 BEHAVIOR、目录缺失或 scan/read error → skipped record，不能解释为 tests passed。
- KERNEL-PROBE-P1-09-04-V03 | violation | `--dry-run-no-behavior` 在存在 BEHAVIOR 时只能产 bypass observation，不能产 pass receipt。
- KERNEL-PROBE-P1-09-04-R01 | recovery | 绑定 V01，修复命令后逐条重跑全部 entries，不只重跑失败项。
- KERNEL-PROBE-P1-09-04-R02 | recovery | 绑定 V02/V03，恢复可读合同并关闭 bypass 后才能生成新的真实执行记录。

## KERNEL-INV-P1-09-05

| Field | Normative value |
|---|---|
| classification | `drifted_required_gap` |
| single owner/seam | `kernel.devgate.admission` |
| legacy truth | DevGate 能力分散在 repo scripts、CI、手工 `/dev`、Claude hooks 与本地 git hook；Kernel/Runner 尚未以一个 exact-artifact、Provider-neutral receipt 默认调用并消费它们。旧 Stop hook 不再拥有质量裁决权。 |
| repo evidence | `.claude/settings.json`; Engine skill discovery; `ci.yml`; `harness-v5-checks.yml`; pre-push audit |
| canonical steps | `S1,S2,S3,S4,S5,S6` |
| canonical dimensions | `fr`, `nfr`, `invariant`, `checkpoint`, `freshness`, `failure_semantics`, `adversarial_surface`, `axis_alignment` |
| drift expected | 每个 Provider/机器在 evaluator admission 前消费 repo-discoverable、exact-SHA、不可 bypass 的 DevGate receipt |
| drift observed | 用户 settings、手工 skill 和本地 hook 仍决定部分覆盖面 |

Scenario mapping：normal 分别覆盖三 Provider；violation 是缺接线、stale receipt 或 bypass；
recovery 绑定 exact missing/stale predecessor，在同一 Provider 和 artifact 上补跑。

- KERNEL-PROBE-P1-09-05-N01 | normal | Claude Runner 从 repo manifest 调用 DevGate，并提交 exact artifact receipt。
- KERNEL-PROBE-P1-09-05-N02 | normal | Codex Runner 从同一 manifest 调用相同 DevGate contract。
- KERNEL-PROBE-P1-09-05-N03 | normal | Grok Runner 从同一 manifest 调用相同 DevGate contract。
- KERNEL-PROBE-P1-09-05-V01 | violation | 用户 global skill/settings 缺失时不得静默跳过 DevGate。
- KERNEL-PROBE-P1-09-05-V02 | violation | receipt artifact/base/head 不匹配或过期必须拒绝。
- KERNEL-PROBE-P1-09-05-V03 | violation | `--no-verify`、dry-run、静态 grep、`test -f` 或 LLM 自报不得生成 admission。
- KERNEL-PROBE-P1-09-05-R01 | recovery | 绑定 V01～V03，由 repo-owned Runner 真跑并签发新 receipt 后才恢复 evaluator admission。

## 4. P1-10 — Attempt、Fleet Result 与 Portable Binding

## KERNEL-INV-P1-10-01

| Field | Normative value |
|---|---|
| classification | `active_required` |
| single owner/seam | `kernel.controller.attempt_lease_store` |
| legacy truth | 基线 DB 对同一 `run_id/hop_id` 保持唯一 attempt，queued attempt 可原子 claim；已审 Kernel Runner snapshot 的过期 reclaim 会更换 owner 并递增父级 `kernel_attempt_lease_generation`。现状仍不能超声明为“所有 attempt transition 均 generation-fenced”，也尚未完整建模子级 Harness Controller generation。 |
| repo evidence | baseline `packages/brain/migrations/357_harness_provider_attempts.sql`; reviewed snapshot `dec293589` 的 `packages/brain/migrations/363_kernel_fleet_execution_receipts.sql`, `packages/brain/src/orchestrator/attempt-store.js` 与 attempt-store tests |
| canonical steps | `S0,S2,S3,S4,S5,S6,S7,S12` |
| canonical dimensions | `fr`, `nfr`, `invariant`, `checkpoint`, `freshness`, `death_alert`, `failure_semantics`, `effect_confirmation`, `ledger_freshness`, `axis_alignment` |

Scenario mapping：normal 是唯一 attempt 与合法 claim；violation 是错误 owner、未过期抢占或复用
错误 session；recovery 必须以 exact expired lease 为前驱，递增 generation 并使旧 owner 永久失权。

- KERNEL-PROBE-P1-10-01-N01 | normal | 两个并发创建者对同一 `run_id/hop_id` 只能得到一个 durable attempt identity。
- KERNEL-PROBE-P1-10-01-N02 | normal | queued attempt 的合法 Global claimant 原子写入 owner、lease expiry 与当前 `kernel_attempt_lease_generation`。
- KERNEL-PROBE-P1-10-01-V01 | violation | attempt 复用的 provider session 不属于同一 attempt/provider/role 时必须拒绝。
- KERNEL-PROBE-P1-10-01-V02 | violation | 非当前 Global owner 或错误 `kernel_attempt_lease_generation` 请求全局 transition 必须 fail-closed；子 generation 不能替代父 fence。
- KERNEL-PROBE-P1-10-01-V03 | violation | lease 未过期时其他 worker reclaim 必须拒绝，不能只凭 heartbeat 新旧判断。
- KERNEL-PROBE-P1-10-01-R01 | recovery | 绑定 V03 的 exact expired parent lease；Global reclaim 更换 owner、递增 `kernel_attempt_lease_generation`，并保留 predecessor lineage。
- KERNEL-PROBE-P1-10-01-R02 | recovery | 绑定 V02 与 R01；Global reclaim 后旧 parent owner/generation 下所有 Harness Controller generation 的 heartbeat、callback 与 terminal transition 全部失权。

## KERNEL-INV-P1-10-02

| Field | Normative value |
|---|---|
| classification | `active_required` |
| single owner/seam | `kernel.controller.fleet_result_settlement` |
| legacy truth | 已审 Kernel Runner snapshot 的 Fleet result callback 校验 delivery、attempt、lease、provider、session、skill bundle 与 authority binding；成功后追加 result receipt，并对 exact replay 去重。receipt 是 append-only settlement 证据，不允许冲突 replay 覆盖。 |
| repo evidence | reviewed snapshot `dec293589` 的 `packages/brain/src/routes/harness-callback.js`, `packages/brain/src/orchestrator/attempt-store.js`, `packages/brain/migrations/370_kernel_result_channel_receipts.sql`, `packages/brain/migrations/371_kernel_heartbeat_receipts.sql` 与 callback/receipt tests |
| canonical steps | `S2,S3,S4,S5,S6,S7,S12` |
| canonical dimensions | `fr`, `nfr`, `invariant`, `checkpoint`, `freshness`, `death_alert`, `failure_semantics`, `effect_confirmation`, `ledger_freshness`, `adversarial_surface`, `axis_alignment` |

Scenario mapping：normal 是全部 binding 一致后的 append-only settlement；violation 覆盖协议、身份、
lease、artifact、authority 与 replay 冲突；recovery 只接受 exact replay，或绑定到明确 predecessor 的新 generation。

- KERNEL-PROBE-P1-10-02-N01 | normal | 合法 Fleet callback 的全部 binding、authority 与 payload 校验通过后，原子持久化 receipt 并 ack。
- KERNEL-PROBE-P1-10-02-V01 | violation | HMAC、callback protocol version、timestamp window 或 canonical signature 任一错误必须拒绝。
- KERNEL-PROBE-P1-10-02-V02 | violation | TaskBundle 与 result channel 的 task、kernel run、attempt、harness、harness run 或 role 任一不一致必须拒绝。
- KERNEL-PROBE-P1-10-02-V03 | violation | result body、stdout/stderr 或结构化 payload 超过登记上限必须拒绝，不能截断后确认。
- KERNEL-PROBE-P1-10-02-V04 | violation | launch 未获 durable confirmation、delivery 尚未 dispatched 或 transport identity 不一致必须拒绝。
- KERNEL-PROBE-P1-10-02-V05 | violation | worker/job identity 与 delivery binding 不一致必须拒绝。
- KERNEL-PROBE-P1-10-02-V06 | violation | Global lease owner/`kernel_attempt_lease_generation` 或 Harness owner/`harness_controller_lease_generation` 任一与当前父子 lease 不一致必须拒绝；一层新鲜不能掩盖另一层 stale。
- KERNEL-PROBE-P1-10-02-V07 | violation | attempt identity 不存在、已被不可重入地 terminal settlement，或状态不允许 callback 时必须拒绝。
- KERNEL-PROBE-P1-10-02-V08 | violation | callback provider 与 attempt/delivery 登记 provider 不一致必须拒绝。
- KERNEL-PROBE-P1-10-02-V09 | violation | provider session 缺失、错误或被另一个 active attempt 复用必须拒绝。
- KERNEL-PROBE-P1-10-02-V10 | violation | skill name/version/digest 或 bundle hash 与 launch manifest 任一不一致必须拒绝。
- KERNEL-PROBE-P1-10-02-V11 | violation | machine attestation 缺失、过期或 machine identity 不匹配必须拒绝。
- KERNEL-PROBE-P1-10-02-V12 | violation | delivery ID、nonce、payload hash 或 byte count 任一与 dispatch record 不一致必须拒绝。
- KERNEL-PROBE-P1-10-02-V13 | violation | result authority hash、authority role 或 output schema 与任务合同不一致必须拒绝。
- KERNEL-PROBE-P1-10-02-V14 | violation | 已 terminal attempt 收到不同 receipt identity 或不同 result hash 时必须拒绝为冲突。
- KERNEL-PROBE-P1-10-02-V15 | violation | 对已确认 receipt 的 update/delete，或相同 idempotency key 携带不同 bytes，必须拒绝并告警。
- KERNEL-PROBE-P1-10-02-R01 | recovery | 绑定 V14/V15 的 replay conflict；仅 exact delivery、nonce、generation、authority 与 payload hash 的重放返回同一 receipt identity，不产生第二个 effect。
- KERNEL-PROBE-P1-10-02-R02 | recovery | 绑定 stale-generation denial；只有父级 Global reclaim 与目标 Harness 的新 `harness_run_id`/子 generation 都绑定 exact predecessor lineage 时，callback 才可 settlement。

## KERNEL-INV-P1-10-03

| Field | Normative value |
|---|---|
| classification | `active_required` |
| single owner/seam | `engine.workspace.main_checkout_branch_guard` |
| legacy truth | checkout guard 阻止 main checkout 切换到 `cp/*` 或 feature branch，并允许 main→main、linked worktree task branch 与 file checkout。它是 branch-safety guard，不等于 attempt/workspace lease binding。 |
| repo evidence | `packages/engine/hooks/worktree-checkout-guard.sh`; `.claude/settings.json`; `packages/engine/tests/integration/worktree-checkout-guard.test.sh` |
| canonical steps | `S4` |
| canonical dimensions | `invariant`, `checkpoint`, `failure_semantics`, `effect_confirmation`, `adversarial_surface` |

Scenario mapping：normal 是允许的 branch/file 操作；violation 是在 main checkout 进入任务分支；
recovery 绑定被拒绝的命令并改用 linked worktree，不能弱化 guard。

- KERNEL-PROBE-P1-10-03-N01 | normal | main checkout 保持或切回 `main` 被允许。
- KERNEL-PROBE-P1-10-03-N02 | normal | linked worktree 内进入其已绑定 task branch 被允许。
- KERNEL-PROBE-P1-10-03-V01 | violation | main checkout 执行 `git checkout cp/*` 必须在变更 branch 前阻断。
- KERNEL-PROBE-P1-10-03-V02 | violation | main checkout 通过 `git switch` 进入 feature/task branch 必须同样阻断。
- KERNEL-PROBE-P1-10-03-R01 | recovery | 绑定 V01/V02，创建或选取 linked worktree 后在该 worktree 执行 branch switch。
- KERNEL-PROBE-P1-10-03-R02 | recovery | 绑定 V01/V02；file checkout 或其他非 branch-switch 操作可继续，但不得通过命令形态变化绕过 branch guard。

## KERNEL-INV-P1-10-04

| Field | Normative value |
|---|---|
| classification | `drifted_required_gap` |
| single owner/seam | `kernel.controller.portable_attempt_binding` |
| legacy truth | 各 transport 的 binding 强度不一致：Fleet result 路径较完整，但 classic non-Fleet heartbeat/failure callback 未统一要求 generation；checkout guard 也未绑定 Attempt。尚无 Provider-neutral 的 task/kernel-run/attempt/kernel-generation/harness/harness-run/harness-generation/provider/role/session/machine/workspace/branch 单一合同。 |
| repo evidence | Fleet/classic callback route comparison; dispatcher paths; attempt-store; workspace guard; `.claude/settings.json` audit |
| canonical steps | `S0,S2,S3,S4,S5,S6,S7,S12` |
| canonical dimensions | `fr`, `nfr`, `invariant`, `checkpoint`, `freshness`, `death_alert`, `failure_semantics`, `effect_confirmation`, `ledger_freshness`, `adversarial_surface`, `axis_alignment` |
| drift expected | 每条 transport 在 side effect 前消费同一个 complete 父子 Controller binding，并按父 fence 后子 fence 的顺序验证 |
| drift observed | classic callback 缺 generation fence；workspace/branch 仅由局部 guard 约束 |

Scenario mapping：normal 必须跨 transport 验证完整 binding；violation 覆盖 classic generation 缺口
及任一身份/环境错配；recovery 重新签发与 exact reclaim predecessor 相连的新 binding。

- KERNEL-PROBE-P1-10-04-N01 | normal | 任一 Provider/transport 只有在 task/kernel-run/attempt/父 generation 与 harness/harness-run/子 generation 全部一致时才可 heartbeat、回调或产生 side effect。
- KERNEL-PROBE-P1-10-04-V01 | violation | classic non-Fleet heartbeat 缺任一层 generation、携带 stale 父/子 generation，或用新子 generation 搭配旧父 generation 时必须拒绝。
- KERNEL-PROBE-P1-10-04-V02 | violation | classic failure callback 缺任一层 generation、携带 stale 父/子 generation，或用新父 generation 搭配旧 Harness result 时必须拒绝。
- KERNEL-PROBE-P1-10-04-V03 | violation | task、kernel run、hop、attempt、harness 或 harness run identity 任一不一致必须拒绝，覆盖 wrong-Harness 与 cross-level replay。
- KERNEL-PROBE-P1-10-04-V04 | violation | provider、role 或 provider session 任一不一致必须拒绝。
- KERNEL-PROBE-P1-10-04-V05 | violation | machine identity/attestation 与 claim binding 不一致必须拒绝。
- KERNEL-PROBE-P1-10-04-V06 | violation | workspace/branch 与 claim binding 不一致，或仅依赖用户 settings 的局部 guard，均不得取得 authority。
- KERNEL-PROBE-P1-10-04-R01 | recovery | 绑定 V03～V06，为 exact parent Attempt 与 admitted harness run 写入并确认 workspace、branch、machine lease 后再执行。
- KERNEL-PROBE-P1-10-04-R02 | recovery | 绑定 V01/V02：父 reclaim 递增 `kernel_attempt_lease_generation` 并使全部旧子 lease 失效；Harness 局部 retry 只递增 `harness_controller_lease_generation`。新 claim/secret 必须绑定两者，旧 secret 与任一 stale generation 同时失效。

## 5. P1-11 — Report、派生与 Closure

## KERNEL-INV-P1-11-01

| Field | Normative value |
|---|---|
| classification | `active_required` |
| single owner/seam | `kernel.report.finalizer` |
| legacy truth | 已审 Phase 5B snapshot 的 Kernel report handler 先要求 `production_verified` ReleaseRun receipt，再依次执行 regression promotion、handoff、OKR 更新和 cleanup，最后在 transaction 中令 run/task done。它不包含 durable learning closure。 |
| repo evidence | reviewed snapshot `f16f2a76` 的 `packages/brain/src/orchestrator/kernel-handlers.js`、report finalizer tests、regression promotion、handoff 与 OKR modules |
| canonical steps | `S9,S10,S11,S12` |
| canonical dimensions | `fr`, `nfr`, `invariant`, `checkpoint`, `freshness`, `failure_semantics`, `effect_confirmation`, `ledger_freshness`, `axis_alignment` |

Scenario mapping：normal 是同一 effect 的有序 closure chain；violation 是 authority、任一子 effect
或最终 transaction 失败；recovery 绑定 exact failure，补齐后重验整条 chain。

- KERNEL-PROBE-P1-11-01-N01 | normal | 同一 artifact/effect 的 verified release、regression、handoff、OKR、cleanup 全部成功后，单 transaction 标记 run/task done。
- KERNEL-PROBE-P1-11-01-V01 | violation | 缺少 ReleaseRun authority receipt 时不得开始 finalization。
- KERNEL-PROBE-P1-11-01-V02 | violation | release receipt 为 blocked、非 terminal、malformed、stale 或 artifact/effect 不匹配时必须拒绝。
- KERNEL-PROBE-P1-11-01-V03 | violation | regression promotion 失败或未确认时不得继续到 done。
- KERNEL-PROBE-P1-11-01-V04 | violation | handoff 失败或未确认时不得继续到 done。
- KERNEL-PROBE-P1-11-01-V05 | violation | OKR update 或 cleanup 任一失败/未确认时不得继续到 done。
- KERNEL-PROBE-P1-11-01-V06 | violation | 最终 run/task transaction 任一 update 失败必须整体 rollback。
- KERNEL-PROBE-P1-11-01-R01 | recovery | 绑定 V01/V02，取得 exact artifact/effect 的新 verified receipt 后从 authority check 重新进入。
- KERNEL-PROBE-P1-11-01-R02 | recovery | 绑定 V03～V05，修复 failed sub-effect 后重新确认全链，不能因先前 partial success 直接标 done。
- KERNEL-PROBE-P1-11-01-R03 | recovery | 绑定 V06，确认 rollback 未留下 partial terminal state 后重试同一 finalization transaction。

## KERNEL-INV-P1-11-02

| Field | Normative value |
|---|---|
| classification | `drifted_required_gap` |
| single owner/seam | `kernel.report.derivation_store` |
| legacy truth | staging `spawnHarnessReport` 以 initiative 的 `WHERE NOT EXISTS` 尝试派生 report，无数据库唯一约束，并将异常捕获为 best-effort；因此既非并发 exactly-once，也没有按 artifact/effect generation 建模。 |
| repo evidence | `packages/brain/src/staging-promote.js`; staging/report tests; task/report migrations |
| canonical steps | `S10,S11,S12` |
| canonical dimensions | `fr`, `invariant`, `checkpoint`, `freshness`, `failure_semantics`, `effect_confirmation`, `ledger_freshness` |
| drift expected | 以 durable effect key 唯一派生、失败可见、exact replay 去重 |
| drift observed | application-level `NOT EXISTS` 竞态、initiative 粒度过粗、异常被吞 |

Scenario mapping：normal 是首个派生；violation 是并发重复、跨 effect 错误折叠或 best-effort
吞错；recovery 以 durable effect key 重试并确认唯一结果。

- KERNEL-PROBE-P1-11-02-N01 | normal | 首个 eligible artifact/effect 创建一个 report derivation，并记录 source effect key。
- KERNEL-PROBE-P1-11-02-V01 | violation | 两个并发派生请求不得为同一 effect 创建两个 report tasks。
- KERNEL-PROBE-P1-11-02-V02 | violation | 同一 initiative 的新 effect generation 不得被旧 report 的 `NOT EXISTS` 结果错误折叠或读取 stale。
- KERNEL-PROBE-P1-11-02-V03 | violation | DB/transaction error 不得被 best-effort catch 解释为 derivation success。
- KERNEL-PROBE-P1-11-02-R01 | recovery | 绑定 V01/V02，使用数据库唯一 effect key 重试；exact replay 返回同一 derivation identity。
- KERNEL-PROBE-P1-11-02-R02 | recovery | 绑定 V03，保留 visible failed state，修复后重试并取得 durable confirmation。

## KERNEL-INV-P1-11-03

| Field | Normative value |
|---|---|
| classification | `active_required` |
| single owner/seam | `brain.learning.policy` |
| legacy truth | 有价值的 failed dev/feature/research task 可创建 learning；completed、noise、非价值、duplicate 或预算门会返回 null/N/A。现有 N/A 多为返回值而非 durable closure outcome，DB 错误也可能落入 null。 |
| repo evidence | `packages/brain/src/auto-learning.js`; auto-learning tests; migrations `063_auto_learning.sql`, `271_learning_budget.sql` |
| canonical steps | `S6,S7,S12` |
| canonical dimensions | `fr`, `nfr`, `invariant`, `checkpoint`, `failure_semantics`, `effect_confirmation`, `axis_alignment` |

Scenario mapping：normal 区分 learning_recorded 与 policy N/A；violation 区分合法 N/A、duplicate
和不可确认错误；recovery 允许修正后的 valuable failure 创建记录，并要求 closure owner 持久化 N/A。

- KERNEL-PROBE-P1-11-03-N01 | normal | 有价值 failed dev/feature/research task 通过 policy 后创建一条绑定 source task/effect 的 learning。
- KERNEL-PROBE-P1-11-03-N02 | normal | completed task 按 policy 返回 not-applicable，而不是伪造 learning。
- KERNEL-PROBE-P1-11-03-V01 | violation | noise 或非价值 failure 返回 not-applicable，不能写入低质量 learning 充数。
- KERNEL-PROBE-P1-11-03-V02 | violation | duplicate learning 返回 not-applicable/duplicate reason，不能重复插入。
- KERNEL-PROBE-P1-11-03-V03 | violation | budget 拒绝或 DB error 的 legacy null 不能被 closure 当成已确认 learning outcome。
- KERNEL-PROBE-P1-11-03-R01 | recovery | 绑定 V01；先前非价值/N/A 的 task 在新增有效 evidence 后重新评估，可为新 effect 创建 learning。
- KERNEL-PROBE-P1-11-03-R02 | recovery | 绑定 V03；closure owner 将 policy N/A 持久化为带 reason、evidence 与 source effect 的 `learning_not_applicable`。

## KERNEL-INV-P1-11-04

| Field | Normative value |
|---|---|
| classification | `drifted_required_gap` |
| single owner/seam | `kernel.closure.acceptance` |
| legacy truth | 现有 report finalizer 没有 durable learning closure；equivalence/演练路径若强制每次产生 learning，又与正常 completed/noise 可 N/A 的 policy 冲突。当前也没有一个 owner 验证 release、report、regression、handoff/map 和 learning outcome 全属于同一 artifact/effect。 |
| repo evidence | `packages/brain/src/orchestrator/kernel-handlers.js`; `packages/brain/src/auto-learning.js`; `packages/brain/src/staging-promote.js`; closure/equivalence drill code |
| canonical steps | `S1,S6,S7,S8,S9,S10,S11,S12` |
| canonical dimensions | `fr`, `nfr`, `invariant`, `checkpoint`, `freshness`, `failure_semantics`, `effect_confirmation`, `ledger_freshness`, `axis_alignment` |
| drift expected | done 只在同一 artifact/effect 的全部 closure evidence 与 durable learning outcome 完整时成立 |
| drift observed | report finalizer 缺 learning outcome；report derivation best-effort；N/A 未 durable 化 |

Scenario mapping：normal 是同一 effect 的完整 closure；violation 覆盖缺失、stale、无理由 N/A
与 lineage mismatch；recovery 只接受 recorded 或有理由/证据的 not-applicable，并重验全部 closure。

- KERNEL-PROBE-P1-11-04-N01 | normal | 同一 artifact/effect 的 release、report、regression、handoff/map、OKR 与 durable learning outcome 全部确认后接受 closure。
- KERNEL-PROBE-P1-11-04-V01 | violation | report derivation/receipt 缺失、失败或 stale 时不得 done。
- KERNEL-PROBE-P1-11-04-V02 | violation | regression receipt 缺失、失败或不属于同一 effect 时不得 done。
- KERNEL-PROBE-P1-11-04-V03 | violation | handoff、map/OKR 或 cleanup evidence 任一缺失/失败时不得 done。
- KERNEL-PROBE-P1-11-04-V04 | violation | learning outcome 缺失或只是不可区分原因的 bare null 时不得 done。
- KERNEL-PROBE-P1-11-04-V05 | violation | `learning_not_applicable` 缺 reason、policy evidence 或 source effect binding 时不得 done。
- KERNEL-PROBE-P1-11-04-V06 | violation | 任一 receipt 的 SHA/effect generation 不匹配，或 best-effort sub-effect 失败被吞，必须拒绝 closure。
- KERNEL-PROBE-P1-11-04-R01 | recovery | 绑定 V04，补写同一 source effect 的 `learning_recorded` 后重验完整 closure。
- KERNEL-PROBE-P1-11-04-R02 | recovery | 绑定 V04/V05，补写有 reason、policy evidence 的 `learning_not_applicable` 后重验完整 closure。
- KERNEL-PROBE-P1-11-04-R03 | recovery | 绑定 V01～V06，刷新 exact failed/stale predecessor 后，重新核对所有 receipt 的同一-effect lineage 才可接受。

## 6. 全局修正与计数不变量

`KERNEL-INV-P0-03-02-LOCAL-PUSH-PRECHECK-ADMISSION` 与
`KERNEL-INV-P1-09-03` 同时保留，但 authority 不同：前者定义不能被 `--no-verify`、命令
变体或缺失脚本绕过的 Kernel push admission；后者只表达当前 common pre-push hook 执行
quickcheck 的 active quality behavior，不拥有 push/merge authority。validator 必须拒绝
用 P1-09-03 的 hook receipt 代替 P0-03-02 的 admission receipt。

新增 `KERNEL-INV-P1-08-05` 表达 previously omitted 的 `decision_saved` reconciliation seam。
本附录只是 43-atom 全局基线中的 P1 分片；全局计数以主设计和三份规范性附录的联合
inventory 为准：

```text
15 P0 pre-merge atoms + 10 P0 evaluation/release atoms + 18 P1 atoms = 43
```

本附录的机器可检验不变量：

- 18 个唯一 `KERNEL-INV-P1-*`；
- 188 个唯一 `KERNEL-PROBE-P1-*`；
- 每个非 retired atom 至少一个 `normal`、一个 `violation`、一个 `recovery`；
- retired atom `KERNEL-INV-P1-08-01` 只有四个 `absence` probes；
- 单 atom 只有一个 owner/seam；receipt policy 只对该 atom 生效；
- recovery probe 必须在定义中绑定 predecessor 或明确绑定的 violation 集合。
