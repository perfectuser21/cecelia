# DoD

- [x] [BEHAVIOR] 旧 CI 来源保持有效，完整未来 typed CI 来源与实际注册调用链可证明，任一成员篡改拒绝并清空绑定。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/lib/__tests__/existing-ops-source-impact.test.js src/lib/__tests__/existing-ops-workspace-source.test.js
- [x] [BEHAVIOR] 未来夹具只读固定 Git 数据，摘要变化及不存在路径拒绝，既有八项 Git 合同保留。
  Test: manual:node --test scripts/ci/__tests__/fixed-local-git.test.mjs
- [ ] [BEHAVIOR] 现行旧 snapshot 与新来源模块仅按完整只读 cohort 接受，历史版本保留，混搭拒绝。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/claude-channel-retired.guard.test.js src/__tests__/claude-channel-retired.reader-tuples.test.js
- [ ] [BEHAVIOR] 三 scope 原生来源回执及原五项 GitHub 必需检查成功，旧 CI/Impact workflow 与保护规则保持。
  Test: manual:原五项 GitHub 必需检查及三 scope 来源回执
