## runtimesourcebootstrap：固定来源协议必须分棒自举（2026-10-15）

### 根本原因

nightly 的真实 Vitest scripts include 没有进入消费者来源选择器，导致 runner 实际有测试但改动无法归属。直接激活新选择器会让旧可信 base 无法理解新来源；重写旧 SHA 的绑定又会破坏冻结快照摘要。

### 下次预防

- [ ] 先在已归属源安装默认关闭的额外协议，再通过正式 main 与官方快照启用。
- [ ] 固定旧 Git 的 bindings 与 input_relations 逐项比较；不能只核数量。
- [ ] 区分参数默认值引用与绑定声明；用真实正例证明 AST 反例并非全部误拒。
- [ ] 工作流来源同时检查 job 条件、cwd、shell 和容错封套，不能只匹配命令文本。
