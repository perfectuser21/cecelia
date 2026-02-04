# QA Decision: Gate 安全机制修复

## 变更类型

- [x] 安全修复
- [x] 代码逻辑变更
- [ ] 文档变更

## 测试决策

| 测试类型 | 需要 | 原因 |
|---------|------|------|
| 单元测试 | ✅ | Gate 文件生成/验证逻辑需要测试 |
| 集成测试 | ❌ | 无 API 变更 |
| 手动验证 | ✅ | 需要验证 Hook 行为 |

## Decision: MUST_TEST

理由：安全相关的核心逻辑变更，必须有测试覆盖。

## Tests

| DoD 项 | 方法 | 位置 |
|--------|------|------|
| Gate 文件过期检测 | auto | tests/gate-signature.test.ts |
| HEAD 绑定验证 | auto | tests/gate-signature.test.ts |
| 验证器缺失软警告 | manual | 手动测试 Hook 行为 |
| Stop Hook 自动 cleanup | manual | 手动测试 PR 合并后行为 |

## RCI

- new: []
- update: []

理由：这是 Hook 层的安全修复，不涉及业务入口。
