# Learning: decomp 写入7层OKR新表 + KR进度闭环

**Branch**: cp-03231603-decomp-okr-seven-tables
**Date**: 2026-03-23

## 变更摘要

- Migration 178：tasks 表新增 `okr_initiative_id` FK 字段
- `okr-hierarchy.js`：新增 `POST /key-results/:id/recalculate-progress` 端点
- `tasks.js`：PATCH 状态改为 completed 时，若有 `okr_initiative_id` 自动回写 KR 进度
- `selfcheck.js` + `DEFINITION.md`：版本升至 178

### 根本原因

7层OKR表（migration 177）已建好，但 tasks 表没有连接 okr_initiatives 的字段，
且没有进度回写机制，导致 KR current_value 永远为 0，无法追踪真实进度。

### 下次预防

- [ ] 新建层级表时，同步检查下层表是否需要 FK 字段（不要分两个 PR）
- [ ] KR 进度回写放在 tasks PATCH 内部，不能依赖外部定时任务
- [ ] verify-step 自检前确保所有测试文件中的硬编码版本号也同步更新

## 设计决策

KR 进度重算选择"任务完成时实时触发"而非定时批量：
- 优点：实时性强，用户完成任务后立即看到 KR 进度变化
- 缺点：每次完成任务多一次 DB 写（可忽略）
- KR 进度公式：`current_value = completed/total × target_value`
- 失败时只 warn，不阻断主流程（KR 回写是辅助功能）
