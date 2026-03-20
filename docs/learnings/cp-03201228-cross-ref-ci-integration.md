# Learning: cross-ref-registry 检查器实现

### 根本原因
跨文件引用（如 .dev-mode 字段名）在多个文件中定义，改了一处其他不跟着改，
缺少自动检测机制。PR #1167 的步骤命名不一致问题就是典型案例。

### 下次预防
- [ ] 新增 SSOT→消费者关系时，同步更新 cross-ref-registry.yaml
- [ ] CI L2 会自动检测跨文件引用不一致
