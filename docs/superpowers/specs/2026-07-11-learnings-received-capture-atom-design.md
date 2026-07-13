# learnings-received 路由补 pushCaptureAtom（九要素 T12）

## 背景

T10（统一收件箱）只给 `learning.js` 的 `recordLearning()`（RCA 自动触发路径）接了 `pushCaptureAtom`。
但今天所有 /dev 任务收尾产生的 learning 实际都走 `POST /api/brain/learnings-received`
（`fire-learnings-event.sh` 触发，dev workflow 标准出口，`routes/tasks.js`）写库，这条路径完全没接。
结果 `capture_atoms` 表漏收今天几百条真实 learning。

## 修法

在 `packages/brain/src/routes/tasks.js` 的 `/learnings-received` 路由里，`next_steps_suggested`
批量插入 `learnings` 表成功后，对每条新插入的记录调用：

```js
await pushCaptureAtom(pool, {
  content: `learning: ${title}\n${summary}`,
  targetType: 'learning',
  targetSubtype: learning_type || 'dev_experience',
  routedToTable: 'learnings',
  routedToId: learning.id,
});
```

复用 `capture-inbox.js` 现成函数，与 `learning.js:121-127` 的 `recordLearning()` 路径模式一致。
写入失败非阻塞（`pushCaptureAtom` 内部已吞错）。

## 测试策略

- **Regression test**：真实挂载 `routes/tasks.js` 的 router（非既有测试文件里的内联复制逻辑），
  mock `pushCaptureAtom`（工厂 mock，与 `handoff.test.js` 手法一致），断言插入 learning 后
  `pushCaptureAtom` 被调用且 `routedToId` 匹配新插入的 learning id。
- 先写 failing test 证明当前路由未调用，再实现修复使其转绿。

## 验收标准

- [BEHAVIOR] tests/ `packages/brain/src/__tests__/learnings-received.test.js` 新增用例通过
