# QA Decision

Decision: MUST_ADD_RCI
Priority: P1
RepoType: Engine

## Tests

- dod_item: "DevGate Glob Regex 修复"
  method: auto
  location: tests/devgate/scan-rci-coverage.test.ts

- dod_item: "Shell 转义加强"
  method: auto
  location: tests/devgate/snapshot-prd-dod.test.ts

- dod_item: "Nightly Workflow 重构"
  method: auto
  location: tests/workflows/nightly.test.ts

- dod_item: "超时配置添加"
  method: auto
  location: tests/workflows/ci-timeout.test.ts

## RCI

new:
  - W1-003  # DevGate glob regex 正确处理递归通配符
  - W2-003  # Shell 转义防止命令注入
  - C1-002  # Nightly workflow 使用 artifact 不被分支保护阻止

update:
  - C1-001  # CI 超时配置完整性检查（添加 impact-check 超时验证）

## Reason

P1 级别的 CI 基础设施修复，涉及 DevGate 脚本安全性、Nightly workflow 可靠性和 CI 超时防护，必须纳入回归契约确保不再回退。

## Analysis

**RepoType: Engine**

根据仓库结构判断：
- ✅ 包含 `regression-contract.yaml`
- ✅ 包含 `hooks/` 和 `skills/` 目录
- ✅ 包含 workflow/gate 相关文件
→ RepoType = Engine

**Priority: P1**

根据严重性映射规则：
- 问题严重性：HIGH (影响 CI 可靠性和安全性)
- 业务优先级：P1 (高优先级，尽快处理)

**Decision: MUST_ADD_RCI**

符合 RCI 判定标准：
1. **Must-never-break**: 这些问题修复后不能回退
   - DevGate glob regex 错误会导致覆盖率检查失效
   - Shell 转义缺失存在安全风险
   - Nightly workflow 失败影响持续集成
   - 缺少超时可能导致 CI 挂死

2. **Verifiable**: 可以通过自动化测试验证
   - Glob regex: 单元测试验证 `**` 递归匹配
   - Shell 转义: 测试特殊字符注入场景
   - Nightly workflow: 验证 artifact 上传成功
   - 超时配置: 检查所有关键 jobs 有超时

3. **Stable Surface**: 涉及稳定的 CI 基础设施
   - DevGate 脚本是质量门禁核心
   - Shell 转义是安全基线
   - Nightly workflow 是回归测试基础
   - CI 超时是资源保护机制

**RCI ID 建议**:

- **W1-003**: DevGate Scripts - glob regex 递归通配符
  - 位置: `scripts/devgate/scan-rci-coverage.cjs`
  - 验证: 测试 `src/**/*.ts` 正确匹配多层目录
  - Priority: P1, Trigger: [PR, Release]

- **W2-003**: DevGate Scripts - shell 转义完整性
  - 位置: `scripts/devgate/snapshot-prd-dod.sh`
  - 验证: 测试 backtick 和 `$()` 不会执行命令
  - Priority: P1, Trigger: [PR, Release]

- **C1-002**: CI Workflow - Nightly artifact 上传
  - 位置: `.github/workflows/nightly.yml`
  - 验证: workflow 成功完成，不被分支保护阻止
  - Priority: P1, Trigger: [Release]

- **UPDATE C1-001**: CI Workflow - 超时配置完整性
  - 添加 impact-check 超时验证（现已有 timeout-minutes: 5）
  - 确保所有关键 jobs 有合理超时
  - Priority: P0, Trigger: [PR, Release]

**测试覆盖策略**:

- **Unit Tests**: 每个修复点都有对应单元测试
  - DevGate regex: 测试各种 glob 模式
  - Shell 转义: 测试注入向量
  - Workflow: YAML 语法和逻辑验证

- **Regression Tests**: 纳入 PR 和 Release 回归
  - W1-003, W2-003 在 PR 时触发（快速反馈）
  - C1-002 在 Release 时触发（完整验证）
  - C1-001 在 PR 时触发（关键路径）

- **E2E Tests**: 不需要独立 E2E
  - 这些修复是基础设施层面
  - 通过 CI 自身运行验证即可

**Next Actions**:

1. 创建测试文件覆盖所有 DoD 条目
2. 更新 `regression-contract.yaml` 添加 W1-003, W2-003, C1-002
3. 更新 C1-001 添加 impact-check 超时验证
4. 修复代码实现
5. 验证 CI 全绿
