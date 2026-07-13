# 设计：pre-flight 占位符检测不再误杀标识符中的 xxx

任务：51dafd1e-7bcc-4c19-83e7-d4b162ae35ba ｜ 分支：cp-preflight-xxx-camelcase-fix

## 问题

`packages/brain/src/pre-flight-check.js:119` 的占位符正则
`/(?<![^\u0000-\u007F])xxx(?![^\u0000-\u007F])/` 只排除了 CJK 邻接字符，
未排除 ASCII 字母/数字邻接。真实标识符（`parseXxxResponse`、`_setXxx()`、
`checkXxxAvailable()`，lowercase 后 xxx 前后是 ASCII 字母）照样命中
"Description contains placeholder text"。arch_review 定时任务的 line_ledger
digest 常含此类标识符，导致 pre-flight 三振（PRE_FLIGHT_MAX_STRIKES=3）
永久 blocked——最近 8 条 arch_review 任务 5 条 pre_flight_rejected，
自动巡检管线瘫痪 2 天以上。

## 修法

正则改为叠加 lookaround（作用于 lowercase 后的 stripped 文本）：

```
/(?<![a-z0-9_])(?<![^\u0000-\u007F])xxx(?![a-z0-9_])(?![^\u0000-\u007F])/
```

语义：xxx 的邻接字符既不能是 ASCII 字母/数字/下划线（排除 camelCase 与
snake_case 标识符），也不能是非 ASCII（保留既有 CJK 排除行为，测试 D2 锁定）。
只有被空格 / ASCII 标点 / 字符串边界包围的独立 xxx 才判占位符。

拍板取舍：包含下划线（`set_xxx_flag` 不误判）。理由：误报代价（管线三振
瘫痪）远重于漏报（任务照常执行）；learnings 原文同样可能含蛇形标识符。

调研确认（Research Subagent，2026-07-12）：
- 该正则全 packages/brain 仅此一处，dispatcher/task-tasks 均通过
  `preFlightCheck()` 函数消费，无需同步改动。
- 既有 D1/D2/D3 断言逐条核对零破坏。
- 告警链路（`pre-flight-check.js:213-239`）已有 P2 单次 + P0 burst（24h≥3）
  升级到飞书，非完全静默；升级止于飞书无 Bark 属既有缺口，不在本次范围。

## 测试策略（unit 档）

追加到 `packages/brain/src/__tests__/pre-flight-check.test.js` 新 D4 段
（regression test，永久留 CI）：

不触发（本次 bug 修复）：
1. 描述含 `parseXxxResponse`（驼峰中缀，failing test 主用例）
2. 描述含 `_setXxx()` 与 `checkXxxAvailable()`
3. 描述含 `xxxHandler`（前缀驼峰）
4. 描述含 `set_xxx_flag`（snake_case，锁死下划线取舍）

仍触发（回归锁）：
5. 独立 `xxx` / `do xxx now`（空格邻接）
6. `(xxx)` 标点邻接（固化"标点不算标识符字符"取舍）

既有 D1/D2/D3 全部保持通过。

守卫说明：本 bug 是纯逻辑接缝（正则判定），CI regression test 即为对种类的
守卫，无环境接缝，不另加运行时自检。proven-to-fire：commit-1 先提交
failing test 亲眼见红。
