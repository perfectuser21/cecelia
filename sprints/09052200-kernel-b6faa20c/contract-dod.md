---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: check-handoffs.mjs 契约 schema 化（CHECKS→CONTRACTS 九格+八格）

**范围**: 新建 `packages/brain/src/orchestrator/check-handoffs.mjs`（纯 Node ESM 模块 + CLI）：CHECKS 扩为 CONTRACTS（coding 九格 + leadgen 八格），每格 precondition/postcondition/side_effects 三段、六类可参数化断言，输出确定性 PASS/FAIL/UNDECIDABLE + 退出码。复用 home-sequencer STAGE_ORDER 与 handoff-schemas shape 层。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] check-handoffs.mjs 落位且导出六个契约符号
  Test: manual:bash -c 'F=packages/brain/src/orchestrator/check-handoffs.mjs; grep -q CONTRACTS $F && grep -q CODING_CELLS $F && grep -q LEADGEN_CELLS $F && grep -q ASSERTION_CATEGORIES $F && grep -q evaluateAssertion $F && grep -q runCellContracts $F'
  期望: exit 0

- [ ] [ARTIFACT] 复用真实 handoff-schemas（禁 mock 边：import 真实 validateHandoffObject，不另写形状校验）
  Test: manual:bash -c 'F=packages/brain/src/orchestrator/check-handoffs.mjs; grep -q handoff-schemas $F && grep -q validateHandoffObject $F && grep -q home-sequencer $F && grep -q STAGE_ORDER $F'
  期望: exit 0

## BEHAVIOR 条目（五行剧本 — 内嵌可执行 manual: 命令，CLI + 冻结 fixture，断言对象为校验器真实输出）

- [ ] [BEHAVIOR] [L2] B-01: CONTRACTS 覆盖 coding 九格 + leadgen 八格共 17 格
  动作: 跑 `check-handoffs.mjs --cells` 子命令
  预期观察: stdout 出现 `CELLS coding=9 leadgen=8 total=17`
  等待预算: 0s
  留证: CLI stdout（CELLS 行）
  Test: manual:bash -c 'node packages/brain/src/orchestrator/check-handoffs.mjs --cells | grep -q "coding=9 leadgen=8 total=17"'

- [ ] [BEHAVIOR] [L2] B-02: 缺 source_attempt_id 交接对象 → artifact_compliance FAIL 并点名字段
  动作: 对 generate 格跑缺 source_attempt_id 的候选交接对象 fixture
  预期观察: 结果 JSON 出现 FAIL 且 reason 含 `source_attempt_id`（点名到缺失字段，非笼统失败）
  等待预算: 0s
  留证: CLI stdout（含 source_attempt_id 的 FAIL 判定）
  Test: manual:bash -c 'node packages/brain/src/orchestrator/check-handoffs.mjs generate sprints/09052200-kernel-b6faa20c/tests/fixtures/candidate-missing-source.json | grep -q source_attempt_id'

- [ ] [BEHAVIOR] [L2] B-03: record_persisted 无 db resolver → UNDECIDABLE 不判 PASS（INV-1 fail-closed，忽略 handoff 自报 db_count）
  动作: 对 generate 格跑合规但自报 `db_count:999`/`persisted:true` 的 fixture，且不提供 context
  预期观察: 结果 JSON 出现 `UNDECIDABLE`（record_persisted 走权威 resolver 而非 handoff 自报值），且 `SUMMARY ... ok=false`
  等待预算: 0s
  留证: CLI stdout（UNDECIDABLE + ok=false）
  Test: manual:bash -c 'node packages/brain/src/orchestrator/check-handoffs.mjs generate sprints/09052200-kernel-b6faa20c/tests/fixtures/candidate-forged-dbcount.json | grep -q UNDECIDABLE'

- [ ] [BEHAVIOR] [L2] B-04: 未知格标识 → 显式报 unknown_cell，绝不静默 PASS
  动作: 用未定义 CONTRACTS 的格标识 `bogus_cell` 跑合规 fixture
  预期观察: stdout 出现 `unknown_cell`（显式报错），绝不出现 `ok=true`
  等待预算: 0s
  留证: CLI stdout（unknown_cell）
  Test: manual:bash -c 'node packages/brain/src/orchestrator/check-handoffs.mjs bogus_cell sprints/09052200-kernel-b6faa20c/tests/fixtures/candidate-compliant.json | grep -q unknown_cell'

- [ ] [BEHAVIOR] [L2] B-05: 纯类目断言（state_transition + numeric_threshold）合规输入全 PASS → ok=true exit 0
  动作: 对 evaluate 格跑合规 fixture（prev/next 合法迁移 + score 达标）
  预期观察: stdout 出现 `SUMMARY cell=evaluate ok=true`（state_transition 合法迁移 + numeric_threshold 达标均 PASS）
  等待预算: 0s
  留证: CLI stdout（SUMMARY ok=true）
  Test: manual:bash -c 'node packages/brain/src/orchestrator/check-handoffs.mjs evaluate sprints/09052200-kernel-b6faa20c/tests/fixtures/evaluate-compliant.json | grep -q "cell=evaluate ok=true"'

## Invariant 覆盖（历史约束三源 — 铁律逐条映射）

- INV-1 机械判定不信 handoff 抄写值（断言值以服务端权威源为准）——由 B-03（自报 db_count 被忽略、无 resolver→UNDECIDABLE 不放行）覆盖；negative_boundary 真拦编造值由冻结测试 `越界输入被真拦判 PASS 漏网判 FAIL` + E2E Part A 覆盖。
- INV-2 DIRTY→generator-fix 路由 — N/A：本 sprint 不触及 dispatcher/PR 冲突路由。
- INV-3 judge 证据窗口 8×600 — N/A：本 sprint 不产 .brain-result、不改 judge 消费。
- INV-4 校验临时脚本会话独享路径 — 本合同 E2E 用 `mktemp -d`，无固定 /tmp 文件名（见 contract-draft ## E2E 验收）。

## 未覆盖真实链路清单（引自 contract-draft）

- record_persisted / externally_visible 生产 resolver（真 pg / 真 gh）接线为后续接入件；本 sprint 交付引擎+接口+UNDECIDABLE 兜底，E2E 用真 psql（$DB_URL）+时间窗与真文件产物证明引擎在真实权威值上判定正确（六类全 PASS）。
- leadgen 八格业务语义待主理人确认（judgment-pending-user）；机械验收只锁「恰 8 格 + 与 coding 无交集 + 三段结构」。
