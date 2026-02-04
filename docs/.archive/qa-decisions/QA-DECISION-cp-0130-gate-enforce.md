# QA Decision: cp-0130-gate-enforce

Decision: MUST_ADD_RCI
Priority: P1
RepoType: Engine

## 变更范围

| 文件 | 类型 | 影响 |
|------|------|------|
| scripts/gate/generate-gate-file.sh | Shell | 新增 |
| scripts/gate/verify-gate-signature.sh | Shell | 新增 |
| hooks/branch-protect.sh | Shell | 修改：增加 gate 检查 |
| hooks/pr-gate-v2.sh | Shell | 修改：增加 gate 检查 |
| tests/gate/*.test.ts | TypeScript | 新增测试 |

## 风险分析

**高影响变更**：修改核心 Hook，影响所有开发流程。

**风险点**：
1. Hook 检查过严可能阻塞正常开发
2. 签名机制实现错误可能导致无法通过检查
3. Secret 管理不当可能导致安全问题

**缓解措施**：
1. 完整的单元测试覆盖
2. 本地测试后再部署到全局
3. Secret 文件权限限制为 600

## RCI (回归契约)

```yaml
new:
  - G1-005: gate 文件存在性检查
  - G1-006: gate 签名验证
update: []
```

## 测试决策

| 层级 | 内容 | 方法 |
|------|------|------|
| L1 | 签名生成/验证 | 自动化测试 |
| L2 | Hook 集成 | 自动化测试 |
| L3 | 完整流程 | 手动验证 |
