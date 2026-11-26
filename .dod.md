# 悦升 101 从本次冻结副本加载独立运行端

Task: ff8ab780-8f19-425e-91d9-3d54e264bd04
GP-Anchor: none(infra)

- [x] 独立入口完成 attestation 后，从本轮冻结路径启动 101、102、103 宿主，保留各阶段业务读回。
  Test: manual:node node_modules/vitest/vitest.mjs run --root packages/brain packages/brain/scripts/standalone-skill/native-discovery.test.mjs
- [x] 运行模块在冻结快照缺少登记或字节被更换时，启动前拒绝并保留原错误口径。
  Test: manual:node node_modules/vitest/vitest.mjs run --root packages/brain packages/brain/scripts/standalone-skill/native-discovery.test.mjs
- [ ] 安装完整合并版本到独立路径，按真实 worker provider 配置核对已安装文件摘要。
  Test: manual:node --check packages/brain/scripts/standalone-skill/worker.mjs
