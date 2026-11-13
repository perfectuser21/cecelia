# DoD：落实CI旧协议与无用残留清退

- [ ] [BEHAVIOR] 默认PR不再运行已退役Runner和旧准入/历史冻结回放；兼容路径如仍保留，只由明确的定向入口消费。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [ ] [BEHAVIOR] Ops去掉已确认的静态/手抄假覆盖；当前部署、凭据隔离及WorkflowRunner真实行为回归仍有效。
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [ ] [BEHAVIOR] 删除无消费者的旧实现、专属测试及引用；现役内容跨仓消费者不断链，通用任务/PG/接入行为保留。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-integration
- [ ] [BEHAVIOR] 源码准入只接受经核实整组，拒绝混组/篡改，不用默认成功掩盖退役；事实版本一致。
  Test: manual:node scripts/facts-check.mjs
- [ ] [BEHAVIOR] PR完整CI通过且真实合并，事实证据actor与未迁出边界准确回写。
  Test: manual:curl -sf http://localhost:5221/api/brain/tasks/627ddaec-dd51-437f-97b4-dfc2dbeae02b
