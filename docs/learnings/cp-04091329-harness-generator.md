### 根本原因

tick.js 中存在 1 处直接 `console.log` 调用（第 1650 行，auth-layer-probe 告警路径），该行未通过已有的 `tickLog` 封装函数输出，导致日志缺少 `[HH:MM:SS]` 上海时区时间戳前缀。

`tickLog` 函数已在文件顶部（第 62-73 行）定义，使用 `toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })` 格式化时间，符合合同要求。

### 下次预防

- [ ] 新增 tick.js 日志时，始终使用 `tickLog()` 而非 `console.log()`
- [ ] Code review 时对 tick.js 中的 `console.log` 调用做专项扫描
