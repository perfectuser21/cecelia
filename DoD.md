# 安全扫描归档清理验收

Task: 18d0a206-4802-4963-9152-99d78f74b8e9
GP-Anchor: none(infra)

- [ ] 默认安全查询保留，扫描只排两处退役归档；既有语言/触发/汇总保护保持，失败回归保留。
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs
- [ ] Scripts/Ops完整回归，Brain生产源码和CD恢复合同保持。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [ ] 消费者认证经完整审查后显式刷新；PR/main真实扫描不抽取归档，生产发布读回同SHA。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-deploy-certification.test.mjs
