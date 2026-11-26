# CI重放证据与Nightly健康计数修复

Task: 723afb4a-4f19-4f48-869d-aaf51e13efa2
GP-Anchor: none(infra)

- [x] 在实际smoke/host、真实子进程及隔离PG中注入replay新增调用、新增动作、既有动作结果漂移、业务文件变化，全部必须拒绝PASS。
  Test: manual:node --test packages/brain/scripts/smoke/__tests__/commander-repair-replay.node-test.mjs
- [x] replay前后读取同一run的完整调用字节、稳定排序动作关键字段和业务产出；保留原返工、耗尽、host-kill、deadline、thread及ledger断言。真实订阅无调用计量时明确未评估，不写true。
  Test: manual:node packages/brain/scripts/smoke/commander-repair-smoke.mjs
- [x] 真实PG永久回归由现有runtime-integration相同TEST_DB_URL步骤显式执行；Nightly夹具由既有Scripts集合收集，不新增job/workflow。
  Test: manual:node --test scripts/ci/__tests__/basic-nightly-health-attempt.test.mjs
- [x] Nightly实际Start Brain Bash在第三次健康探测成功时输出3s，不读取无关i变量；原90次预算、触发和业务逻辑保留。
  Test: manual:node --test scripts/ci/__tests__/basic-nightly-health-attempt.test.mjs
- [ ] 独立review、正常PR必需CI及真实合并/后继发布由当前任务继续跟踪，不以本地通过声明发布完成。
  Test: manual:node scripts/ci/run-basic-check.mjs --list scripts

PG命令要求TEST_DB_URL指向127.0.0.1的cecelia_scratch；无PG的unit6收集会明确skip，不能代替runtime-integration真实执行。
