---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Fleet Worker 实例互杀防护 + quarantined attempt 终态闭环

**范围**: `packages/brain` Fleet Worker attempt 生命周期 —— instance namespace 隔离 reconcile；旧无 namespace fail-closed；expired attempt 一次事务终态化 + append-only evidence + replacement restart_reason lineage + 幂等；contract_requirements.postgres→runtime_resources.postgres 投影真起 PG。
**大小**: M
**target_environment**: local_api（judge 机械闸⑤：本任务无 UI smoke，验证口径显式声明为——真 PostgreSQL `harness_attempts` 状态断言 + 真 Docker 容器存活/`pg_isready` + 真 fs namespace 持久化；不依赖任何浏览器/截图 oracle）

## ARTIFACT 条目

- [ ] [ARTIFACT] attempt-resources.cjs reconcile 叠加 instance namespace 维度
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/fleet-worker/attempt-resources.cjs','utf8');if(!c.includes('cecelia.fleet.instance'))process.exit(1)"
- [ ] [ARTIFACT] workspace-manager.cjs 暴露 instance namespace 生成/持久化 API
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/fleet-worker/workspace-manager.cjs','utf8');if(!c.includes('resolveInstanceNamespace'))process.exit(1)"
- [ ] [ARTIFACT] attempt-runner.cjs 暴露 contract_requirements→runtime_resources 投影
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/fleet-worker/attempt-runner.cjs','utf8');if(!c.includes('projectContractRequirements'))process.exit(1)"
- [ ] [ARTIFACT] 场景C 真 PG 集成测试已建并登记进 POSTGRES_INTEGRATION_TESTS
  Test: node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('kernel-instance-fencing-lineage.pg.integration.test.js'))process.exit(1)"

## Invariant 覆盖（铁律清单逐条映射 — INV 或 N/A）

- [ ] [BEHAVIOR] [L2] INV-status枚举: 终态化只用既有枚举 failed / kind resume，不新增 status 值
  动作: grep attempt 终态化实现中的 status 目标值
  预期观察: 实现里出现 'failed'，且全仓库无对 harness_attempts 写入 'quarantined' 枚举
  等待预算: 0s
  留证: grep 输出
  Test: manual:bash -c 'grep -rn "quarantined" packages/brain/scripts/fleet-worker/ packages/brain/src/harness-relay-watchdog.js | grep -iE "status *= *.?quarantined|IN .*quarantined" && { echo "FAIL: 新增了 quarantined 枚举"; exit 1; }; echo OK'
- [ ] [BEHAVIOR] [L2] INV-真实列名: lineage 断言用 harness_attempts 真实列（retry_of_attempt_id/restart_reason）
  动作: 对空库 migrate 后核对列存在
  预期观察: information_schema 中两列均存在于 harness_attempts
  等待预算: 0s
  留证: psql 输出
  Test: manual:bash -c 'psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='"'"'harness_attempts'"'"' AND column_name IN ('"'"'retry_of_attempt_id'"'"','"'"'restart_reason'"'"')" | grep -qx 2 || { echo FAIL; exit 1; }; echo OK'
  gate-allow: domain/db-no-time-window information_schema.columns 是 schema 元数据定点存在性检查（列名固定集合），非业务数据聚合，历史行无法冒充，时间窗不适用

> 其余铁律映射（N/A 显式声明，非 checkbox 不计入 BEHAVIOR 数）：
> - [单slot串行] N/A：本 sprint 不改任务并发度。
> - [禁写死环境] 覆盖：DB_URL/端口/data root 全由注入或环境推导，无写死坐标/阈值（见 B-02/B-03 用运行时 namespace）。
> - [真环境验证] 覆盖：B-05/B-06 真 PG、E2E 真 Docker。
> - [多租户默认] N/A：Fleet Worker 资源治理非租户数据面。
> - [凭据安全]/[日志脱敏] 覆盖：PG 临时凭据不入日志（沿用 attempt-resources 既有脱敏），无新增凭据。
> - [端点鉴权]/[租户隔离] N/A：无新增 HTTP 端点。
> - [target_env来源] 覆盖：target_environment=local_api 从 payload 读取（已确认）。
> - [会话独享临时路径] 覆盖：E2E 用 mktemp -d 会话独享路径，无共享 /tmp 固定名。
> - [DB_NAME一致] 覆盖：E2E 写入侧(migrate)与校验侧(psql)DB 均来自同一 $DB_URL 解析。
> - [非冷启动覆盖] 覆盖：B-01 含非冷启动（第二次读取）稳定断言。
> - [judge机械闸⑤] 覆盖：本文件头部已显式声明验证口径。
> - [null契约else] 覆盖：reconcile 对"缺 namespace 返回 null/未匹配"契约后显式 fail-closed else 分支（B-03）。

