# CD 完整快照恢复测量与回归验收

Task: 737eea30-c4d3-43e7-9f31-d6c6d5de0a32
GP-Anchor: none(infra)

- [ ] 完整快照保留流式导出和恢复，数据库容量覆盖大对象；绑定容器身份，导出、传输、恢复失败均禁止迁移和晋级。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [ ] 真实 PostgreSQL 快照恢复回归进入现行集成入口，实际执行新恢复实现并核对完整数据、外键及隔离边界。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-integration
- [ ] 构建、镜像搬运及隔离验收阶段记录绑定SHA/请求的真实耗时；保留管道重叠语义，不虚报独立网络或整体提速。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [ ] 同一份完整归档的串行及双路恢复保留全数据、约束一致性对照；实测不足以证明整体收益时不启用落盘并行。
  Test: manual:bash -c 'python3 /var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/cecelia-cd-restore-9r69e2la/logs/verification-tools/cd-restore-benchmark.py --resume --keep-archive'
- [ ] Brain 版本同步。
  Test: manual:bash scripts/check-version-sync.sh
