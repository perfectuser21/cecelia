# Contract Review Feedback (Round 3)

**Reviewer**: Evaluator (harness-contract-reviewer)
**Propose Branch**: cp-harness-propose-r3-adabcb24
**Verdict**: REVISION

---

## 必须修改项

### 1. [假测试] Feature 2 ③ — 自我构造字符串验证，非行为验证

**问题**:
命令③ 的逻辑如下：
1. 从 tick.js 提取 `toLocaleTimeString` 参数 → 计算 `ts`
2. **手动构造** `fullLog = '[' + ts + '] ' + errorMsg`
3. 验证这个手动构造的字符串是否符合 `^\[\d{2}:\d{2}:\d{2}\]` 格式

这是一个自我验证的假测试：它验证的是"如果我手动把时间戳拼到字符串前面，格式对不对"——而不是"tick.js 的 tickWarn/tickError 函数实际上会把时间戳加到输出前面"。

**影响**: 任何实现（包括 tickWarn/tickError 完全不使用时间戳，甚至根本不存在的实现）都能通过此命令。
只要 `toLocaleTimeString` 参数格式正确（Feature 2 ② 已验证），此命令**永远 PASS**，对实现质量零约束。

**建议**: 替换为以下任一实质性验证：

```bash
# 方案 A：验证 tickWarn/tickError 函数体内的 _tickWrite 调用均携带时间戳
# （与 Feature 1 ① 的 badTickWriteInner 逻辑类似，但作用于 tickWarn/tickError 函数体）
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  const lines = src.split('\n');

  // 找 tickWarn / tickError 函数体，或验证 tickLog 统一覆盖了 warn/error
  const hasTickWarn = /function tickWarn|const tickWarn/.test(src);
  const hasTickError = /function tickError|const tickError/.test(src);

  if (!hasTickWarn && !hasTickError) {
    // 统一 tickLog 模式：验证 console.warn/error 调用数为 0（Feature 2 ① 已验证）
    console.log('PASS: 统一 tickLog 模式，warn/error 覆盖由 Feature 2 ① 验证');
    process.exit(0);
  }

  // tickWarn/tickError 独立函数模式：验证函数体内 _tickWrite 调用均含时间戳
  ['tickWarn', 'tickError'].forEach(fnName => {
    const fnRe = new RegExp('(?:function|const) ' + fnName);
    if (!fnRe.test(src)) return;
    let start = -1, end = -1, depth = 0;
    lines.forEach((l, i) => {
      if (fnRe.test(l)) { start = i; depth = 0; }
      if (start !== -1 && end === -1) {
        for (const c of l) {
          if (c === '{') depth++;
          if (c === '}') { depth--; if (depth === 0 && start !== i) { end = i; } }
        }
      }
    });
    if (start === -1) return;
    const body = lines.slice(start, end + 1);
    const badLines = body.filter(l =>
      /_tickWrite\(/.test(l) && !/^\s*\/\//.test(l) && !l.includes('\${ts}')
    );
    if (badLines.length > 0) {
      console.error('FAIL: ' + fnName + ' 内 ' + badLines.length + ' 处 _tickWrite 无时间戳');
      badLines.forEach(l => console.error('  ' + l.trim()));
      process.exit(1);
    }
  });
  console.log('PASS: tickWarn/tickError 函数体内所有 _tickWrite 均携带时间戳');
"

# 方案 B（更简单）：直接删除 Feature 2 ③（其约束已被 Feature 1 ① + Feature 2 ① + ② 完全覆盖）
```

---

## 可选改进

### A. Feature 2 ② 与 Feature 1 ③ 重复

两条命令均对 `toLocaleTimeString` 做 `matchAll` 验证，逻辑完全一致。
建议：删除 Feature 2 ② 或在注释中说明它是对 Feature 1 ③ 的冗余备份（避免 Evaluator 困惑）。

### B. Feature 1 ⑤ — git diff fallback 边界情况

`git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD`  
在首次提交（无父提交）时，fallback 到 `git diff --name-only HEAD` 会将所有文件与空树对比，返回仓库所有文件，导致 `nonTick` 列表膨胀误报。  
建议：fallback 改为 `git show --name-only --format='' HEAD` 仅显示最新提交变更的文件。
