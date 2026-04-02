# Learning: 极致精简

**日期**: 2026-04-02

### 根本原因
regression-contract.yaml 135条中 65条是 P1/P2 装饰性条目（CI 只执行 P0）。CHANGELOG.md 2456行没人读。Skills 文件体内大量冗余说明。

### 下次预防
- [ ] RCI 只写 P0 条目，P1/P2 不进文件
- [ ] Skill 文件追求精简：步骤说明越短越好
