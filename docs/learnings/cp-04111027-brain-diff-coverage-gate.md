---
branch: cp-04111027-brain-diff-coverage-gate
task_id: a4d5f807-e216-4d22-b3da-862bf849cdf7
date: 2026-04-11
---

# Learning: brain-unit diff coverage gate

### 根本原因

CI 门禁是静态的 — 只检查"有没有测试文件"，不检查"测试是否覆盖新增代码行"。
`execution.js` 每次新增 callback 分支都只配了 mock 单测，集成测试从没跟上，
导致 "修一修就坏" 的循环。

### 解决方案

新增 `brain-diff-coverage` CI job：
1. `vitest run --coverage`（V8 provider，输出 lcov）
2. `diff-cover coverage/lcov.info --compare-branch=origin/main --fail-under=80`

PR 新增行覆盖率 < 80% → CI fail，迫使开发者为新代码路径补测试。

### 关键设计决策

- **80% 阈值**：允许配置/日志/错误处理等辅助代码不被覆盖，但核心逻辑必须有测试
- **独立 job（非合入 brain-unit）**：brain-unit 保持快速反馈，coverage 独立并行跑
- **needs: brain-unit**：测试先过才跑 coverage，避免浪费时间
- **排除 `__tests__/**`**：测试文件自身不计入覆盖率要求
- **fetch-depth: 0**：diff-cover 需要完整 git 历史才能比较 origin/main

### 下次预防

- [ ] 每次修改 `execution.js` callback 分支时，同步确认 integration test 有覆盖
- [ ] 新增 Brain 模块时，先写测试骨架再写实现（TDD）
- [ ] CI fail 报告会列出未覆盖的具体行号，直接定位到需要补测试的位置
