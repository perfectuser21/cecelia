# 合同审查反馈（第 2 轮）

> reviewer_task_id: 4d41d876-80a8-4765-a472-50454c11be12  
> propose_round: 2  
> verdict: REVISION

---

## 必须修改

### 1. [阈值1 验证命令 BUG] 实现正确时仍会报错

**问题**：tickLog 函数内部本身有一个 `console.log(...)` 调用（这是实现方向里明确要求的），所以改完之后 tick.js 里不是 0 处 `console.log`，而是 **1 处**（tickLog 定义内部）。验证命令 `if(n>0)` 会在正确实现的情况下也报错，导致 CI 永远失败。

**另外**：合同写的基准是 **106** 处，实际 tick.js 当前有 **107** 处 `console.log`，基准值错误。

**修改方向**：验证逻辑应改为"直接调用 console.log 的行数 = 0，tickLog 内部的那 1 处除外"。可以用正则排除函数体内的调用，例如：

```
manual:node -e "
const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8');
// 提取 tickLog 函数定义之后的所有直接调用
const lines=src.split('\n');
let inTickLog=false, directCalls=0;
for(const l of lines){
  if(l.match(/^function tickLog|^const tickLog\s*=/)) inTickLog=true;
  else if(inTickLog && l.match(/^\}/)) inTickLog=false;
  else if(!inTickLog && l.match(/\bconsole\.log\s*\(/)) directCalls++;
}
if(directCalls>0) throw new Error('仍有 '+directCalls+' 处直接 console.log 调用')
"
```

---

### 2. [阈值2 验证命令过弱] 函数存在检查等于无效

**问题**：验证命令用 `src.match(/function\s+\w+|const\s+\w+\s*=/)` 检查 tickLog 函数是否存在，但 tick.js 里有 **336** 处 `const ...=` 语句，这个正则会立即匹配到任意一个，完全不能证明 tickLog 函数存在。即使没有实现 tickLog，验证也能通过。

**修改方向**：直接检查特定的函数名，例如：

```
manual:node -e "
const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8');
if(!src.includes('Asia/Shanghai')) throw new Error('未使用 Asia/Shanghai 时区');
if(!src.match(/function tickLog|const tickLog\s*=/)) throw new Error('未找到 tickLog 函数定义');
"
```

---

### 3. [阈值3 验证命令过弱] `src.includes('[')` 永远为 true

**问题**：验证命令首先检查 `src.includes('[')` — tick.js 有 **328** 处 `[`，这个检查永远通过，完全无意义。后半部分检查 `HH|toLocaleTimeString|padStart` 只是确认源码里出现了某个关键词，无法验证运行时实际输出格式是否符合 `/^\[\d{2}:\d{2}:\d{2}\] /`。

**修改方向**：直接用 node 执行 tickLog 函数并验证输出格式：

```
manual:node -e "
const src=require('fs').readFileSync('packages/brain/src/tick.js','utf8');
// 确认包含格式化逻辑关键词（toLocaleTimeString 或 padStart）
if(!src.match(/toLocaleTimeString|padStart/)) throw new Error('未找到时间格式化逻辑');
// 确认前缀模板包含方括号和 HH:MM:SS 结构
if(!src.match(/\\\[.*:\\\]|\[.*padStart/)) {
  // 退而求其次：确认至少有格式前缀字符串拼接
  if(!src.includes('Asia/Shanghai')) throw new Error('缺少上海时区时间格式化');
}
"
```

或者更严格地，将 tickLog 函数体提取出来后动态执行，验证其实际输出。

---

## 可选改进

- 行为描述第3条"当非 tick.js 模块...输出格式不受任何影响"：阈值4只检查了 server.js，可以考虑也检查 thalamus.js，但这是可选的。
- 技术实现方向的 `toLocaleTimeString('zh-CN', ...)` 在某些 Node.js 版本（< 13）里可能返回带 AM/PM 的格式，建议在合同备注里说明最低 Node 版本要求（或改用 padStart 方案）。

---

## 结论

3 条必改项均为验证命令逻辑错误，**不是行为描述问题**——行为描述本身已经清晰且可验证。修复验证命令后可直接进入 APPROVED。
