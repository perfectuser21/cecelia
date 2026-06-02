# B55 — GAN Abort 传播 + initiative_runs 早建 设计文档

## 背景

Harness GAN pipeline 两个可见性/可追踪 bug：
- OPEN-5：GAN abort 不传播到 `tasks.status`（永远 in_progress）
- OPEN-6：`initiative_runs` 只在 GAN 成功后创建（失败 run 监控不可见）

实锤：25ad5930、7323dc5e、85fd1002 全部 tasks.status=in_progress，initiative_runs 无今日记录。

## 架构

修改范围：`packages/brain/src/workflows/harness-initiative.graph.js`

### OPEN-5：GAN abort 传播到 task.status

**位置**：`runGanLoopNode` catch（line ~368）  
**现状**：catch 块 `return { error: { node: 'gan', message } }`，没更新 `tasks.status`  
**修法**：在 return 前，调 Brain API PATCH `tasks/:id { status:'failed', result:{error} }`

```js
// 伪代码
} catch (err) {
  const msg = err.message || String(err);
  // ← 新增
  await fetch(`${BRAIN_URL}/api/brain/tasks/${state.task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'failed', result: { error: msg } }),
  }).catch(() => {}); // non-blocking
  return { error: { node: 'gan', message: msg } };
}
```

### OPEN-6：initiative_runs 在 prepNode 早建

**位置**：`prepNode`（pipeline 最早节点）  
**现状**：INSERT 在 `dbUpsertNode`（GAN 成功后），abort→不写  
**修法**：
1. `prepNode` 末尾：INSERT initiative_runs(phase='GAN', initiative_id, journey_type, journey_id)
2. `runGanLoopNode` catch（与 OPEN-5 同位置）：UPDATE initiative_runs SET phase='failed' WHERE initiative_id
3. `dbUpsertNode` 的现有 INSERT 改为 ON CONFLICT DO UPDATE（幂等，UPDATE phase='B_task_loop' + set contract_id）

## 数据流

```
prepNode → INSERT initiative_runs(phase='GAN')
   ↓
ganLoopNode
   ├── abort → UPDATE initiative_runs(phase='failed') + PATCH tasks(failed)  [新增]
   └── success → dbUpsertNode → ON CONFLICT UPDATE initiative_runs(phase='B_task_loop', contract_id=...)
```

## 测试策略

**类型**：Integration（mock DB + Brain API PATCH）

- OPEN-5 test：`runGanLoopNode` 遇 GAN error → PATCH tasks called with status=failed
- OPEN-6 test：`prepNode` 执行 → initiative_runs INSERT called；GAN abort → UPDATE called with phase=failed

测试文件：`packages/brain/src/workflows/__tests__/harness-initiative-abort.test.js`

## 不包含

- zombie-reaper 豁免列表修改（独立 PR）
- B_task_loop 卡死问题（OPEN-2，独立 PR）
- reviewer SKILL fix（已在 zenithjoy-skills PR）

## 成功标准

- [ ] `tasks.status` 在 GAN abort 后自动变 `failed`
- [ ] `initiative_runs` 在 prepNode 创建，GAN abort 后 phase=failed
- [ ] 两个新测试覆盖上述行为
- [ ] CI 全绿
