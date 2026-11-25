# CI原生APT安装回归

Task: 0de62006-7ab2-42c4-918f-21d47e5234e7
GP-Anchor: none(infra)

- [ ] 实际workflow命令在官方us-west-2原生源下可抵达工具安装；update/install失败必须非零，先红后绿并永久留在Scripts CI。
  Test: manual:node --test scripts/ci/__tests__/basic-ubuntu-native-install.test.mjs
- [ ] 已无现役调用的源校验/旧镜像恢复及专属测试清退，保留Chromium真实安装和失败传播；完整Scripts/Ops通过。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [ ] 独立消费者审查与显式续证通过；PR/main真实APT安装和全部检查成功，完整自动CD与生产业务读回成功。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-deploy-certification.test.mjs
