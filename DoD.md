# 备份保留规则验收

Task: bb1086a4-3ede-47b5-9055-26a6274a3d4d
GP-Anchor: none(infra)

- [ ] 当前旧脚本真实逻辑在隔离CLI/文件fixture下复现过期远端副本未清理；实现后同一业务断言通过。
  Test: manual:bash scripts/ops/__tests__/backups/backup-cecelia-studio.test.sh
- [ ] 新备份解析和双SHA成功后，仅14天外、本地同SHA、精确身份的远端重复副本可回收；Mac历史及回执不变。
  Test: manual:bash scripts/ops/__tests__/backups/backup-cecelia-studio.test.sh
- [ ] archive/传输/hash/身份/锁/目录漂移等错误不删除未知文件，未批准命令及网络被fixture拒绝。
  Test: manual:bash scripts/ops/__tests__/backups/backup-cecelia-studio.test.sh
- [ ] 现有Ops自动发现并执行新测试，Script及现行DevGate不削减，固定版本入口部署后读回。
  Test: manual:node --test scripts/ci/__tests__/basic-ops-coverage.test.mjs
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
