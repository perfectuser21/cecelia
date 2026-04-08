# 合同草案（第 1 轮）

## 本次实现的功能

- Feature A: Brain tick 日志每行前加 `[HH:MM:SS]` 时间戳前缀（本地时间，24小时制）

## 验收标准（DoD）

### Feature A: Tick 日志时间戳前缀

**行为描述**：
- 当 Brain tick 循环触发时，每条 `console.log` 输出的日志行**必须**以 `[HH:MM:SS]` 开头（如 `[14:35:07]`），再接原有日志内容
- 当连续多次 tick 时，每行时间戳独立取各自触发时刻（不复用同一时间戳）
- 当日志内容为空字符串时，仍输出 `[HH:MM:SS] `（时间戳 + 空格），不崩溃
- 当系统时区为 UTC 时，时间戳仍使用服务器本地时间（`new Date()` toLocaleTimeString 或等价方式），不强制转区

**硬阈值**：
- 格式严格为 `[HH:MM:SS]`：两位小时、两位分钟、两位秒，补零（00:00:00 ~ 23:59:59），正则 `^\[\d{2}:\d{2}:\d{2}\]` 必须匹配
- tick.js 中**所有** `console.log(` 调用，输出字符串均以该前缀开头；允许通过统一 wrapper 函数实现（即只改一处工具函数），但最终输出必须满足格式
- 不得修改 tick.js 以外的文件（仅限 `packages/brain/src/tick.js`），除非 wrapper 函数提取到已存在的工具文件
- 修改后 `node -e "require('./packages/brain/src/tick.js')"` 不报语法错误（进程启动后 0.5s 内不崩溃）
- 不引入新的 npm 依赖（使用 Node.js 内置 Date API）

**验收判断**：Evaluator 用任意方式验证以上行为是否成立

## 技术实现方向（高层）

- 在 `tick.js` 顶部或现有工具函数位置新增 `function tickLog(msg) { const t = new Date(); const pad = n => String(n).padStart(2,'0'); const ts = \`[\${pad(t.getHours())}:\${pad(t.getMinutes())}:\${pad(t.getSeconds())}]\`; console.log(\`\${ts} \${msg}\`); }` 
- 将文件内 `console.log(...)` 调用替换为 `tickLog(...)`
- 不改变日志的语义内容，只在最前面加前缀

## 不在本次范围内

- 毫秒级精度（如 `[HH:MM:SS.mmm]`）
- 日期前缀（如 `[2026-04-08 HH:MM:SS]`）
- 日志级别标签（如 `[INFO]`、`[WARN]`）
- 其他文件（非 tick.js）的日志格式改造
- 日志写入文件或外部系统
