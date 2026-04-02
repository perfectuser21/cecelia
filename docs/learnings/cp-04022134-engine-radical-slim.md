# Learning: 激进精简

**日期**: 2026-04-02

### 根本原因
18个 devgate 脚本中只有 7 个被 CI/Hook 调用，其余 11 个完全无人调用。01-spec.md/02-code.md 体内 79+74 处旧架构引用。

### 下次预防
- [ ] 新增 devgate 脚本时必须同时在 CI workflow 中调用，否则不创建
