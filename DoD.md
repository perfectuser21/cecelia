# DoD：CI外围价值审查与明确残留清理

- [x] [BEHAVIOR] 完整审查镜像、MCP、Android、内容、Ops与Scripts，结论具真实入口、消费者和限制证据。
  Test: manual:curl -sf http://localhost:5221/api/brain/health
- [x] [BEHAVIOR] Cecelia旧Android骨架及专属Gradle选择退出，ZenithJoy现役客户端不受影响。
  Test: manual:node --test scripts/ci/__tests__/basic-scope.test.mjs scripts/ci/__tests__/basic-workflow.test.mjs scripts/ci/__tests__/run-basic-check.test.mjs
- [x] [BEHAVIOR] 内容库无已知消费者的孤立路由和专属测试退出，当前跨仓内容消费者及通用调度能力保留。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [x] [BEHAVIOR] 现役来源封印、固定SHA、篡改拒绝和当前资格限制保留，Brain版本一致。
  Test: manual:node scripts/facts-check.mjs
- [ ] [BEHAVIOR] 受保护PR完整通过且真实合并，任务事实证据读回。
  Test: manual:curl -sf http://localhost:5221/api/brain/tasks/aa88987b-53a9-43ec-8753-c050db9c8c86
