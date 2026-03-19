# Learning: Tick 不派发任务 — Bridge CJS/ESM 不兼容

## 分支
`cp-03191906-fix-tick-dispatch`

### 根本原因

cecelia-bridge.js 使用 CommonJS (`require()`)，但 package.json 设置了 `"type": "module"`。Node.js 25 拒绝执行，bridge 启动后立刻退出。没有 bridge，executor 的 `checkCeceliaRunAvailable()` 永远返回 false，所有任务都无法派发。

表现：tick 日志只有 goal 评估，没有 dispatch 日志。dispatch_allowed=true 但 reason=no_executor。

### 下次预防

- [ ] 新增脚本时检查 package.json 的 type 字段，确保语法一致
- [ ] bridge 启动失败应该有更醒目的告警（目前只有一行 warn 日志，容易被淹没）
