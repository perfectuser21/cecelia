# Contract Review Feedback (Round 1)

## 判决：REVISION

共发现 4 处必须修改的问题，均属于"命令太弱/假测试"类型。

---

## 必须修改项

### 1. [完全假测试] Feature 2 ② — 模拟字符串永远 PASS，不测实际实现

**问题**：`simulatedOutput` 是手写拼接的字符串，与 tick.js 代码无任何关联。测试逻辑等价于：
```javascript
const simulatedOutput = '[12:34:56] [tick-loop] Tick failed...';
if (!/^\[\d{2}:\d{2}:\d{2}\] \[tick/.test(simulatedOutput)) { /* never fails */ }
```
即使 tick.js 里所有 error 日志仍是裸 `console.error()`，这条命令依然输出 PASS。

**影响**：Feature 2 的核心验证完全失效，任何错误实现都能通过。

**建议**：改为实际 require tick.js 并 monkey-patch console，捕获真实输出后验证格式：
```javascript
node -e "
  const messages = [];
  const origErr = console.error;
  // 读取 tick.js 源码，找所有 catch/warn/error 调用路径
  // 或者直接验证 tickWarn/tickError 函数定义并调用它
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  // 提取 tickLog/tickWarn/tickError 函数体并 eval，再调用，捕获输出
  // 验证输出符合 /^\[\d{2}:\d{2}:\d{2}\]/
"
```

---

### 2. [假测试] Feature 1 ③ — 不调用真实 tickLog，重建逻辑而非测试实现

**问题**：命令 ③ 的注释写"验证 tickLog 输出格式"，但实际上完全绕过了 tick.js：
```javascript
// 直接实例化 tickLog 逻辑并验证输出格式  ← 骗人注释
const ts = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const prefix = '[' + ts + ']';
```
这段代码是"自己写了一遍时间戳生成逻辑，验证自己写的逻辑正确"。tick.js 的 tickLog 函数有没有 bug 完全检测不到。

**影响**：tickLog 可以返回任意格式，命令 ③ 永远 PASS。

**建议**：直接 require tick.js 并捕获 console.log 输出：
```javascript
node -e "
  const logs = [];
  const orig = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); };
  // 动态 import 或用 readFileSync + Function 提取 tickLog
  // 调用 tickLog('test message')
  // 恢复 console.log，验证 logs[0] 匹配 /^\[\d{2}:\d{2}:\d{2}\] /
"
```

---

### 3. [验证盲区] _tickWrite() 直接调用无时间戳，但验证命令检测不到

**问题**：tick.js 第 72 行存在：
```javascript
_tickWrite(`[tick-summary] ${_tickLogCallCount} ticks completed`);
```
`_tickWrite` 是 `console.log` 的别名，这行日志**没有时间戳前缀**。但验证命令 ① 只检测 `console.(log|warn|error)\(` 模式，`_tickWrite(...)` 调用完全透明。

**影响**：实现者可以将所有 `console.log` 改写为 `_tickWrite()`（绕过时间戳），验证全部 PASS 但日志仍无时间戳。

**建议**：验证命令 ① 额外检查 `_tickWrite\(` 直接调用（允许在 tickLog 函数内部使用，不允许在 tickLog 函数外直接使用）：
```javascript
// 检查 tickLog 函数之外的 _tickWrite 直接调用
const lines = src.split('\n');
// 排除 tickLog 函数体内的合法调用（第一个 _tickWrite 加时间戳，合法）
// 检测函数体外或未加时间戳的 _tickWrite 调用
```

---

### 4. [死代码] Feature 2 ① — hasConsoleMissed 变量声明但从未使用

**问题**：
```javascript
const hasConsoleMissed = (src.match(/console\.(warn|error)\(/g) || []).filter(() => {
  // 排除初始化捕获行
  return true;  // ← 永远 true，filter 无效
}).length;
```
`hasConsoleMissed` 在后续逻辑中从未引用，整段是死代码。实际判断只依赖下方的 `bad.length`。

**影响**：逻辑表面上"统计了 warn/error 数量"但从未使用，给读者（和 AI）误导。代码混乱会导致未来修改时引入真正的 bug。

**建议**：删除这段死代码，或将 `hasConsoleMissed` 纳入最终的 PASS/FAIL 判断。

---

## 可选改进

- 命令 ① 对 `_tickWrite(` 的处理：建议在初始化排除模式中加入 `_tickWrite`，否则第 72 行（tickLog 内部的 summary 调用）会被错误标记为违规。
- Feature 1 ② 的 regex `/function tickLog[\s\S]*?^}/m` 依赖 `tickLog` 是普通 function 声明；若将来重构为箭头函数/const，该命令静默失败。

---

## 总结

| # | 类型 | Feature | 严重程度 |
|---|------|---------|---------|
| 1 | 完全假测试 | Feature 2 ② | P0 — 必须修改 |
| 2 | 假测试 | Feature 1 ③ | P0 — 必须修改 |
| 3 | 验证盲区 | Feature 1 ①（_tickWrite 漏检）| P1 — 必须修改 |
| 4 | 死代码 | Feature 2 ① | P1 — 必须修改 |
