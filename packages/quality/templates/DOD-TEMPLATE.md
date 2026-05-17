# DoD - <功能名>

> Definition of Done - 机器可判定的完成标准
>
> 与 PRD 配合使用，确保 AI Agent 和人工验收使用一致的标准
>
> **重要**: 每条验收项必须包含 `Test:` 字段，指定对应的测试

---

## 测试层级

### 项目能力（根据项目文件自动判断）

- **项目能力上限**: L<X>

### 本次任务

- **任务类型**: <文档修改/工具函数/API接口/用户界面/性能优化/安全相关>
- **任务需要层级**: L<Y>
- **实际执行**: L1 ~ L<max(X,Y)>

### 层级定义

| 层级 | 名称 | 包含检查 |
|------|------|----------|
| L1 | 静态分析 | typecheck, lint, format, shell syntax |
| L2 | 单元测试 | unit test |
| L3 | 集成测试 | integration test, API test |
| L4 | E2E测试 | playwright, cypress |
| L5 | 性能测试 | benchmark |
| L6 | 安全测试 | audit, dependency scan |

---

## 验收标准

### 功能验收

> **格式要求**: 每条验收项后必须跟 `Test:` 字段

- [ ] 功能描述 1
  Test: tests/path/to/test.ts
- [ ] 功能描述 2
  Test: contract:<RCI_ID>
- [ ] 功能描述 3（需人工验证）
  Test: manual:<EVIDENCE_ID>

### Test 字段格式说明

| 格式 | 说明 | 示例 |
|------|------|------|
| `Test: tests/...` | 自动化测试文件路径 | `Test: tests/hooks/branch-protect.test.ts` |
| `Test: contract:<ID>` | 引用 regression-contract.yaml 中的 RCI | `Test: contract:H1-001` |
| `Test: manual:<ID>` | 手动验证，证据存放在 evidence/manual/ | `Test: manual:ui-review` |

### 必须通过

- [ ] CI 全绿（所有自动化检查通过）
  Test: contract:C2-001
- [ ] 构建成功（无编译错误）
  Test: contract:C2-001
- [ ] 测试通过（单元测试 + 集成测试）
  Test: contract:C2-001
- [ ] 代码规范（Lint + Format）
  Test: contract:C2-001
- [ ] 类型检查通过（TypeScript / 类型系统）
  Test: contract:C2-001

### 验证命令

```bash
# 一键验证（推荐）
npm run qa

# 或分步验证
npm run typecheck   # 类型检查
npm run lint        # 代码规范
npm run test        # 单元测试
npm run build       # 构建验证
```

---

## 范围限制

### 允许修改

- 本次 cp-* 分支涉及的模块/文件
- 相关的测试文件
- 必要的类型定义文件
- 相关的配置文件（如需要）

### 禁止修改

- 不相关的业务逻辑
- 其他模块的核心代码
- 全局配置（除非明确要求）
- 已弃用的代码（不要删除或重构）

### 代码质量要求

- [ ] 无 console.log（除非是正式日志）
  Test: manual:code-review
- [ ] 无注释代码（已删除）
  Test: manual:code-review
- [ ] 无未使用的 import
  Test: contract:C2-001
- [ ] 无临时文件（*New.tsx, *Old.tsx, *Backup.*）
  Test: manual:code-review
- [ ] 单文件不超过 500 行（否则拆分）
  Test: manual:code-review
- [ ] 重复代码已提取为函数/组件
  Test: manual:code-review

---

## 依赖检查

- [ ] package.json 版本已按 semver 规则更新
  Test: contract:C1-001
- [ ] 无冲突的依赖版本
  Test: contract:C2-001
- [ ] lockfile 已提交
  Test: manual:git-check

---

## Git 规范

- [ ] Commit 信息清晰
  Test: manual:git-check
- [ ] 分支命名符合规范（cp-任务名 或 feature/任务名）
  Test: contract:H1-002
- [ ] 无敏感信息（.env, credentials 等）
  Test: manual:security-review

---

## P0/P1 专项（如适用）

> 如果本次修复是 P0 或 P1 级别，必须更新回归契约

- [ ] regression-contract.yaml 已更新
  Test: contract:H2-008
- [ ] 新增 RCI 条目覆盖本次修复
  Test: manual:rci-review

---

## 备注

<!-- 补充说明、特殊情况、技术债务等 -->
