# Sprint PRD — Fleet Worker 实例互杀防护 + quarantined attempt 终态闭环（含 restart_reason lineage 与 PG runtime 投影）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除同机多 Worker 互杀与 quarantined 无限卡死两类 P0 稳定性事故）

## 背景

successor-4（recovery/recurrence of ad84d62f）。Controller lease renewal 已部署。当前 `attempt-resources.cjs` 的 `reconcile()` 只按 `label=cecelia.fleet.resource=postgres` 过滤 Docker 容器/网络，缺少实例维度：同一 Docker daemon 上、相同 canonical machine_id、仅端口/data root 不同的两个 Fleet Worker 会把对方的 attempt 容器判为"自己拥有且未保留"从而 `docker rm -f` 互杀。expired quarantined attempt 缺少一次性事务终态化与可查询 restart_reason lineage，导致无限卡死/重复重开。本 sprint 严格 TDD：先红后绿，保留旧合同全部要求 + 增量硬要求 A（restart_reason lineage）与 B（postgres contract→runtime 投影真验）。

## Golden Path（核心场景）

系统从 [同机多实例并存 + attempt 生命周期变更] → 经过 [按实例 namespace 隔离的 reconcile / 一次事务终态化] → 到达 [各实例资源互不侵犯、quarantined 闭环可查证]。

**场景 A · 实例互杀防护**
1. 同一 Docker daemon 上 Worker-A、Worker-B（相同 canonical machine_id，不同端口/data root）各自持有各自 attempt 的 PG 容器/网络
2. Worker-A 触发 reconcile，只匹配带**自己 instance namespace** 的容器/网络
3. 可观测结果：Worker-A 仅 stop/rm 属于自己 namespace 且不在 `retainedAttemptIds` 的资源；Worker-B 的容器/网络完好，无被误删

**场景 B · namespace 持久且重启稳定 + 旧容器 fail-closed**
1. Worker 首次启动生成 instance namespace 并持久化到 data root
2. Worker 重启后从持久化读取，namespace 稳定不变（同 data root 得同 namespace）
3. 可观测结果：reconcile 遇到**旧的无 namespace 标签**容器时 fail-closed（拒绝盲扫删除，交由人工/告警），绝不跨实例误删

**场景 C · quarantined expired attempt 一次事务终态化 + replacement lineage**
1. 一个 quarantined attempt 超过 lease/expiry 阈值
2. 系统在**一次事务**里将其终态化为 failed，evidence **append-only** 写入（不覆盖历史证据）
3. 生成 replacement attempt，**继承并结构化记录 restart_reason**（`retry_of_attempt_id` + `restart_reason` 串成可查询 lineage）
4. 可观测结果：重复 reconcile **幂等**——不产生第二个 replacement、不重复终态化；lineage 可从子 attempt 反查到根因

**场景 D · postgres contract → runtime 投影真验**
1. task payload `contract_requirements.postgres=true`
2. 系统机械投影为 `runtime_resources.postgres=true`
3. 可观测结果：attempt 运行时真实起了 PostgreSQL 容器（真 Docker），`pg_isready` 可确认接受连接

## 边界情况

- 同 machine_id 但 data root 相同（异常配置）：视为同实例，不隔离
- 无 namespace 的历史容器：fail-closed，不删不改，仅告警
- reconcile 与 quarantine 并发：终态化事务需幂等，二次进入返回 deduped
- resume/replacement launch 失败：父子 attempt 均需落终态失败证据，不留半开状态

## 范围限定

**在范围内**：instance namespace 生成/持久化/重启稳定；reconcile 按 namespace 隔离；旧无 namespace fail-closed；quarantined expired 一次事务终态化 + append-only evidence + replacement 生成 + restart_reason lineage + 幂等；contract_requirements.postgres→runtime_resources.postgres 投影；真 Docker 双 data root 与真 PostgreSQL 复演。
**不在范围内**：Controller lease renewal（已部署）；非 postgres 的其它 runtime resource；跨 daemon/跨机器隔离；UI/dashboard 呈现。

## 假设

- [ASSUMPTION: canonical machine_id 已由现有 capability 层稳定提供，本 sprint 只在其上叠加 instance namespace 维度]
- [ASSUMPTION: instance namespace 以 data root 路径为持久化锚点，同 data root 复启得同 namespace]
- [ASSUMPTION: restart_reason lineage 复用 attempts 表既有 `retry_of_attempt_id` + `restart_reason` 列，不新建表]

## 预期受影响文件

