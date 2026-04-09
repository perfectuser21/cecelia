# 合同草案（第 2 轮）

> Generator: sprint-contract-proposer  
> Propose Round: 2  
> Planner Task: 6b4b5bd2-f44d-4876-b036-a5b5b110a5fc  
> 生成时间: 2026-04-08  
> 修订依据: R1 Evaluator 反馈（3 个阻塞问题）

---

## 修订说明

针对 R1 Evaluator 的 3 个阻塞问题修订：
1. **命令太弱（已修复）**：R1 所有 BEHAVIOR 命令均为静态文件扫描。本轮新增 2 条 vm 沙盒真实执行命令（命令 2/3）。
2. **缺失边界测试（已修复）**：命令 3 新增 99 次调用不触发 summary 的负向测试。
3. **第一条命令逻辑 bug（已修复）**：命令 1 改为直接正则匹配计数器变量，去掉嵌套短路逻辑。

---

## 用户需求

> 给 Brain tick.js 的 tickLog 函数加一个调用计数器，每 100 次 tick 打印一条汇总日志（如 [tick-summary] 100 ticks completed）。

---

## 本次实现的功能

- **Feature A**: 在 `tick.js` 中添加模块级调用计数器，`tickLog` 每调用 100 次时额外输出 `[tick-summary] N ticks completed`。

---

## 验收标准（DoD）

### Feature A: tickLog 调用计数器

**行为描述**：`tickLog` 被调用时，内部维护一个模块级整型计数器（初始 0），每次调用 +1；当计数器达到 100 的倍数时（即 100, 200, 300...），额外输出一行 `[tick-summary] <N> ticks completed`，其中 N 为当前累计调用次数。

**硬阈值**：
- 计数器变量为模块级（`tickLog` 函数外声明），不随调用重置
- 每整 100 次有且仅有一行 summary 输出
- 原有 `tickLog` 的 `[HH:MM:SS]` 时间戳前缀行为不变

**验证命令**：

#### 命令 1（ARTIFACT — 计数器变量声明存在）

```
manual:node -e "const code=require('fs').readFileSync('packages/brain/src/tick.js','utf8'); const m=code.match(/^let\s+\w*[Tt]ick\w*[Cc]ount\w*\s*=\s*0/m); if(!m) throw new Error('FAIL: 未找到模块级计数器变量（let tickXxxCount = 0）'); console.log('PASS: 计数器变量存在 =>', m[0]);"
```

#### 命令 2（BEHAVIOR — 动态执行：100 次调用触发且仅触发 1 条 summary）

```
manual:node -e "const vm=require('vm'),fs=require('fs');const src=fs.readFileSync('packages/brain/src/tick.js','utf8');const cLine=src.match(/^let\s+\w*[Tt]ick\w*[Cc]ount\w*\s*=\s*0.*/m);if(!cLine)throw new Error('FAIL: 未找到计数器变量');const fnStart=src.indexOf('function tickLog(');if(fnStart<0)throw new Error('FAIL: 未找到tickLog');let depth=0,i=src.indexOf('{',fnStart);do{depth+=src[i]==='{'?1:src[i]==='}'?-1:0;i++;}while(depth>0);const fnCode=src.slice(fnStart,i);const captured=[];const patched=cLine[0]+'\n'+fnCode.replace(/_tickWrite\b/g,'__w');const ctx=vm.createContext({__w:(...a)=>captured.push(a.join(' ')),Date});vm.runInContext(patched,ctx);for(let j=0;j<100;j++)vm.runInContext('tickLog(\"x\")',ctx);const s=captured.filter(x=>x.includes('tick-summary'));if(!s.length)throw new Error('FAIL: 100次调用后无tick-summary输出');if(s.length>1)throw new Error('FAIL: 100次调用触发了'+s.length+'条summary（期望1条）');if(!/100/.test(s[0]))throw new Error('FAIL: summary不含100 => '+s[0]);console.log('PASS: 100次调用=>1条summary:',s[0]);"
```

#### 命令 3（BEHAVIOR — 边界测试：99 次调用不触发 summary）

```
manual:node -e "const vm=require('vm'),fs=require('fs');const src=fs.readFileSync('packages/brain/src/tick.js','utf8');const cLine=src.match(/^let\s+\w*[Tt]ick\w*[Cc]ount\w*\s*=\s*0.*/m);if(!cLine)throw new Error('FAIL: 未找到计数器变量');const fnStart=src.indexOf('function tickLog(');let depth=0,i=src.indexOf('{',fnStart);do{depth+=src[i]==='{'?1:src[i]==='}'?-1:0;i++;}while(depth>0);const fnCode=src.slice(fnStart,i);const captured=[];const patched=cLine[0]+'\n'+fnCode.replace(/_tickWrite\b/g,'__w');const ctx=vm.createContext({__w:(...a)=>captured.push(a.join(' ')),Date});vm.runInContext(patched,ctx);for(let j=0;j<99;j++)vm.runInContext('tickLog(\"x\")',ctx);const s=captured.filter(x=>x.includes('tick-summary'));if(s.length>0)throw new Error('FAIL: 99次就触发了summary（期望第100次才触发）: '+s[0]);console.log('PASS: 99次调用无summary（不提前触发）');"
```

#### 命令 4（BEHAVIOR — 严格模 100 条件，非弱条件）

```
manual:node -e "const code=require('fs').readFileSync('packages/brain/src/tick.js','utf8');const fnStart=code.indexOf('function tickLog(');let depth=0,i=code.indexOf('{',fnStart);do{depth+=code[i]==='{'?1:code[i]==='}'?-1:0;i++;}while(depth>0);const fn=code.slice(fnStart,i);if(!/%\s*100\s*===\s*0/.test(fn))throw new Error('FAIL: tickLog函数内未找到严格模100条件（% 100 === 0）');if(/>=\s*100/.test(fn))throw new Error('FAIL: 发现弱条件 >= 100，会导致超100次后每次都触发');console.log('PASS: 触发条件为严格 % 100 === 0');"
```

#### 命令 5（BEHAVIOR — 原有时间戳逻辑未被破坏）

```
manual:node -e "const code=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!code.includes('Asia/Shanghai'))throw new Error('FAIL: Asia/Shanghai 时区设置被删除');if(!code.includes('toLocaleTimeString'))throw new Error('FAIL: 时间戳格式化逻辑被删除');console.log('PASS: 原有时间戳逻辑完整保留');"
```

---

## 技术实现方向（高层）

在 `tick.js` 的 `tickLog` 函数上方添加模块级计数器：

```js
// tickLog call counter for periodic summary
let _tickLogCallCount = 0;

function tickLog(...args) {
  const ts = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  _tickWrite(`[${ts}]`, ...args);
  _tickLogCallCount++;
  if (_tickLogCallCount % 100 === 0) {
    _tickWrite(`[tick-summary] ${_tickLogCallCount} ticks completed`);
  }
}
```

---

## 不在本次范围内

- 计数器持久化到 DB（纯内存，进程重启归零）
- 暴露计数器值到 API 端点
- 修改 TICK_INTERVAL_MINUTES 或其他 tick 配置
- 测试框架变更
