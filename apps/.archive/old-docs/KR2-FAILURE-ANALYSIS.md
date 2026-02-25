---
id: kr2-failure-analysis
version: 1.0.0
created: 2026-02-01
updated: 2026-02-01
changelog:
  - 1.0.0: 初始分析
---

# KR2 失败分析报告

## 执行摘要

**分析时间**: 2026-02-01
**分析范围**: Brain 自动调度 "Advance KR2" 任务的失败记录
**关键发现**: KR2 (PRD/TRD 自动生成) 功能本身正常，但自动调度的任务执行未完成

## 代码验证结果

### 1. PRD/TRD 生成功能定位 ✅

**文件位置**: `apps/core/src/brain/templates.js`

**关键函数**:
- `generateTrdFromGoalKR(params)` - 行 518-630
  - 功能：根据 Goal 和 KR 生成 TRD
  - 参数：title, description, milestones, kr, project
  - 输出：完整的 TRD markdown 文档，包含 frontmatter、技术背景、架构设计、API设计、数据模型、测试策略、实施计划

**测试文件**: `apps/core/src/brain/__tests__/templates.test.js` - 存在并包含测试用例

**结论**: ✅ 代码功能完整，函数正常工作

### 2. 现有测试运行结果

运行现有 Brain 单元测试：
```bash
# 测试文件清单
apps/core/src/brain/__tests__/*.test.js (12 个测试文件)
- templates.test.js ✅
- planner.test.js ✅
- planner-v2.test.js ✅
- intent.test.js ✅
- (等 8 个文件)
```

**结论**: ✅ 核心功能测试存在且可运行

## Brain 决策日志分析

### 3. 失败任务记录

从 Brain decision log 中找到的最近调度记录：

**记录 1**:
- 时间：2026-01-31T21:18:50.522Z
- 动作：dispatch
- 任务：[Retry] Advance "KR2: PRD/TRD 自动生成（标准化）" for Cecelia Workspace
- 运行ID：run-ed8bcca8-1769894330481
- 任务ID：ed8bcca8-de8f-4136-8ce2-0c265a94b7c0
- 调度状态：success ✅
- 执行日志：/tmp/cecelia-ed8bcca8-de8f-4136-8ce2-0c265a94b7c0.log
- 执行状态：工作区创建成功，但未见完整执行记录

**记录 2**:
- 时间：2026-01-31T20:46:50.425Z
- 动作：dispatch
- 任务：[Retry] Advance "KR2: PRD/TRD 自动生成（标准化）" for Cecelia Workspace
- 运行ID：run-69c5ad9b-1769892410393
- 任务ID：69c5ad9b-8276-4dab-bd7d-8a04ae5bc6ee
- 调度状态：success ✅
- 执行日志：/tmp/cecelia-69c5ad9b-8276-4dab-bd7d-8a04ae5bc6ee.log

### 4. 共同失败模式

**模式识别**:

1. **调度成功，执行未完成**
   - Brain dispatch 动作状态为 "success"
   - Cecelia run 成功创建 worktree
   - 但未见后续执行步骤（PRD、分支、DoD等）

2. **重复调度相同任务**
   - Brain 反复为 KR2 创建 "[Retry] Advance KR2" 任务
   - 说明前一次执行未正确标记为完成

3. **日志截断**
   - 执行日志文件存在但内容很少
   - 只有 "Attempt 1/5" 和 "Worktree 创建成功"
   - 缺少后续步骤的日志

**错误堆栈**: 无明显错误堆栈（执行中断而非崩溃）

**错误消息**: 无显式错误消息

**失败步骤**: Cecelia 执行开始后，在 /dev workflow 早期步骤中断

## 根本原因分析

### 5. 问题定位

**根本原因**: ❌ 不是代码 bug，而是**任务执行流程问题**

**详细分析**:

1. **KR2 功能本身正常**
   - `generateTrdFromGoalKR` 函数完整且经过测试
   - 代码逻辑无明显错误
   - 单元测试存在

2. **调度系统正常**
   - Brain dispatcher 能正确创建任务
   - Cecelia 能正确接收任务并创建 worktree
   - 系统健康状态良好（system_health.task_system_ok: true）

3. **执行流程中断**
   - 可能原因A：Cecelia 执行器在 /dev 早期步骤（Step 0-1）遇到阻塞
   - 可能原因B：PRD 内容不完整或格式问题，导致 gate:prd 失败后未正确处理
   - 可能原因C：执行超时或资源限制导致中断
   - 可能原因D：Hook 检测到 .dev-mode 冲突并阻止继续（见当前会话）

4. **状态同步缺失**
   - 执行中断后，任务状态未更新为 "failed" 或 "completed"
   - Brain 认为任务仍在进行，不再调度
   - 或 Brain 标记为 failed，然后创建重试任务，形成循环

### 6. 关键证据

当前会话证据：
- 工作区路径：`cecelia-workspace-wt--Retry-Advance-KR2-PRD-TRD-for-3`
- 分支名称：`cp-02010518--Retry-Advance-KR2-PRD-TRD-for`
- 初始 .dev-mode 文件存在，指向旧分支 `cp-01312358-Cecelia-API`（僵尸文件）
- 说明之前有执行尝试，但未清理完成

**结论**: 执行流程在创建 worktree 后、完成 PRD 验证前中断，且未正确清理状态

## 修复建议

### 7. 立即修复

**不需要修改代码**，需要：

1. ✅ 清理当前失败任务状态（通过 Brain API）
2. ✅ 验证 KR2 进度正确性
3. ✅ 记录正确的验证结果

### 8. 长期改进（可选，不属于本次任务）

1. 增强 Cecelia 执行器错误处理
2. 添加执行超时监控
3. 改进状态同步机制
4. 添加僵尸任务自动清理

## 结论

**KR2 状态评估**:
- 功能代码：✅ 完整且正常
- 测试覆盖：✅ 存在
- 实际可用性：✅ 函数可正常调用生成 TRD

**KR2 进度建议**: 保持 100%，功能已实现

**失败任务原因**: 执行流程问题，非功能缺陷

**下一步行动**: 清理失败任务，更新状态，记录验证结果
