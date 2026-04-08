# Sprint 合同（已批准 — Round 2）

> propose_round: 2
> propose_task_id: 4985875a-f4ec-4a82-93a3-315bba34e63b
> review_task_id: 4d41d876-80a8-4765-a472-50454c11be12
> verdict: APPROVED

---

## 本次实现的功能

- Feature 1: `packages/brain/src/tick.js` 中所有 `console.log` 调用替换为带 `[HH:MM:SS]` 时间戳前缀的封装函数（上海时区，24 小时制）

---

## 验收标准（DoD）

### Feature 1: tick 日志时间戳前缀

**行为描述**：

- 当 Brain tick 循环执行（`_runTick()`、`_executeTick()` 或任何 tick 相关函数）输出日志时，每行日志以 `[HH:MM:SS]` 格式的当前上海时区时间开头，后接一个空格，再接原始日志内容
- 当系统时区不是 Asia/Shanghai 时，时间戳仍以上海时区（UTC+8）输出，不受宿主机 TZ 影响
- 当非 tick.js 模块（server.js、thalamus.js 等）输出日志时，其输出格式不受任何影响

---

**硬阈值**：

#### 阈值 1 — 原始 console.log 全部消除

tick.js 中所有 `console.log(...)` 调用均必须已替换，改后文件中不应再存在直接的 `console.log` 调用。

验证命令：
```
manual:node -e "const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); const n=(src.match(/\bconsole\.log\b/g)||[]).length; if(n>0){throw new Error('仍有未替换的 console.log: '+n+' 处')}"
```

#### 阈值 2 — tickLog 函数定义存在且使用上海时区

tick.js 中必须定义一个封装函数（无论命名为 `tickLog` 还是其他），函数内使用 `Asia/Shanghai` 时区格式化时间。

验证命令：
```
manual:node -e "const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); if(!src.includes('Asia/Shanghai')){throw new Error('tick.js 未使用 Asia/Shanghai 时区')} if(!src.match(/function\s+\w+|const\s+\w+\s*=/)){throw new Error('未找到 log 封装函数定义')}"
```

#### 阈值 3 — 时间戳格式正则匹配

封装函数内必须生成符合 `/^\[\d{2}:\d{2}:\d{2}\] /` 格式的前缀。

验证命令：
```
manual:node -e "const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); if(!src.includes('[') || !src.match(/HH|toLocaleTimeString|padStart/)){throw new Error('tick.js 中未找到时间格式化逻辑')}"
```

#### 阈值 4 — 非 tick 模块不受影响

`server.js` 中不应调用 tick 专属的日志封装函数。

验证命令：
```
manual:node -e "const src=require('fs').readFileSync('packages/brain/src/server.js','utf8'); if(src.includes('tickLog(')){throw new Error('server.js 不应调用 tickLog')}"
```

---

## 不在本次范围内

- server.js、thalamus.js 及其他非 tick 模块的日志格式变更
- 结构化日志（JSON 格式）
- 日志持久化或日志轮转
- 日志级别分类
- 多行日志的特殊处理
- 启动完整 Brain 服务进行验证
