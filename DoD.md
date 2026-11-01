# DoD

- [ ] [BEHAVIOR] 基线发布只接受正式 Main CI 身份及完整原 ZIP，用途错误、来源混搭、摘要篡改和无效租约拒绝。
  Test: manual:node --test scripts/ci/__tests__/basic-ci-admission-authority.test.mjs scripts/ci/__tests__/basic-ci-admission-artifact.test.mjs scripts/ci/__tests__/basic-ci-admission-publisher.test.mjs scripts/ci/__tests__/basic-ci-admission-inputs.test.mjs
- [ ] [BEHAVIOR] 原五分钟 Node 入口各执行一次有效合同；真实子进程失败、跳过或超时均拒绝，Brain 单包安装不依赖根目录测试包。
  Test: manual:node --test scripts/ci/__tests__/workspace-ci-source-bundle.test.mjs scripts/ci/__tests__/implementation-main-snapshot.test.mjs scripts/ci/__tests__/implementation-skill-source.test.mjs scripts/ci/__tests__/device-patrol-governance.test.mjs
- [x] [BEHAVIOR] 冷浅克隆可还原固定历史 Git 数据，真实替换引用与环境重定向不改变 canonical 读取，损坏对象拒绝并清理。
  Test: manual:node --test scripts/ci/__tests__/fixed-local-git.test.mjs
- [ ] [BEHAVIOR] 现行及历史来源只读 cohort 完整配对，旧版和新增来源模块可验证，混搭与缺项拒绝。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/claude-channel-retired.guard.test.js src/__tests__/claude-channel-retired.reader-tuples.test.js
- [ ] [BEHAVIOR] 原五项 GitHub 必需检查通过后正常合并；旧 CI、Impact 工作流及保护规则保持。
  Test: manual:bash -c 'gh pr checks 6724 --repo perfectuser21/cecelia --required'
