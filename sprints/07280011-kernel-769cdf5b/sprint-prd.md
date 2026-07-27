# Sprint PRD — Kernel Test Environment Controller Recovery 2

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：把 Harness 数据库能力从“假红/假验”拉回真实 attempt 级隔离验证，为 Feedback R5、Preview R6、Capacity、Knife1 解阻

## 背景

本次 Recovery 2 继续修复 Kernel Test Environment Controller。任务真相要求保留此前被否决的 proposer/reviewer 产物仅作证据，不继承任何批准，并以 `origin/main` 在 `d37a5e57827900be2651fe39655690238513128f` 或更新提交为基线重新锚定。核心产品行为必须严格围绕 `可信 local/fleet runner 统一发放 attempt-scoped short-lived TEST_DATABASE_URL capability，并真实证明 bootstrap、隔离、receipt 与 terminal cleanup。` 展开，且不得产生任何 production database mutation。

最近同类 Journey 连续多轮失败，失败原因集中在 fake red、静态扫描冒充真实 PG 验证、错误执行路径、缺失真实 runner/receipt/cleanup 证明。本 sprint 只重新锚定真实 Golden Path 与可执行验收，不批准任何“读文件即算通过”的 theater。

## Golden Path（核心场景）

用户/系统从 Harness server-owned TaskBundle 声明某命令需要 DB-backed contract 入口进入，经过 controller 为本次 attempt 发放短期数据库能力并驱动真实 local/fleet runner 执行，再到达 receipt 落账与 terminal cleanup 出口。

具体：
1. 当 planner、proposer、reviewer、generator 或 evaluator 的 server-owned TaskBundle 声明 DB-backed contract 时，controller 仅为该次 attempt provision 或 lease 一份 attempt-scoped PostgreSQL test database 与 short-lived role，并只向被声明命令注入 `TEST_DATABASE_URL` 与无凭据 receipt 引用。
2. 被注入命令在真实本地 dispatcher→production-transport 路径与真实 remote-bridge→fleet-worker.cjs→attempt-runner.cjs 路径中，先执行 bootstrap/migration/seed 到准确的 `TEST_DATABASE_URL`，再用真实 pre-import oracle 证明 current_database、current_user、inet_server_addr、allowed_cidrs、nonce、receipt、零生产库权限都与本次 attempt 对齐。
3. judge 与无关角色拿不到 `TEST_DATABASE_URL` 或 receipt；success、failure、cancel、kill -9、runner crash、worker restart、recovery 后，controller 在有界时间内 revoke role、drop database 或回收 lease，并持久化一份不含 URL/password/token 的 attested receipt，且 stale/tampered/cross-attempt receipt 会被独立拒绝。

## 边界情况

- bootstrap Red 仅允许使用任务里明确标注的一次性 fixture `cecelia-harness-test-pg-bootstrap`，且只用于 initial Red/reviewer 证明当前实现缺口，不得变成默认实现或 fallback
- local attempt 与 fleet attempt 必须各自拿到不同的 database、role、nonce；任一共享即判失败
- 任何缺失真实依赖、导入失败、网络不通、临时 Vitest 配置、静态 grep 断言都不算 Red 业务失败，而是 `FAKE_RED`
- pre-import oracle 必须分别拒绝 missing、expired、stale nonce、reused、ambiguous、misdirected、loopback、default socket、production name/host/privilege、tampered receipt
- cleanup 必须覆盖 success、failure、cancel、kill -9、runner crash、worker restart、recovery；重复 cleanup 仍需幂等

## 范围限定

**在范围内**：kernel test environment controller 的 capability 发放、DB/role attempt 隔离、receipt schema 冻结、pre-import oracle、真实 local/fleet runner 红测路径、real PG bootstrap、terminal cleanup 与 attested receipt 留证、V5 CI bootstrap 兼容
**不在范围内**：生产部署、真实 merge、非 DB-backed role 扩权、caller/task payload/prompt/git/stdout/callback/result/decision log 直传凭据、任何 production database 写入、把 bootstrap fixture 固化为长期配置

## 假设

- [ASSUMPTION: 本 sprint 的实现主落点在 `packages/brain/` 及其现有 harness/controller/runner 相关链路，remote bridge 与 fleet worker 只按任务描述要求补真实验证，不新造旁路 facade]
- [ASSUMPTION: `origin/main` 已至少到达 `d37a5e57827900be2651fe39655690238513128f`，更老 receipt 与批准均视为失效证据]
- [ASSUMPTION: operator 持有并会在终态验证后移除 `cecelia-harness-test-pg-bootstrap` fixture；该 fixture 只作为一次性 Red 证据环境]

