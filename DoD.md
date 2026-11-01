# DoD

- [x] [BEHAVIOR] 基线发布只接受正式 Main CI 身份及完整原 ZIP，用途错误、来源混搭、摘要篡改和无效租约拒绝。
  Test: manual:node --test scripts/ci/__tests__/basic-ci-admission-authority.test.mjs scripts/ci/__tests__/basic-ci-admission-artifact.test.mjs scripts/ci/__tests__/basic-ci-admission-publisher.test.mjs scripts/ci/__tests__/basic-ci-admission-inputs.test.mjs
- [x] [BEHAVIOR] 原五分钟 Node 入口各执行一次有效合同；真实子进程失败、跳过或超时均拒绝，Brain 单包安装不依赖根目录测试包。
  Test: manual:node --test scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs scripts/ci/__tests__/implementation-main-snapshot.test.mjs scripts/ci/__tests__/implementation-skill-source.test.mjs scripts/ci/__tests__/device-patrol-governance.test.mjs
- [x] [BEHAVIOR] 冷浅克隆可还原固定历史 Git 数据，真实替换引用与环境重定向不改变 canonical 读取，损坏对象拒绝并清理。
  Test: manual:node --test scripts/ci/__tests__/fixed-local-git.test.mjs
- [x] [BEHAVIOR] 现行及历史来源只读 cohort 完整配对，旧版和新增来源模块可验证，混搭与缺项拒绝。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/claude-channel-retired.guard.test.js src/__tests__/claude-channel-retired.reader-tuples.test.js
- [x] [BEHAVIOR] 旧 CI 与 Impact 工作流字节保持受保护 A 原件，未提前切换运行门禁。
  Test: manual:node --input-type=module -e "import{readFileSync as r}from'node:fs';import{createHash as h}from'node:crypto';import{strict as a}from'node:assert';for(const[p,s]of[['ci.yml','91eb26e207d3f15cf810fe1dec4e9137d0f31d1c8004f7938ded7cb7112335e2'],['implementation-impact.yml','4e59206bd6dd08b77ea3a59e0feb44a2371ffc0fa9139b81f67e64a0169a9cf9']])a.equal(h('sha256').update(r('.github/workflows/'+p)).digest('hex'),s)"
