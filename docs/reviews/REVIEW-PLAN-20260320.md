# Review Plan — 2026-03-20

Decision: NEEDS_FIX
Priority Issues: L2 x2, SEC x1

---

## P1 任务（建议本周处理）

### Task 1：修复 Codex 任务计入本机槽位问题

```json
{
  "title": "fix[L2]: slot-allocator 排除 Codex 任务计入本机槽位",
  "description": "packages/brain/src/slot-allocator.js:174 — countAutoDispatchInProgress() 统计包含 Codex 远程任务，导致本机 Claude 派发容量虚减。修复：SQL 加 AND task_type NOT IN ('codex_qa', 'codex_dev', 'codex_playwright')，或在 calculateSlotBudget 中单独计算本地 vs 远程任务数。",
  "priority": "P1",
  "skill": "/dev",
  "repo_path": "/Users/administrator/perfect21/cecelia"
}
```

### Task 2：修复 getCodexMaxConcurrent 单机 cache 缺失时触发全阻断

```json
{
  "title": "fix[L2]: getCodexMaxConcurrent cache 缺失不触发降级导致全阻断",
  "description": "packages/brain/src/slot-allocator.js:42 — 降级条件 !m4?.online && !m1?.online 无法区分 cache 缺失与满载，单机 cache=null 时 remoteSlots=0 但不降级，返回 0 阻断所有 Codex 任务。修复：条件改为检查 m4/m1 是否为 null/undefined（cache 缺失）而非 !online（在线但可能满载）。",
  "priority": "P1",
  "skill": "/dev",
  "repo_path": "/Users/administrator/perfect21/cecelia"
}
```

### Task 3：修复 content-pipeline-executors.js 命令注入漏洞

```json
{
  "title": "fix[SEC]: content-pipeline-executors 命令注入 — notebookId/keyword 未校验",
  "description": "packages/brain/src/content-pipeline-executors.js:72-74 — notebookId 和 keyword 直接拼接到 execSync shell 字符串，可能触发命令注入。修复方案（选一）：A) 对 notebookId/keyword 做 /^[\\w\\u4e00-\\u9fff-]+$/ 白名单校验，非法字符时抛出错误；B) 改用 spawn() 传参数数组。",
  "priority": "P1",
  "skill": "/dev",
  "repo_path": "/Users/administrator/perfect21/cecelia"
}
```

---

## P2 任务（可合并处理）

### Task 4：content-pipeline-executors + executor 路由分支 补测试

```json
{
  "title": "test[L3]: 补充 content-pipeline-executors 单元测试 + executor 路由集成测试",
  "description": "1) packages/brain/src/content-pipeline-executors.js 为全新功能无测试，补充 executeResearch/executeGenerate/executeExport 单元测试；2) executor.js:triggerCeceliaRun 路由分支（dev→Claude, others→Codex, hk→MiniMax）无测试，添加集成测试断言路由决策，防止 #1192→#1195→#1198 三连修复重演。",
  "priority": "P2",
  "skill": "/dev",
  "repo_path": "/Users/administrator/perfect21/cecelia"
}
```
