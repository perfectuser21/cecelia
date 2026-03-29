# Learning: 修复3个P0地基缺口 — CI 虚假绿 + /context SQL Bug

**Branch**: cp-03291349-fix-ci-audit-coverage-context
**Date**: 2026-03-29

## 变更内容

1. brain-l3 job 新增 `npm audit --audit-level=high` 步骤
2. coverage-delta job 移除无条件 `continue-on-error: true`，改为 OOM 智能检测
3. `GET /api/brain/context` 移除 decisions 查询（`decisions` 表无 `title`/`category` 列）

### 根本原因

- **npm audit 缺失**：CI 配置从未包含安全扫描步骤，14个 HIGH 漏洞对 CI 不可见
- **coverage gate 失效**：`continue-on-error: true` 使覆盖率阈值失败静默通过，vitest.config.js 中定义的 75% 阈值从不执行
- **/context SQL bug**：context.js 引用了 `decisions` 表的 `title`/`category` 列，但这些列实际不存在（decisions 是系统内部日志表，列为 `id, ts, trigger, input_summary, llm_output_json, action_result_json, status`）

### 下次预防

- [ ] 改 Brain route 前先查 `\d tablename` 确认实际列名，不依赖假设
- [ ] CI workflow 变更必须加 `[CONFIG]` PR 标题标签
- [ ] 新增 coverage gate 应在本地先跑 `npm run test:coverage` 验证阈值可执行
