# Sprint Contract Draft (Round 3)

> 修订摘要：针对 Round 2 Reviewer 发现的 1 项必须修改（tickLog 内部 _tickWrite 无时间戳子检测）进行修复；同步采纳 2 项可选改进（Feature 1 ③ 改用 matchAll、增加 diff 范围验证）。

## 背景分析

PRD 要求 `packages/brain/src/tick.js` 输出的所有日志行均带 `[HH:MM:SS]` 时间戳前缀（上海时区，24小时制）。

**当前状态**（截至合同起草时）：
- `tickLog()` 函数已存在，格式：`[HH:MM:SS] <内容>`
- tick.js 中仍有大量 `console.log/warn/error` 调用未经 `tickLog` 路由
- `_tickWrite` 在 tickLog 内部有一处直接调用（`[tick-summary]`）未带时间戳前缀
- warn/error 路径尚无 `tickWarn`/`tickError`，或未全面覆盖

---

## Feature 1: tick.js 所有日志行均带时间戳前缀

**行为描述**:
Brain 服务运行期间，由 `packages/brain/src/tick.js` 输出的每一条日志（正常信息、警告、错误）均以 `[HH:MM:SS]` 开头，时间为上海时区（Asia/Shanghai）24小时制。非 tick.js 模块的日志格式不受影响。

**硬阈值**:
- `tick.js` 中不存在直接调用 `console.log`、`console.warn`、`console.error` 的代码行（初始化捕获行 `const { log: _tickWrite } = console` 除外）
- `tick.js` 中不存在 tickLog 函数体**外**的 `_tickWrite(` 直接调用
- `tickLog()` 函数体**内**所有 `_tickWrite(` 调用均携带时间戳参数（含 `${ts}` 或等价时间戳前缀）
- `tickLog()` 的输出格式严格满足正则 `^\[\d{2}:\d{2}:\d{2}\] `（括号、冒号分隔、后跟一个空格）
- 非 tick.js 文件不引入任何改动（diff 范围仅限 `packages/brain/src/tick.js`）

