# harness_initiative Executor 状态回写修复 设计文档

## 背景

`executor.js` 的 `harness_initiative` 处理器（第 2820 行）调用 `compiled.invoke()` 阻塞等待完整 LangGraph，但返回后从不调用 `updateTaskStatus`。所有 `harness_initiative` 任务在 LangGraph 完成后永远卡 `in_progress`，导致 tick loop 在 30 分钟超时后自动失败并重新派发，形成无限循环。

## 根因

`harness_initiative` 是唯一一种在 `triggerCeceliaRun` 内**同步**跑完整 LangGraph 的任务类型。其他类型（Docker spawn、Codex Bridge）通过回调机制更新状态；harness_initiative 没有回调，executor 返回后无人回写 DB。

## 设计

### 修复点：executor.js harness_initiative 分支

**executor 完全接管 harness_initiative 的状态回写。**

```
compiled.invoke() 返回
  ├─ final.error 为空    → updateTaskStatus(task.id, 'completed')
  ├─ final.error 存在    → updateTaskStatus(task.id, 'failed', { error_message: String(final.error).slice(0, 500) })
  └─ catch 抛出异常      → updateTaskStatus(task.id, 'failed', { error_message: err.message.slice(0, 500) })

所有路径：return { success: true, ... }
```

`success: true` 语义为"executor 已处理完毕"。dispatcher 在 `success: true` 时只做日志/事件，不做任何 status 更新，无冲突。

### dispatch-now route 不需改动

`triggerCeceliaRun` 返回 `{ success: true }` → `dispatch-now` 发 HTTP 200 → 完成。executor 内已回写 DB，无重复更新。

### 备选方案（不选）

- **方案 B（dispatch-now 判断状态）**：引入两处修改点，职责分散。
- **方案 C（updateTask 加终态守卫）**：改动 actions.js 影响所有任务类型，风险高。

## 改动文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `packages/brain/src/executor.js` | 修改 | 第 2830-2846 行，+8 行 |
| `packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js` | 新建 | 静态断言，~30 行 |

## 测试策略

**单函数行为 → unit test**（与项目现有 executor 测试模式一致）

新建 `executor-harness-initiative-status-writeback.test.js`，使用 `readFileSync` 静态断言：

```
验证点 1: executor.js 包含 updateTaskStatus(task.id, 'completed') 调用
验证点 2: executor.js 包含 updateTaskStatus(task.id, 'failed', ...) 调用（final.error 路径）
验证点 3: executor.js catch 块包含 updateTaskStatus 的 failed 调用
验证点 4: harness_initiative 成功分支返回 { success: true }（不再是 !final.error）
```

## 验收标准

- [BEHAVIOR] harness_initiative LangGraph 完成后 tasks.status = 'completed'（无 final.error 时）
  - Test: `node -e "const s=require('fs').readFileSync('packages/brain/src/executor.js','utf8'); if(!s.includes(\"updateTaskStatus(task.id, 'completed')\"))process.exit(1)"`
- [BEHAVIOR] harness_initiative LangGraph 带 final.error 时 tasks.status = 'failed'
  - Test: `node -e "const s=require('fs').readFileSync('packages/brain/src/executor.js','utf8'); if(!s.includes(\"updateTaskStatus(task.id, 'failed'\"))process.exit(1)"`
- [ARTIFACT] 新测试文件存在：`packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js`
