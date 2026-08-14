---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Fleet Worker 实例互杀根治 + expired attempt 原子闭环 + 批准合同 artifact 薄包装

**范围**: 实例级容器隔离（namespace 持久化 + 旧容器 fail-closed）；expired fleet-worker attempt 单入口原子终态化 + resume lineage + 幂等；postgres 契约→runtime 投影与真验；`sprint_dir/tests` 可执行薄包装 + artifact 收集兼容；CI 单源保持。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] sprint_dir/tests 可执行薄包装存在且加载单一测试实现（不复制断言）
  Test: node -e "const c=require('fs').readFileSync('sprints/08132138-fleet-worker-instance-fencing/tests/instance-fencing.wrapper.cjs','utf8');if(!c.includes('instance-fencing.test.cjs'))process.exit(1);if(/expect\(|(^|[^A-Za-z])it\(|(^|[^A-Za-z])describe\(/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 薄包装 fail-closed：单源缺失分支存在（不静默 PASS）
  Test: node -e "const c=require('fs').readFileSync('sprints/08132138-fleet-worker-instance-fencing/tests/instance-fencing.wrapper.cjs','utf8');if(!c.includes('single-source test missing')||!c.includes('process.exit(1)'))process.exit(1)"

- [ ] [ARTIFACT] 单一测试实现由 Generator 落于 packages/brain/scripts/fleet-worker/（CI 单源，被 brain vitest scripts/** 收录）
  Test: node -e "const fs=require('fs');if(!fs.existsSync('packages/brain/scripts/fleet-worker/instance-fencing.test.cjs'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令；target_environment=local_api）

- [ ] [BEHAVIOR] [L3] B-01: 薄包装真跑单源全绿——docker 互杀隔离 / namespace 持久+fail-closed / expired 单入口闭环 / restart_reason lineage / postgres runtime 五项断言 [接缝×2]
  动作: node 直跑 sprint_dir/tests 薄包装，转发单一测试实现真实 exit code（Fleet 已注入 DB_URL，薄包装内翻译为 DB_*）
  预期观察: 薄包装 exit 0；vitest 输出含已执行测试（非 "No test files found"）；五项行为断言全绿
  等待预算: 180s（超时=FAIL）
  留证: 薄包装 stdout 末 40 行进 behavior_tests.log_tail
  Test: manual:bash -c 'OUT=$(node sprints/08132138-fleet-worker-instance-fencing/tests/instance-fencing.wrapper.cjs 2>&1); RC=$?; echo "$OUT" | tail -40; [ $RC -eq 0 ] || { echo "FAIL rc=$RC"; exit 1; }; echo "$OUT" | grep -qi "No test files found" && { echo "FAIL: single source not discovered"; exit 1; }; echo "$OUT" | grep -qiE "Test Files|Tests[[:space:]]" || { echo "FAIL: no test-run evidence"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: postgres runtime 真实可连（真验非假绿）
  动作: 用 Fleet 注入的 DB_URL 执行 psql SELECT 1
  预期观察: psql 返回 1，postgres 真实可达（非仅看字段/HTTP 200）
  等待预算: 10s
  留证: psql 命令输出
  Test: manual:bash -c 'psql "$DB_URL" -tAc "SELECT 1" | grep -qx 1 || { echo "FAIL: postgres unreachable"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: 仓库真实 migration bootstrap 后 harness_attempts 表存在
  动作: 空库跑仓库现有 migrate.js（DB_URL→DB_* bootstrap），机检 lineage 目标表
  预期观察: harness_attempts 表在 public schema 存在
  等待预算: 120s
  留证: to_regclass 查询输出
  Test: manual:bash -c 'psql "$DB_URL" -tAc "SELECT to_regclass('"'"'public.harness_attempts'"'"') IS NOT NULL" | grep -qx t || { echo "FAIL: harness_attempts missing (run migrate.js first)"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: lineage 四列存在——attempt_kind / retry_of_attempt_id / restart_reason / execution_transport
  动作: 查 information_schema.columns 计数四列
  预期观察: 四列全部存在（count==4）
  等待预算: 10s
  留证: 列计数输出
  Test: manual:bash -c 'N=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='"'"'harness_attempts'"'"' AND column_name IN ('"'"'attempt_kind'"'"','"'"'retry_of_attempt_id'"'"','"'"'restart_reason'"'"','"'"'execution_transport'"'"')" | tr -d " "); [ "$N" = "4" ] || { echo "FAIL: lineage columns $N/4"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-05: expired fleet-worker attempt 终态化+replacement lineage 落真库（单源用例经薄包装真跑，psql 复核 replacement 三字段）
  动作: 薄包装真跑单源 expired-closure 用例（真 PG 写 harness_attempts）后，psql 复核存在 attempt_kind='resume' 且 retry_of_attempt_id 非空且 restart_reason 非空的 replacement 行
  预期观察: 至少 1 行 resume replacement，三字段全部满足（restart_reason 非空、retry_of 指向 parent）
  等待预算: 180s
  留证: replacement 行查询输出
  Test: manual:bash -c 'node sprints/08132138-fleet-worker-instance-fencing/tests/instance-fencing.wrapper.cjs >/dev/null 2>&1 || { echo "FAIL: single-source expired-closure red"; exit 1; }; C=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE attempt_kind='"'"'resume'"'"' AND retry_of_attempt_id IS NOT NULL AND restart_reason IS NOT NULL AND restart_reason<>'"'"''"'"'" | tr -d " "); [ "${C:-0}" -ge 1 ] || { echo "FAIL: no resume replacement lineage in real PG"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-06: 幂等——重复 reconcile 不产生第二 replacement（单源用例二次调用后 replacement 计数不增）
  动作: 薄包装真跑单源幂等用例（同一 expired attempt 连调 reconcile 两次），单源内部断言 replacement 计数==1
  预期观察: 薄包装 exit 0（含幂等用例）；同一 parent 的 resume replacement 恰 1 行
  等待预算: 180s
  留证: 幂等用例输出 + 每 parent replacement 计数分布
  Test: manual:bash -c 'node sprints/08132138-fleet-worker-instance-fencing/tests/instance-fencing.wrapper.cjs >/dev/null 2>&1 || { echo "FAIL: idempotency case red"; exit 1; }; MAXDUP=$(psql "$DB_URL" -tAc "SELECT COALESCE(MAX(cnt),0) FROM (SELECT count(*) cnt FROM harness_attempts WHERE attempt_kind='"'"'resume'"'"' AND retry_of_attempt_id IS NOT NULL GROUP BY retry_of_attempt_id) s" | tr -d " "); [ "${MAXDUP:-0}" -le 1 ] || { echo "FAIL: duplicate replacement per parent=$MAXDUP"; exit 1; }; echo OK'

## Invariant 覆盖（INV-N — 铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-6 [台账不入库]：.harness/progress.md 不得进入 git 追踪
  动作: 扫描 git 追踪清单
  预期观察: 无 .harness/progress.md 被追踪
  等待预算: 5s
  留证: git ls-files 过滤输出
  Test: manual:bash -c 'git ls-files | grep -q "^\.harness/progress\.md$" && { echo "FAIL: 台账入库"; exit 1; }; echo OK'

- INV-1 [互杀隔离] → 由 B-01 承载（单源 docker 互杀隔离用例：A 生命周期回收对 docker 的 stop/rm 调用集不含 B namespace 容器）
- INV-2 [fail-closed 旧无 namespace 容器] → 由 B-01 承载（单源 fail-closed 用例：无 namespace 旧容器 stop/rm 调用数==0，namespace 重启前后一致）
- INV-3 [单入口幂等] → 由 B-05 + B-06 承载（reconcileExpiredKernelAttempt 唯一入口单事务终态化 + 重复 reconcile 幂等，真 PG 复核）
- INV-4 [真验非假绿] → 由 B-01（false-green guard：非 "No test files found" + 有测试执行证据）+ B-02（postgres 真连）承载
- INV-5 [canonical 不可变] N/A（运行时）：本 sprint 不改 canonical 文件；该铁律为收尾 commit 前不可变清单核对项，非运行时可执行断言，Generator 收尾按 canonical 不可变 lint 核对（非本 DoD 运行时 oracle）。

## 未覆盖真实链路清单

- docker daemon 真机互杀：单源 docker 互杀/fail-closed 用例的 docker CLI 子进程外层边界（runCommand）以记录调用集方式验证归属逻辑（禁 mock 边清单已声明：namespace 归属判定本身真实执行，仅外层 CLI 可 mock）。真机跨容器物理 stop/rm 的端到端在 fleet-worker execution_surface 上由 evaluator 复演；若 evaluator 环境无 live daemon，归属逻辑断言仍以真实过滤逻辑 + 调用集判定，不静默 SKIP（补位：evaluator 真机复演，见 thin_prd「像人一样复演共享 Docker 互杀」）。
