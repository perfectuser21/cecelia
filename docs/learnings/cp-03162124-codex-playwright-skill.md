# Learning: codex_playwright 任务类型注册

**分支**: cp-03162124-codex-playwright-skill
**日期**: 2026-03-16

---

### 根本原因

新增一个走西安 M4 的 Codex task_type，需要同时改动 5 个 Brain 文件 + 2 个新建文件 + DEFINITION.md + brain-manifest，缺一不可。

### 关键决策

1. **为什么用 playwright-runner.sh 而不是复用 runner.sh + --skill playwright**：
   - Playwright 工作流（探索 → 保存脚本）与 /dev 工作流（PRD → PR → CI → 合并）完全不同
   - 独立 runner 职责清晰，prompt 专门为 Playwright 探索优化

2. **为什么 SKILL.md 放 packages/workflows/skills/playwright-auto/**：
   - 与现有所有 skill（code-review、dev 等）保持一致的目录结构
   - 给未来其他 playwright 脚本提供参考

3. **两阶段设计（本期只做 Phase 1）**：
   - Phase 2（直接运行 .cjs）由 Brain 派发普通 shell task 完成，不需要额外 task_type

### 下次预防

- [ ] 新增 Brain task_type 必须同时改 5 个文件：task-router + model-registry + token-budget-planner + slot-allocator + pre-flight-check
- [ ] 改 Brain 代码后必须立即运行 `node packages/brain/scripts/generate-manifest.mjs`
- [ ] 改 task-router.js 的 LOCATION_MAP 后必须同步更新 DEFINITION.md 的任务类型表
- [ ] `packages/workflows/` 下开发时 PRD+DoD 需放两处：worktree 根目录 + `packages/workflows/`