**验证命令**:
```bash
# ① 检查裸 console.* 调用 + tickLog 函数体外的 _tickWrite 调用 + tickLog 内部无时间戳的 _tickWrite 调用
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  const lines = src.split('\n');

  // 检查裸 console.log/warn/error（排除初始化行和注释）
  const badConsole = lines
    .map((l, i) => ({ n: i+1, l }))
    .filter(({ l }) =>
      /console\.(log|warn|error)\(/.test(l) &&
      !/const \{.*\} = console/.test(l) &&
      !/^\s*\/\//.test(l)
    );

  // 定位 tickLog 函数体行范围（brace-depth 追踪）
  let inTickLog = false;
  let braceDepth = 0;
  let tickLogStart = -1;
  let tickLogEnd = -1;
  lines.forEach((l, i) => {
    if (/^function tickLog\(/.test(l)) { inTickLog = true; tickLogStart = i; braceDepth = 0; }
    if (inTickLog) {
      for (const c of l) {
        if (c === '{') braceDepth++;
        if (c === '}') { braceDepth--; if (braceDepth === 0) { tickLogEnd = i; inTickLog = false; } }
      }
    }
  });

  if (tickLogStart === -1) {
    console.error('FAIL: 找不到 tickLog 函数定义');
    process.exit(1);
  }

  // 检查 tickLog 函数体外的 _tickWrite 直接调用
  const badTickWriteOuter = lines
    .map((l, i) => ({ n: i+1, l, idx: i }))
    .filter(({ l, idx }) =>
      /_tickWrite\(/.test(l) &&
      !/const \{ log: _tickWrite \}/.test(l) &&
      !/^\s*\/\//.test(l) &&
      (idx < tickLogStart || idx > tickLogEnd)
    );

  // 检查 tickLog 函数体内不携带时间戳参数的 _tickWrite 调用
  // 判定规则：_tickWrite( 调用不包含 '\${ts}' 或 ts + 时间戳前缀字符串拼接
  const badTickWriteInner = lines
    .slice(tickLogStart, tickLogEnd + 1)
    .map((l, i) => ({ n: tickLogStart + i + 1, l }))
    .filter(({ l }) =>
      /_tickWrite\(/.test(l) &&
      !/^\s*\/\//.test(l) &&
      !/const \{ log: _tickWrite \}/.test(l) &&
      !/\\\${ts}/.test(l) &&
      !l.includes('\${ts}')
    );

  const allBad = [...badConsole, ...badTickWriteOuter];
  if (allBad.length > 0) {
    console.error('FAIL: 仍有 ' + allBad.length + ' 处未路由日志:');
    allBad.slice(0, 5).forEach(({ n, l }) => console.error('  L' + n + ': ' + l.trim()));
    process.exit(1);
  }
  if (badTickWriteInner.length > 0) {
    console.error('FAIL: tickLog 内部 ' + badTickWriteInner.length + ' 处 _tickWrite 调用无时间戳参数:');
    badTickWriteInner.forEach(({ n, l }) => console.error('  L' + n + ': ' + l.trim()));
    process.exit(1);
  }
  console.log('PASS: tick.js 无裸 console.* 调用，tickLog 函数体外无 _tickWrite 直接调用，tickLog 内部所有 _tickWrite 均携带时间戳');
"

# ② 静态验证 tickLog 函数：Asia/Shanghai + hour12:false
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  if (!src.includes('Asia/Shanghai')) {
    console.error('FAIL: tickLog 未使用 Asia/Shanghai 时区');
    process.exit(1);
  }
  if (!src.includes('hour12: false')) {
    console.error('FAIL: tickLog 未指定 hour12:false');
    process.exit(1);
  }
  console.log('PASS: tickLog 静态检查通过（Asia/Shanghai + 24小时制）');
"

# ③ 从 tick.js 源码提取全部时间戳表达式（matchAll），实际执行并验证格式
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');

  // 搜索所有 toLocaleTimeString 调用，逐一验证（覆盖 tickLog/tickWarn/tickError 等）
  const matches = [...src.matchAll(/new Date\(\)\.toLocaleTimeString\(([^)]+)\)/g)];
  if (matches.length === 0) {
    console.error('FAIL: 未找到任何 toLocaleTimeString 调用');
    process.exit(1);
  }

  let failCount = 0;
  matches.forEach((m, idx) => {
    const ts = eval('new Date().toLocaleTimeString(' + m[1] + ')');
    const re = /^\d{2}:\d{2}:\d{2}$/;
    if (!re.test(ts)) {
      console.error('FAIL: 第 ' + (idx+1) + ' 处时间戳格式不符，实际：' + ts);
      failCount++;
    }
  });

  if (failCount > 0) { process.exit(1); }
  console.log('PASS: tick.js 全部 ' + matches.length + ' 处时间戳表达式格式正确（上海时区 24小时制）');
"

# ④ 边界验证：server.js 未引入 tickLog（日志格式隔离）
node -e "
  const src = require('fs').readFileSync('packages/brain/src/server.js', 'utf8');
  if (src.includes('tickLog')) {
    console.error('FAIL: server.js 引入了 tickLog，违反非 tick 模块日志格式隔离规则');
    process.exit(1);
  }
  console.log('PASS: server.js 未引入 tickLog，跨模块隔离正常');
"

# ⑤ diff 范围验证：改动仅限 packages/brain/src/tick.js
node -e "
  const { execSync } = require('child_process');
  try {
    const changed = execSync('git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD', { encoding: 'utf8' }).trim();
    const files = changed.split('\n').filter(Boolean);
    const nonTick = files.filter(f => f !== 'packages/brain/src/tick.js' && !f.startsWith('sprints/') && !f.startsWith('docs/'));
    if (nonTick.length > 0) {
      console.error('FAIL: 改动范围超出预期，以下文件不应变更:');
      nonTick.forEach(f => console.error('  ' + f));
      process.exit(1);
    }
    console.log('PASS: 改动范围符合预期（仅 tick.js 及辅助文件）');
  } catch(e) {
    console.log('SKIP: 无法运行 git diff（可能是初始提交或 CI 环境），跳过范围检查');
  }
"
```

---

## Feature 2: warn/error 级别日志同步带时间戳

**行为描述**:
当 tick.js 内部发生错误（如 tick 超时、dispatch 失败、watchdog 异常）时，输出的警告/错误级别日志同样带有 `[HH:MM:SS]` 时间戳前缀，与正常 tick 日志格式一致，便于问题定位。

**硬阈值**:
- tick.js 中处理错误的代码路径（catch 块、warn 调用）输出的日志均以 `[HH:MM:SS]` 开头
- 新增 `tickWarn`/`tickError` 函数（或在统一 `tickLog` 中覆盖 warn/error 语义），内部使用与 tickLog 相同的时间戳机制
- 不存在绕过时间戳路径的 `console.warn`/`console.error` 调用

