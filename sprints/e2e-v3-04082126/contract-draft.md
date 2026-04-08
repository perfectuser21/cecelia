# 合同草案（第 1 轮）

## 本次实现的功能

- Feature 1: `packages/brain/src/tick.js` 中所有 `console.log` 调用输出前自动附加 `[HH:MM:SS]` 时间戳前缀（上海时区，24 小时制）

## 验收标准（DoD）

### Feature 1: tick 日志时间戳前缀

**行为描述**：
- 当 Brain tick 循环执行（`_runTick()`、`_executeTick()` 或任何 tick 相关函数）输出日志时，每行日志以 `[HH:MM:SS]` 格式的当前上海时区时间开头，后接一个空格，再接原始日志内容
- 当日志内容本身含换行符时，只在第一行前加时间戳前缀（不对子行重复添加）
- 当系统时区不是 Asia/Shanghai 时，时间戳仍以上海时区（UTC+8）输出，不受宿主机 TZ 影响
- 当非 tick.js 模块（server.js、thalamus.js 等）输出日志时，其输出格式不受任何影响

**硬阈值**：
- 时间戳格式严格匹配正则 `/^\[\d{2}:\d{2}:\d{2}\] /`（方括号 + HH:MM:SS + 方括号 + 空格）
- tick.js 中所有 `console.log(...)` 调用均必须输出带前缀的内容，数量 ≥ 现有 console.log 数量（≥ 1 处）
- 其他模块日志：调用 `server.js` 或 `thalamus.js` 中任意 `console.log`，输出不含 `[HH:MM:SS]` 前缀
- 时区：`[HH:MM:SS]` 对应北京时间（UTC+8），允许误差 ≤ 2 秒

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

## 技术实现方向（高层）

- 在 `tick.js` 文件顶部或 log helper 区域定义 `function tickLog(...args)` 工具函数，内部用 `new Date().toLocaleTimeString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false})` 获取 `HH:MM:SS`，拼接为 `[HH:MM:SS] ` 前缀后调用 `console.log`
- 将 `tick.js` 中所有现有 `console.log(...)` 替换为 `tickLog(...)`
- 不引入任何外部依赖，不修改其他模块

## 不在本次范围内

- server.js、thalamus.js 及其他非 tick 模块的日志格式变更
- 结构化日志（JSON 格式）
- 日志持久化或日志轮转
- 日志级别（info/warn/error）分类
