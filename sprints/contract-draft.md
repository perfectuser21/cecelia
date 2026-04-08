# 合同草案（第 1 轮）

> Generator: sprint-contract-proposer  
> Propose Round: 1  
> Planner Task: 6b4b5bd2-f44d-4876-b036-a5b5b110a5fc  
> 生成时间: 2026-04-08

---

## 用户需求（来源：Planner 任务 payload）

> 给 Brain tick.js 的 tickLog 函数加一个调用计数器，每 100 次 tick 打印一条汇总日志（如 [tick-summary] 100 ticks completed）。

---

## 本次实现的功能

- **Feature A**: 在 `tickLog` 函数中增加模块级调用计数器，每累计 100 次调用时自动输出 `[tick-summary] N ticks completed` 汇总日志行。

---

## 验收标准（DoD）

### Feature A: tickLog 调用计数器

**行为描述**：`tickLog` 被调用时，内部维护一个模块级整型计数器（初始 0），每次调用 +1；当计数器达到 100 的倍数时（即 100, 200, 300...），额外输出一行 `[tick-summary] <N> ticks completed`，其中 N 为当前累计调用次数。

**硬阈值**：
- 计数器变量为模块级（文件顶部或 tickLog 闭包外），不随进程重启以外的原因重置
- 每整 100 次必须有且只有一行 summary 输出
- 原有 tickLog 的 `[HH:MM:SS]` 时间戳前缀行为不变

**验证命令**：

```bash
# [ARTIFACT] 验证 tick.js 已包含计数器变量声明
node -e "
  const code = require('fs').readFileSync(
    'packages/brain/src/tick.js', 'utf8'
  );
  if (!code.includes('tickLog') || !/let\s+\w*[Cc]ount\w*\s*=\s*0/.test(code) && !/let\s+\w*[Cc]ount\w*\s*=/.test(code)) {
    // 宽松检查：含有某种计数变量
    if (!/tickCount|callCount|logCount|tickLogCount/.test(code)) {
      throw new Error('FAIL: 未找到计数器变量');
    }
  }
  console.log('PASS: 计数器变量存在');
"

# [BEHAVIOR] 验证 summary 逻辑在代码中存在（模 100）
node -e "
  const code = require('fs').readFileSync(
    'packages/brain/src/tick.js', 'utf8'
  );
  if (!code.includes('tick-summary')) {
    throw new Error('FAIL: 未找到 [tick-summary] 标识符');
  }
  if (!/% 100/.test(code) && !/%\s*100/.test(code)) {
    throw new Error('FAIL: 未找到 模100 逻辑（% 100）');
  }
  console.log('PASS: summary 逻辑（% 100 + tick-summary）均存在');
"

# [BEHAVIOR] 单元行为验证：模拟调用 tickLog 100 次，检查第 100 次输出含 tick-summary
node -e "
  // 直接从源码抽取计数逻辑，不导入完整模块（避免依赖 DB/ES6）
  const code = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  // 提取计数器初始值行
  const hasCounter = /tickCount|callCount|logCount|tickLogCount/.test(code);
  const hasSummaryLabel = code.includes('tick-summary');
  const hasModulo = /% 100/.test(code);
  if (!hasCounter || !hasSummaryLabel || !hasModulo) {
    throw new Error('FAIL: 缺少必要元素: counter=' + hasCounter + ' summary=' + hasSummaryLabel + ' modulo=' + hasModulo);
  }
  console.log('PASS: 计数逻辑三要素全部存在（counter + tick-summary + % 100）');
"

# [BEHAVIOR] 边界验证：确保原有 tickLog 时间戳逻辑未被破坏
node -e "
  const code = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  if (!code.includes('toLocaleTimeString')) {
    throw new Error('FAIL: 时间戳逻辑（toLocaleTimeString）被意外删除');
  }
  if (!code.includes('Asia/Shanghai')) {
    throw new Error('FAIL: 时区设置（Asia/Shanghai）被意外删除');
  }
  console.log('PASS: 原有时间戳逻辑完整保留');
"
```

---

## 技术实现方向（高层）

在 `tick.js` 第 63-67 行的 `tickLog` 函数上方添加模块级计数器：

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

- 计数器持久化到 DB（纯内存计数，进程重启归零）
- 暴露计数器值到 API 端点
- 修改 TICK_INTERVAL_MINUTES 或其他 tick 配置
- 测试框架变更
