## 原生证据来源封套兼容（2026-10-17）

### 根本原因

旧可信collector只接受完整已审的recorded/isolation/source_merge AST组合。新QA控制器虽然保留原build/publish调用，却改变了共享core、CLI与evaluate入口，旧工具正确返回三项execution_unproven。手写关系、版本名或hash不能补成执行来源；PR工具固定base，因此先行collector与后续CW候选必须按正式来源分棒。

### 本次验证边界

先以实际固定Git原件复现19例中6FAIL13PASS，再新增原子native_evidence封套与实际import/call/参数链证明；完整相关9文件378例通过。固定输入补齐原有source-merge/cifix/pr-branch/proc依赖，不跳过source_unavailable。新core模块为static dependency，只有选中evaluate才记录编译可达边；不宣称judge模型或产品验收成功。正式CI/main发布和后续候选实际来源需另验，不追认旧A7。

新增两份collector依赖也必须进入启动时冻结的实际运行身份。实际失败测试复现旧11路径遗漏后，最小扩为13路径，并将精确旧11响应仅判等待；缺失、错字节、Git blob/模式错误及加载后磁盘替换均不能冒充就绪。完整runtime 25项与Node readiness 56项回归通过。

### 下次预防

- [ ] 新共享运行封套改变时，先核已发布base的collector是否仍认识完整调用组合。
- [ ] 先保存真实UNKNOWN/FAIL与固定Git输入，再写会失败的正例及未知/混配/删调用反例。
- [ ] 已审完整AST与调用锚点成立后才做窄等价投影；不能仅凭module存在或摘要认领。
- [ ] 静态导入和实际选中消费者的可达调用分开，未选中不得附加执行关系。

- [x] 新增被加载的collector依赖时，同步现有运行身份闭包；固定Git、实际加载快照和只读就绪响应逐项核验，精确旧清单仅等待，未知清单拒绝。
