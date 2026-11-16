- [ ] Checker失败明细回传原Agent会话；错误协议、线程丢失和未知副作用拒绝自动返工。
  Test: manual:npm exec -w packages/brain -- vitest run src/orchestrator/__tests__/checker-feedback.test.js
- [ ] 冻结策略限定初次加两次修复，共享期限，耗尽将失败历史交Commander，下游不消费未验收输出。
  Test: manual:npm exec -w packages/brain -- vitest run src/durable/__tests__/commander-repair.test.js
- [ ] 恢复复用各轮动作账；不同轮不冲突，未确认执行不得重放。
  Test: manual:npm exec -w packages/brain -- vitest run src/durable/__tests__/commander-repair.test.js
