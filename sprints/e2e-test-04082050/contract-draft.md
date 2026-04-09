# Sprint Contract Draft (Round 1)

## 背景

基于 sprint-prd.md：为 Brain tick 日志加 `[TICK HH:MM:SS]` 时间戳前缀。

---

## Feature 1: tick 日志时间戳前缀

**行为描述**:

Brain 服务运行期间，每次 tick 执行时输出的日志行必须以 `[TICK HH:MM:SS]` 格式的时间戳前缀开头，其中 HH、MM、SS 均为两位数（不足补零），采用 24 小时制本地时间。非 tick 模块的其他日志不受影响，格式不变。

**硬阈值**:

1. tick 日志每行均以 `[TICK ` 开头（五个字符：方括号、T、I、C、K、空格）
2. 时间戳格式严格匹配正则 `^\[TICK \d{2}:\d{2}:\d{2}\]`（两位小时:两位分钟:两位秒）
3. 时间值合法：小时 00–23，分钟 00–59，秒 00–59
4. 非 tick 日志行（不由 tick 模块输出）不包含 `[TICK` 前缀

**Evaluator 验证方式**:

- 读取 `packages/brain/src/tick.js` 源代码，确认每个 `console.log` / 日志调用的字符串参数以 `[TICK` 开头
- 在运行时抓取输出，用正则 `^\[TICK \d{2}:\d{2}:\d{2}\]` 匹配，通过率须为 100%

---

## 合同边界

**在合同范围内**:
- `packages/brain/src/tick.js` 的所有日志输出语句加时间戳前缀

**不在合同范围内**:
- 其他模块日志格式
- 日志持久化、结构化（JSON）、日志聚合
- 告警规则

---

*生成于 Round 1，Proposer task_id: c2888de1-873c-4b0a-a121-3e8c7333ae98*