## BEHAVIOR 条目（五行剧本 — 内嵌 manual: 命令）

- [ ] [BEHAVIOR] [L2] B-01: instance namespace 持久化到 data root 且 restart-stable namespace
  动作: 以同一临时 data root 两次调用 workspace-manager.resolveInstanceNamespace（第二次=非冷启动）
  预期观察: 两次返回相同 namespace 字符串，且 data root 下持久化文件存在
  等待预算: 0s
  留证: vitest 输出（scripts/fleet-worker/workspace-manager.test.cjs）
  Test: manual:bash -c 'cd packages/brain && npx vitest run scripts/fleet-worker/instance-fencing.test.cjs -t "restart-stable namespace" 2>&1 | tail -20 | grep -qE "1 passed|✓" || { echo FAIL; exit 1; }; echo OK'
- [ ] [BEHAVIOR] [L2] B-02: reconcile does not reap other-instance 容器（实例隔离）
  动作: 注入两 namespace 的 docker 输出，Worker-A(ns-A) 执行 reconcile(retained=[])
  预期观察: removed_attempts 只含 ns-A 的 attempt，绝不含 ns-B 的 attempt
  等待预算: 0s
  留证: vitest 输出（scripts/fleet-worker/*.test.cjs）
  Test: manual:bash -c 'cd packages/brain && npx vitest run scripts/fleet-worker/instance-fencing.test.cjs -t "does not reap other-instance" 2>&1 | tail -20 | grep -qE "1 passed|✓" || { echo FAIL; exit 1; }; echo OK'
- [ ] [BEHAVIOR] [L2] B-03: fail-closed on legacy no-namespace 容器（不删仅告警）
  动作: 注入一个缺 cecelia.fleet.instance 标签的旧容器，执行 reconcile
  预期观察: 旧容器不进 removed_attempts、零 docker rm，进入 fail_closed 告警集
  等待预算: 0s
  留证: vitest 输出（scripts/fleet-worker/*.test.cjs）
  Test: manual:bash -c 'cd packages/brain && npx vitest run scripts/fleet-worker/instance-fencing.test.cjs -t "fail-closed on legacy no-namespace" 2>&1 | tail -20 | grep -qE "1 passed|✓" || { echo FAIL; exit 1; }; echo OK'
- [ ] [BEHAVIOR] [L2] B-04: projects contract_requirements.postgres 到 runtime_resources.postgres
  动作: 用 {contract_requirements:{postgres:true}} 调 projectContractRequirements
  预期观察: 返回 runtime_resources.postgres===true；输入 false 时投影为 false
  等待预算: 0s
  留证: vitest 输出（scripts/fleet-worker/*.test.cjs）
  Test: manual:bash -c 'cd packages/brain && npx vitest run scripts/fleet-worker/instance-fencing.test.cjs -t "projects contract_requirements.postgres" 2>&1 | tail -20 | grep -qE "1 passed|✓" || { echo FAIL; exit 1; }; echo OK'
- [ ] [BEHAVIOR] [L2] B-05: expired attempt terminalized to failed and records restart_reason lineage [接缝×2]
  动作: 真 PG 空库 migrate 后插入一个 lease 过期的 active parent attempt，跑真实终态化 reconcile
  预期观察: within 30s parent.status='failed'，且 replacement child 满足 retry_of_attempt_id=parent 且 restart_reason 非空、attempt_kind='resume'（SQL 反查 lineage 成立）
  等待预算: 30s
  留证: PG 集成测试输出 + harness_attempts JOIN 查询结果
  Test: manual:bash -c 'cd packages/brain && DB_URL="$DB_URL" NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-instance-fencing-lineage.pg.integration.test.js -t "records restart_reason lineage" 2>&1 | tail -25 | grep -qE "1 passed|✓" || { echo FAIL; exit 1; }; echo OK'
- [ ] [BEHAVIOR] [L2] B-06: repeat reconcile is idempotent — no second replacement [接缝×2]
  动作: 对同一已终态化的 expired parent 再次跑 reconcile
  预期观察: replacement child 计数不变（无第二个 child）、parent 不被二次终态化，返回 deduped
  等待预算: 30s
  留证: PG 集成测试输出 + child 计数对比
  Test: manual:bash -c 'cd packages/brain && DB_URL="$DB_URL" NODE_ENV=test npx vitest run --config vitest.integration.config.js src/__tests__/integration/kernel-instance-fencing-lineage.pg.integration.test.js -t "no second replacement" 2>&1 | tail -25 | grep -qE "1 passed|✓" || { echo FAIL; exit 1; }; echo OK'
