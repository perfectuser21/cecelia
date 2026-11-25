# 漏洞审计无重复安装验收

Task: 22da6cc5-ed6c-4ec3-b10f-f8cadba87e6c
GP-Anchor: none(infra)

- [ ] 真实workflow入口经真实npm在无node_modules隔离夹具仍审计生产/开发包，未知漏洞和故障拒绝；先红后绿永久留CI。
  Test: manual:node --test scripts/ci/__tests__/basic-security-lock-audit.test.mjs
- [ ] 其余锁文件一致性与真实安装、严格结果聚合保留；工作流与原审计策略回归通过。
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs scripts/ci/__tests__/basic-fixed-core.test.mjs scripts/ci/__tests__/basic-dependency-audit.test.mjs
- [ ] 独立审查及显式续证通过，PR/main全绿、自动CD及生产读回通过。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-deploy-certification.test.mjs
