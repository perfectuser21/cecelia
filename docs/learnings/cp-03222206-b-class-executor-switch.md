# Learning: B类任务支持 executor 切换（Claude Code / Codex）

**分支**: cp-03222206-b-class-executor-switch
**日期**: 2026-03-22

## 变更摘要

B类任务（锁机器美国M4，不锁模型）新增 executor 动态配置能力：
- UI B类任务 DetailPanel 显示 executor 选择器（Claude Code / Codex CLI 两选项）
- executor.js 新增 2.8 分支：`location=us && dynamicExecutor=codex` → `triggerLocalCodexExec`
- `task_type_configs.executor` 字段已存在，UPSERT 写入，Brain 立即生效

## 根本原因

B类任务在 UI 层没有任何编辑能力，用户无法在不改代码的情况下为某类任务切换到 Codex CLI。这导致 Codex 本机资源（2-slot 池）只能被 spec_review / code_review_gate 使用，其他 B类任务无法利用。

## 关键设计决策

1. **不新增字段**：`task_type_configs.executor` 字段已存在（`task-type-config-cache.js` 已有 `getCachedConfig` 返回它），只需在 executor.js import 并使用。

2. **路由位置**：2.8 分支放在 2.5（review pool）之后，避免与专用 review pool 冲突。review 任务优先走 review pool，其他 B类任务才走动态 executor 分支。

3. **UI 区分**：B类用 `editableExecutor: true`（切换 executor），C类用 `editable: true`（切换机器）。两者渲染不同的编辑表单，onSave 传不同的 updates 对象。

4. **默认值**：未配置 executor 时 `getCachedConfig` 返回 null，`dynamicExecutor === 'codex'` 为 false，安全降级到 cecelia-bridge（Claude Code）。

## 下次预防

- [ ] 新增 executor 分支时，确认与已有 review pool 分支（task_type === 'spec_review' etc.）的优先级不冲突
- [ ] B类任务 UI 编辑与 C类任务 UI 编辑用不同的 flag（`editableExecutor` vs `editable`），避免混用
- [ ] `getCachedConfig` 和 `getCachedLocation` 都来自同一缓存，只需 import 一次，不需要重复查询
