# 合同草案（第 2 轮）

> propose_round: 2  
> task_id: 4985875a-f4ec-4a82-93a3-315bba34e63b  
> 修订说明：根据第1轮 Evaluator 反馈（4条必改项）全部修订

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

> 注：第1轮合同中"多行日志只在第一行加前缀"条款超出 PRD 范围，本轮删除，不作为验收要求。

---

**硬阈值**：

#### 阈值 1 — 原始 console.log 全部消除

tick.js 中所有 `console.log(...)` 调用均必须已替换，改后文件中不应再存在直接的 `console.log` 调用。

**基准**：改前 tick.js 共有 **106** 处 `console.log`，全部替换后该数为 0。

验证命令：
```
manual:node -e "const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); const n=(src.match(/\bconsole\.log\b/g)||[]).length; if(n>0){throw new Error('仍有未替换的 console.log: '+n+' 处')}"
```

---

#### 阈值 2 — tickLog 函数定义存在且使用上海时区

tick.js 中必须定义一个封装函数（无论命名为 `tickLog` 还是其他），函数内使用 `Asia/Shanghai` 时区格式化时间。

验证命令：
```
manual:node -e "const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); if(!src.includes('Asia/Shanghai')){throw new Error('tick.js 未使用 Asia/Shanghai 时区')} if(!src.match(/function\s+\w+|const\s+\w+\s*=/)){throw new Error('未找到 log 封装函数定义')}"
```

---

#### 阈值 3 — 时间戳格式正则匹配

封装函数内必须生成符合 `/^\[\d{2}:\d{2}:\d{2}\] /` 格式的前缀（方括号 + HH:MM:SS + 方括号 + 空格）。

验证命令：
```
manual:node -e "const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); if(!src.includes('[') || !src.match(/HH|toLocaleTimeString|padStart/)){throw new Error('tick.js 中未找到时间格式化逻辑')}"
```

---

#### 阈值 4 — 非 tick 模块不受影响

`server.js` 中不应调用 tick 专属的日志封装函数。

验证命令：
```
manual:node -e "const src=require('fs').readFileSync('packages/brain/src/server.js','utf8'); if(src.includes('tickLog(')){throw new Error('server.js 不应调用 tickLog')}"
```

---

## 技术实现方向（高层）

- 在 `tick.js` 文件顶部定义 `function tickLog(...args)` 工具函数，内部用 `new Date().toLocaleTimeString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false})` 获取 `HH:MM:SS`，拼接 `[HH:MM:SS] ` 前缀后调用 `console.log`
- 将 tick.js 中所有 106 处现有 `console.log(...)` 替换为 `tickLog(...)`
- 不引入任何外部依赖，不修改其他模块
- 所有验证命令在 CI 环境（无 PostgreSQL、无 5221 端口）下可执行

## 不在本次范围内

- server.js、thalamus.js 及其他非 tick 模块的日志格式变更
- 结构化日志（JSON 格式）
- 日志持久化或日志轮转
- 日志级别（info/warn/error）分类
- 多行日志的特殊处理（不要求，已从本轮合同删除）
- 启动完整 Brain 服务进行验证（所有验证命令均为静态文件检查）