- `packages/brain/scripts/fleet-worker/attempt-resources.cjs`：reconcile 的 `docker ps/network ls` 过滤需叠加 instance namespace 标签维度；`contract_requirements.postgres` → runtime 投影校验
- `packages/brain/scripts/fleet-worker/workspace-manager.cjs`：instance namespace 生成/持久化/重启读取；旧无 namespace fail-closed
- `packages/brain/scripts/fleet-worker/attempt-runner.cjs`：quarantine/reconcile 编排，restart_reason 透传
- `packages/brain/src/harness-relay-watchdog.js`：`reconcileExpiredKernelAttempt` 生成 replacement 时结构化记录 restart_reason lineage、一次事务终态化、幂等
- `packages/brain/scripts/fleet-worker/attempt-resources.test.cjs` / `workspace-manager.test.cjs` / `packages/brain/src/__tests__/kernel-stale-attempt-reconcile.test.js`：新增 failing 回归测试（互杀、fail-closed、lineage、幂等、PG 投影）

## NFR 约束

<!-- 来源: thin_prd 主源（step/feature decisions category=nfr 均为空）；PrepPRD 显式值优先 -->
- 原子性：expired quarantined attempt 必须一次事务终态化，禁止多步半开状态
- 幂等：重复 reconcile 不得二次终态化/二次生成 replacement
- 证据：evidence 一律 append-only，禁止覆盖历史证据
- 隔离：reconcile 只作用于本 instance namespace，跨实例 fail-closed
- 版本要求：postgres 走真实 Docker 容器，`runtime_resources.postgres` 必须由 `contract_requirements.postgres` 机械投影且真验（pg_isready）
- 可观测：restart_reason 必须结构化落库，形成从子 attempt 可反查根因的 lineage

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 两源为空）；系统级全量 + 与本 sprint 有直接锚点的 capture-triage learning 精选注入 -->
- [单slot串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [禁写死环境] 禁止写死环境假设值（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [多租户默认] 测试默认多租户（来源: area）
- [凭据安全] API Key/Token/密钥不进 git（来源: area）
- [日志脱敏] 日志必须脱敏（来源: area）
- [端点鉴权] 端点必须鉴权（来源: area）
- [租户隔离] 记忆/资源按租户隔离（来源: area）
- [status枚举] status 枚举硬编码断言，GAN 新增状态值时须全仓库 grep 同步（来源: area·052e10a0）
- [真实列名] 涉 attempts 表字段的合同/测试前先 psql 核对真实列名，禁凭经验假设（来源: area·e6513dff）
- [target_env来源] target_environment 从 DB tasks.payload 读取，非从文件（来源: area·f91cbfc7）
- [会话独享临时路径] evaluator 临时脚本落会话独享路径（含 session id），禁共享 /tmp 固定文件名（来源: area·3b9804e6）
- [DB_NAME一致] 写入侧与校验侧 DB_NAME 必须来自同一变量/同一解析逻辑（来源: area·f437b0fd）
- [非冷启动覆盖] 依赖"重置=冷启动"的测试须补非冷启动断言（namespace 重启稳定相关）（来源: area·b9e7a730）
- [judge机械闸⑤] local_api/无 UI smoke 任务须在合同侧显式声明验证口径，避免 meta_verification_gap 死锁（来源: area·a0bac43b）
- [null契约else] 调用"失败返回 null/false"契约的函数后必须显式写 else 分支（来源: area·e9c7752f）
<!-- 另有约 60 条 area 级 capture-triage learning 未逐条注入（与本 sprint 无直接锚点，铁律精神已由上列覆盖） -->

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 golden-paths，仅取 ability_status=done|working -->
- （本 line 暂无已验收历史：唯一 ability "Agent 一键归零重置" 状态为 planned，未纳入累积）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + psql + 真实 Docker 双 data root）。

```bash
# 占位：proposer 将填入 local_api 真验脚本
# 期望验收点（自然语言）：
# 1) 双 Worker（同 daemon/同 machine_id/异 data root）各起一个真 PG 容器 → Worker-A reconcile 后 Worker-B 容器仍存活（互杀被拦）
# 2) Worker 重启后 instance namespace 与重启前一致；旧无 namespace 容器被 fail-closed 而非删除
# 3) 造一个 expired quarantined attempt → 真 PostgreSQL 中一次事务变 failed、evidence append-only、生成 replacement 且 restart_reason lineage 可 SQL 反查；再次 reconcile 幂等（无第二个 replacement）
# 4) contract_requirements.postgres=true 的 attempt 运行时 runtime_resources.postgres=true 且 pg_isready 通过
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端 —— fleet-worker attempt 生命周期与 Docker 资源治理，无前端/无用户界面
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；本地 evaluator 用真实 Docker 双 data root + 真实 PostgreSQL + psql/curl 复演，无 UI
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定：任务无 ability_id、无 golden-path step 决策）
