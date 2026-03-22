# Learning: 重构高圈复杂度函数（advanceContentPipeline CC 33→10）

**分支**: cp-03220504-40920991-9049-4eb5-9c9b-527a45
**日期**: 2026-03-22

## 任务概述

将 `content-pipeline-orchestrator.js` 中 `advanceContentPipeline` 函数从圈复杂度 33 降至 12 行（CC ≈ 2）。

## 根本原因

函数承担了多重职责：
1. DB 查询 + 前置校验（4 个分支）
2. 4 个 pipeline 阶段的状态机处理（每阶段内含独立分支）
3. content_type 配置解析

将所有职责压在单个函数中，导致 CC 线性累加（4+4+4+... = 33）。

## 解决方案

**提取私有处理器 + dispatch map 模式**：
1. `_loadContext` — 封装 DB 查询 + 4 个前置校验（CC 4）
2. `_handleResearch/Generate/Review/Export` — 各阶段独立函数（CC 1-3）
3. `ADVANCE_HANDLERS` dispatch map — 替换 4 个 if 块（消除主函数分支）
4. 主函数 `advanceContentPipeline` 压缩至 12 行（CC 2）

## 下次预防

- [ ] 函数超过 50 行时主动评估是否需要提取子函数
- [ ] "多阶段状态机" 场景优先用 dispatch map 而非 if-else 链
- [ ] 重构前先确认测试覆盖完整（本次 19 个测试全部保留）
- [ ] per-branch PRD 文件必须在 branch-protect 检查 packages/ 子目录前创建

## 陷阱

- branch-protect.sh 在 packages/ 子目录编辑时需要 `.prd-{branch}.md` 文件
- bash-guard.sh 要求 step_2 完成前必须有实际 git commit，未提交的改动不被识别
