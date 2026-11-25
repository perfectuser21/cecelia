# CI宿主工具准备验收

Task: df3410ee-b85e-4c7e-8473-5688e34f0ab4
GP-Anchor: none(infra)

- [ ] 实际workflow仅image/dashboard退出工具安装，其余9项原APT及错误传播保留。
  Test: manual:node --test scripts/ci/__tests__/basic-host-tool-preparation.test.mjs scripts/ci/__tests__/basic-ubuntu-native-install.test.mjs
- [ ] 实际mirror脚本缺jq在首次sudo前拒绝；成功路径原生jq配置正确且仅SIGHUP；非托管拒绝，先红后绿。
  Test: manual:node --test scripts/ci/__tests__/basic-host-tool-preparation.test.mjs
- [ ] 完整Scripts/Ops、独立审查、PR/main实际镜像/前端检查及完整自动CD/生产读回通过。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:node scripts/ci/run-basic-check.mjs ops
