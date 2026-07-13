# Learning: N3 skill-relay 最小接线

### 根本原因
方向修正后(单 session skill 接力),LangGraph 图的替代接入点只需两小件:executor 早退分支 + judge CLI wrapper——对比被叫停的手写 dispatcher(T3,~2000 行),接线只花 ~300 行,验证了"复用 Claude Code 原生能力"路线的成本优势。

### 踩过的坑
- 测试 fake 与断言自相矛盾(fake judge 恒 PASS 但断言 FAIL 透传)——fake 必须如实模拟被替身函数的关键语义(透传),否则测试测的是 fake 的 bug
- smoke 里检查本机 symlink 部署状态 → CI runner 必红;冒烟只放 CI 兼容的纯检查,运维状态另查

### 下次预防
- [ ] 写 fake 前先读被替身函数的边界语义(透传/fail-open),fake 照抄
- [ ] smoke 脚本写完先问一句:这条在干净 CI runner 上成立吗