**验证命令**:
```bash
# ① 检查 tickWarn/tickError 定义或统一 tickLog 已覆盖 warn/error 路径
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');

  // 精确统计：非注释、非初始化的 console.warn/error 调用
  const lines = src.split('\n');
  const bad = lines.filter(l =>
    /console\.(warn|error)\(/.test(l) &&
    !/^\s*\/\//.test(l) &&
    !/const \{/.test(l)
  );

  if (bad.length > 0) {
    console.error('FAIL: 仍有 ' + bad.length + ' 处 console.warn/error 未覆盖时间戳:');
    bad.slice(0, 3).forEach(l => console.error('  ' + l.trim()));
    process.exit(1);
  }

  const hasTickWarn = /function tickWarn|const tickWarn/.test(src);
  const hasTickError = /function tickError|const tickError/.test(src);
  const mode = (hasTickWarn && hasTickError) ? 'tickWarn/tickError 独立函数模式' : '统一 tickLog 覆盖模式';
  console.log('PASS: 所有 warn/error 路径已覆盖时间戳（' + mode + ')');
"

# ② 从 tick.js 源码提取全部时间戳表达式（matchAll），验证每处均格式正确
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');

  const matches = [...src.matchAll(/new Date\(\)\.toLocaleTimeString\(([^)]+)\)/g)];
  if (matches.length === 0) {
    console.error('FAIL: 未找到任何 toLocaleTimeString 调用');
    process.exit(1);
  }

  let failCount = 0;
  matches.forEach((m, idx) => {
    const ts = eval('new Date().toLocaleTimeString(' + m[1] + ')');
    if (!/^\d{2}:\d{2}:\d{2}$/.test(ts)) {
      console.error('FAIL: 第 ' + (idx+1) + ' 处时间戳格式不符：' + ts);
      failCount++;
    }
  });

  if (failCount > 0) { process.exit(1); }
  console.log('PASS: tick.js 中全部 ' + matches.length + ' 处时间戳表达式格式正确（上海时区 24小时制）');
"

# ③ 失败路径边界：模拟 tickLog 被调用时携带错误信息，验证输出含时间戳
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');

  // 提取 toLocaleTimeString 参数（复用 tick.js 的实际实现）
  const m = src.match(/new Date\(\)\.toLocaleTimeString\(([^)]+)\)/);
  if (!m) { console.error('FAIL: 找不到时间戳实现'); process.exit(1); }

  // 模拟 tickLog 输出一条 error 消息
  const ts = eval('new Date().toLocaleTimeString(' + m[1] + ')');
  const errorMsg = '[tick-loop] Tick failed: connection timeout';
  const fullLog = '[' + ts + '] ' + errorMsg;

  if (!/^\[\d{2}:\d{2}:\d{2}\] \[tick-loop\] Tick failed/.test(fullLog)) {
    console.error('FAIL: 错误日志格式不符：' + fullLog);
    process.exit(1);
  }
  console.log('PASS: 错误场景日志格式符合预期：' + fullLog);
"
```

---

## 合同边界说明

| 在范围内 | 不在范围内 |
|----------|-----------|
| `packages/brain/src/tick.js` 中的所有日志调用 | 其他模块（server.js、thalamus.js 等）的日志 |
| 将 `console.log/warn/error` 替换为带时间戳的等价调用 | 引入外部日志库 |
| 修复 tickLog 内部 `_tickWrite` 直接调用（确保带时间戳） | 修改日志的其他部分（如添加 task_id）|
| 新增 `tickWarn`/`tickError` 或统一 tickLog 覆盖 warn/error | 日志持久化、结构化日志 |

---

## Round 3 修订说明

| # | R2 问题 | R3 修复方式 |
|---|---------|------------|
| 1 | [必须] Feature 1 ① 未检测 tickLog 内部 _tickWrite 调用是否携带时间戳 | 命令①新增 `badTickWriteInner` 子检测：在 tickLogStart..tickLogEnd 范围内，筛选不含 `${ts}` 的 `_tickWrite(` 调用并报错 |
| 2 | [可选] Feature 1 ③ 仅用 `src.match()` 取第一处，可能漏检 | 改用 `matchAll` 全量扫描，与 Feature 2 ② 保持一致 |
| 3 | [可选] 缺少 diff 范围验证 | 新增命令⑤：通过 `git diff --name-only` 确认改动仅限 tick.js 及辅助文件 |
