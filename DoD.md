# DoD：Brain深层旧实现清退

- [x] [BEHAVIOR] 旧Kernel新执行仍拒绝，只读观察的过期、resume和错误路径均零业务写入，不启动执行器；共享历史merge仍有效。
  Test: manual:cd packages/brain && node ../../node_modules/vitest/vitest.mjs run src/orchestrator/__tests__
- [x] [BEHAVIOR] 删除不可达旧部署及无调用内容写实现，现役部署/内容路由消费者保持合同。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-unit 1
- [x] [BEHAVIOR] 空转自动补测任务与专属自证测试退出；占位、手抄、重复注册测试移除，真实超时合同用虚拟时钟验证。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [x] [BEHAVIOR] 事实版本及注册引用无悬空，当前来源、任务、数据库和WorkflowRunner边界未放宽。
  Test: manual:node scripts/facts-check.mjs
- [ ] [BEHAVIOR] 完整PR通过且合并，事实证据actor及未迁出边界准确回写。
  Test: manual:curl -sf http://localhost:5221/api/brain/tasks/80ed095d-8a48-4a56-87e8-fa92b2d05837
