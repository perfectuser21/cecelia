# executor.js 补 strategist_decision 执行侧接线

## 背景

PR #3674（Line 军师终态接线）完成了任务创建侧：`line-strategist-dispatch.js` 在 task 落
`completed`/`failed` 后，按 `journey_id` 分组建一个 `task_type='strategist_decision'` 的任务，
`task-router.js` 的四张表（`VALID_TASK_TYPES`/`SKILL_WHITELIST`/`LOCATION_MAP`/`TASK_REQUIREMENTS`）
也正确注册了这个新类型。

但实测发现执行侧完全没接上：真正决定"该起哪个 skill、prompt 怎么拼"的是 `executor.js` 里
`getSkillForTaskType()` 函数自己维护的一张 `skillMap`（第1292行），这张表跟 `task-router.js` 的
`SKILL_WHITELIST` 是两个独立维护、互不同步的数据结构。`strategist_decision` 只填了后者，前者没填，
于是 `getSkillForTaskType('strategist_decision', ...)` 会命中 `skillMap[taskType] || '/dev'` 的
fallback，实际返回 `/dev`。同时 `preparePrompt()` 的 dispatch 表 `_TASK_ROUTES` 也没有
`strategist_decision` 这一项，会落到 `_prepareDefaultPrompt()`，该函数只会拼一段泛用 PRD 文本
（`task.title`/`task.description`/`task.task_type`），完全不包含 `task.payload.journey_id`/
`trigger`/`trigger_context`。

结果：`strategist_decision` 任务一旦被 Brain tick 派发到容器跑 headless claude，会被喂成 `/dev`
而不是 `/line-strategist`，即使某种意外让它跑对了 skill，prompt 里也读不到该看哪条 line——整条
"军师自动续接"链路在执行这一步彻底断掉。

## 目标

`strategist_decision` 任务被派发时：
1. 正确路由到 `/line-strategist`
2. prompt 里包含 `line-strategist` skill 期望的 `LINE_ID`/`TRIGGER`/`TRIGGER_CONTEXT`/`BRAIN_TASK_ID`

## 设计

### 1. skillMap 补项

`executor.js` 第1292行 `skillMap` 对象里加一行：

```js
'strategist_decision': '/line-strategist',  // Line 军师决策（PR3674 终态钩子派发）
```

### 2. 新增 prompt 构建函数

仿照已有的 `_prepareHarnessReportPrompt`（同样因为"容器内 headless claude 不展开 slash command，
裸 `/xxx` 会让 agent 收到字面量 + 零 SKILL 指令 → 空壳降级"这条已验证过的铁律，用
`loadSkillContent()` 把 SKILL.md 全文内联进 prompt）：

```js
function _prepareStrategistDecisionPrompt(task) {
  const skillContent = loadSkillContent('line-strategist');
  const payload = task.payload || {};
  const paramsBlock = `## Line 军师决策任务

LINE_ID: ${payload.journey_id || ''}
TRIGGER: ${payload.trigger || 'manual'}
TRIGGER_CONTEXT: ${JSON.stringify(payload.trigger_context || {})}
BRAIN_TASK_ID: ${task.id}
DRY_RUN: false

${task.description || task.title}`;

  return [
    '你是 line-strategist session。按下面 SKILL 指令完成一次决策。',
    '',
    skillContent,
    '',
    '---',
    '',
    paramsBlock,
  ].join('\n');
}
```

放在 `_prepareHarnessReportPrompt` 函数定义之后（同一组"Harness 系列 preparePrompt 子函数"里，
第2141行之后）。

### 3. _TASK_ROUTES 注册

`_TASK_ROUTES` 对象（第2227行起）加一行：

```js
strategist_decision:     _prepareStrategistDecisionPrompt,
```

## 非目标

- 不修 `task-router.js`（它已经注册对了，是 `executor.js` 这边漏了）
- 不改 `line-strategist` skill 本身（SKILL.md 的输入契约已经是对的，问题在派发方没按契约传参）
- 不处理"派发之后军师决策是否正确"这一层（那是 skill 自己的逻辑，本次只管"能不能正确被唤醒并拿到参数"）

## 测试策略

- **Unit test**（`packages/brain/src/__tests__/`，新文件）：
  1. `getSkillForTaskType('strategist_decision', {})` 返回 `/line-strategist`
  2. `preparePrompt()` 对 `task_type='strategist_decision'`、`payload={journey_id, trigger, trigger_context}`
     的任务，返回的 prompt 字符串里：
     - 包含 mock 过的 `line-strategist` SKILL.md 内容（mock `loadSkillContent`）
     - 包含 `LINE_ID: <journey_id 的值>`
     - 包含 `TRIGGER: <trigger 的值>`
     - 包含 `BRAIN_TASK_ID: <task.id 的值>`
  3. `trigger`/`trigger_context` 缺失时（例如 `TRIGGER=manual` 场景），有合理默认值，不抛异常

这是逻辑接缝（纯字符串拼接 + 对象查找），CI unit test 覆盖已经足够，不需要额外的运行时自检。

## 验收标准

- [ ] 新增 unit test（TDD：先写失败测试）
- [ ] `skillMap` + `_prepareStrategistDecisionPrompt` + `_TASK_ROUTES` 三处改动落地
- [ ] 全部新旧测试通过
- [ ] CI 全绿
