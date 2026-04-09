# Contract Review Feedback (Round 2)

**Reviewer**: Evaluator (harness-contract-reviewer)
**Propose Branch**: cp-harness-propose-r2-bde4e073
**Verdict**: REVISION

---

## 必须修改项

### 1. [命令遗漏] Feature 1 ① — 未验证 tickLog 函数**内部** _tickWrite 调用是否携带时间戳

**问题**:
命令① 通过 brace-depth 追踪定位 tickLog 函数范围，仅检测**函数体外**的 `_tickWrite(` 调用。
然而，合同背景明确指出 tick.js 存在以下问题：
> `_tickWrite` 在 tickLog 内部有一处直接调用（`[tick-summary]`）**未带时间戳前缀**

当前代码 `tick.js:72`：
```javascript
_tickWrite(`[tick-summary] ${_tickLogCallCount} ticks completed`);
```
此行在 tickLog 函数体**内部**，但输出不含 `[HH:MM:SS]` 前缀。

命令① 的 `badTickWrite` 过滤器只查 `idx < tickLogStart || idx > tickLogEnd`，即仅报告函数体**外**的调用。一个"修复"实现可以：
1. 移除所有外部 `console.*` 调用 ✅（命令① 通过）
2. 保留内部 `_tickWrite('[tick-summary]...')` 无时间戳 ❌（命令① **不检测**）

三条命令均会 PASS，但 [tick-summary] 行仍无时间戳，违反 Feature 1 的硬阈值。

**影响**: 空/错误实现可蒙混过关；合同内部承诺（"tickLog 内部 _tickWrite 调用须带时间戳参数"）无命令验证。

**建议**: 在命令① 的 `badTickWrite` 检测之外，**增加一个子检测**：

```bash
# 在 tickLog 函数体内，查找不携带时间戳参数的 _tickWrite 调用
# 策略：在 tickLogStart..tickLogEnd 范围内，检查 _tickWrite( 调用是否包含 ts 变量引用
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  const lines = src.split('\n');

  // 定位 tickLog 函数体范围（同命令①的 brace-depth 逻辑）
  let inTickLog = false, braceDepth = 0, tickLogStart = -1, tickLogEnd = -1;
  lines.forEach((l, i) => {
    if (/^function tickLog\(/.test(l)) { inTickLog = true; tickLogStart = i; braceDepth = 0; }
    if (inTickLog) {
      for (const c of l) {
        if (c === '{') braceDepth++;
        if (c === '}') { braceDepth--; if (braceDepth === 0) { tickLogEnd = i; inTickLog = false; } }
      }
    }
  });

  if (tickLogStart === -1) { console.error('FAIL: 找不到 tickLog 函数定义'); process.exit(1); }

  // 在函数体内，查找不携带时间戳（不含 ts 变量）的 _tickWrite 调用
  const badInternal = lines.slice(tickLogStart, tickLogEnd + 1)
    .map((l, i) => ({ n: tickLogStart + i + 1, l }))
    .filter(({ l }) =>
      /_tickWrite\(/.test(l) &&
      !/^\s*\/\//.test(l) &&
      !l.includes('\${ts}') && !l.includes(\"'['\") // 不含时间戳前缀参数
    );

  if (badInternal.length > 0) {
    console.error('FAIL: tickLog 内部 ' + badInternal.length + ' 处 _tickWrite 调用无时间戳:');
    badInternal.forEach(({ n, l }) => console.error('  L' + n + ': ' + l.trim()));
    process.exit(1);
  }
  console.log('PASS: tickLog 内部所有 _tickWrite 调用均携带时间戳参数');
"
```

---

## 可选改进

- Feature 1 命令③ 使用 `src.match()`（只取第一个 toLocaleTimeString），Feature 2 命令② 用 `matchAll`（覆盖全部）。如果实现中 tickWarn/tickError 有独立的 toLocaleTimeString 调用，Feature 1 ③ 可能只测到 tickLog 的那一个。建议 Feature 1 ③ 也改用 `matchAll` 或明确说明"仅验证 tickLog 自身的时间戳格式"。

- 可考虑增加一条 diff 范围验证：确认改动仅限 `packages/brain/src/tick.js`（如 `git diff --name-only HEAD` 只含该文件），防止实现范围蔓延。但此项非阻断。

---

## R2 修订确认（R1 四项已全部解决）

| # | R1 问题 | R2 状态 |
|---|---------|---------|
| 1 | Feature 2 ② 硬编码 simulatedOutput | ✅ 已改为从源码提取 eval |
| 2 | Feature 1 ③ 重建而非测试实现 | ✅ 已改为 regex 提取 toLocaleTimeString 参数 |
| 3 | Feature 1 ① 未检测 tickLog 外的 _tickWrite | ✅ 已加 brace-depth 追踪 |
| 4 | Feature 2 ① 死代码 hasConsoleMissed | ✅ 已删除，改用精确 bad 数组 |

R2 整体命令质量显著提升。仅剩上述 1 项必须修改。