## 预期受影响文件

- `packages/brain/src/`: controller、dispatcher、production transport、receipt validator、cleanup/reconciler、attempt runner 接线与保护逻辑
- `packages/brain/src/__tests__/` 与 `packages/brain/src/**/integration*`: 真实 PG、真实 runner、真实 role 注入/缺失、cleanup/recovery、counterfactual 测试
- `packages/engine/` 或 Harness 运行时接线文件：仅在需要把 `TEST_DATABASE_URL`/receipt 引用精准注入指定角色命令时受影响
- `sprints/07280011-kernel-769cdf5b/`: proposer 产出的 contract-draft、contract-dod、真实 Red/Green 命令与证据脚本

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 各 cleanup/reconciliation 路径必须在有界时间内完成并可留证；具体秒数待 proposer 按现有 controller 行为固化
- 频控: 每个 attempt 只允许 create/lease 一次 capability，重复 cleanup 必须幂等，禁止无限重试刷库
- 版本要求: PostgreSQL fixture 固定 `postgres:16-alpine`；bootstrap 数据库固定 `harness_controller_bootstrap`
- 可观测: 每个 Golden Path 步骤都要产出真实命令输出或 receipt 证据；不得把 URL/password/token 写入 git、stdout、callback、decision log 或 receipt

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [真环境] 依赖真实 PostgreSQL、真实 runner、真实 transport 的接缝断言，只有在真目标上验证过才算 done（来源: area）
- [环境假设] 禁止写死环境假设值；fixture/host/CIDR/角色边界必须从 receipt 或运行时真值推导，而不是硬编码默认生产/本地回退（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志；receipt 永远不含 URL/password/token（来源: area）
- [租户隔离] 测试默认按隔离思路设计；attempt 之间数据库、role、nonce 不得串用（来源: area）
- [单 slot 串行] 当前 slot 只推进这一条 harness initiative；恢复时以外部真相核查后整条链重新收口，不并行复用同一 attempt 状态（来源: area）
- [外部真相] watchdog/recovery 误标或中断后的恢复必须基于 PR/sprint/receipt 等外部真相核查，而不是信任旧批准或 exit code 单信号（来源: area）
- [语义成功] capability、receipt、cleanup、worker attempt API 的成功判定必须看语义字段与真实业务结果，不能用 grep `ok:true` 或文件存在代替（来源: area）
- [无共享 CI 旁路] 不允许通过修改共享 CI/静态 allowlist 文件把这次真实 PG/runner 验证“洗绿”；需要额外基础设施改动时另开 sprint（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块只框定端到端验收点；proposer 必须把每一步翻译成真实可执行脚本，并给出 Red、counterfactual、restore、Green 命令与 receipt 证据。

```bash
# 占位：proposer 将按 local_api 产出真实脚本
# 期望验收点（自然语言）：
# 1. 仅 server-owned TaskBundle 声明 DB-backed contract 的 planner/proposer/reviewer/generator/evaluator 命令收到 TEST_DATABASE_URL 与无凭据 receipt 引用；judge/无关角色明确拿不到。
# 2. bootstrap Red 使用一次性 fixture 连接成功后，真实创建 attempt 专属 test DB 与 short-lived role，并在 local path 与 fleet path 上都跑到当前生产链路，再因“当前实现尚未正确 provision/inject/attest/cleanup”触发命名业务断言失败。
# 3. pre-import oracle 在真实 PG 上验证 current_database/current_user/inet_server_addr/allowed_cidrs/nonce/零生产库权限；每种坏 receipt 或坏目标都独立失败。
# 4. migration/seed/bootstrap 只触达 TEST_DATABASE_URL；V5 现有 `journey_step_links` bootstrap 行为保留；旧 `DB_NAME=cecelia` 工作流在同一 fixture 上以命名业务断言失败。
# 5. success/failure/cancel/kill -9/runner crash/worker restart/recovery 后，role 登录失败且 DB/lease 消失；cleanup receipt 留证且不含凭据；重复 cleanup 幂等。
```

## journey_type: autonomous
## journey_type_reason: 任务聚焦 Brain/Harness 内部 controller、runner、receipt 与 cleanup 纯后端链路，不含 dashboard 或外部用户界面。
## target_environment: local_api
## target_environment_reason: payload 显式给出 `target_environment=local_api`，且本 sprint 的 planner/proposer/evaluator 主验收面是 localhost Brain API + 本地/受控真实 PostgreSQL 接缝。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 1a738e05-99a7-421c-a52d-c2bb80bf19be
