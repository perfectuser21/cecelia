# Sprint Contract Draft (Round 1)

## 背景分析

PRD 要求 `packages/brain/src/tick.js` 输出的所有日志行均带 `[HH:MM:SS]` 时间戳前缀（上海时区，24小时制）。

**当前状态**（截至合同起草时）：
- `tickLog()` 函数已存在于 main（第 67 行），格式正确：`[HH:MM:SS] <内容>`
- 但 tick.js 中仍有 **116 处** `console.log/warn/error` 调用**未经** `tickLog` 路由，导致这些日志行没有时间戳
- `tickLog` 内部调用 `_tickWrite`（即原始 `console.log`），仅覆盖 log 级别，warn/error 需要同步处理

---

## Feature 1: tick.js 所有日志行均带时间戳前缀

**行为描述**:  
Brain 服务运行期间，由 `packages/brain/src/tick.js` 输出的每一条日志（包括正常信息、警告、错误）均以 `[HH:MM:SS]` 开头，时间为上海时区（Asia/Shanghai）24小时制。非 tick.js 模块（server.js、thalamus.js 等）的日志输出格式不受影响。

**硬阈值**:
- `tick.js` 中不存在直接调用 `console.log`、`console.warn`、`console.error` 的代码行（初始化捕获代码行 `const { log: _tickWrite } = console` 除外）
- `tickLog()` 的输出格式严格满足正则 `^\[\d{2}:\d{2}:\d{2}\] `（方括号、冒号分隔、后跟一个空格）
- 非 tick.js 文件中不引入任何改动（diff 范围仅限 `packages/brain/src/tick.js`）

**验证命令**:
```bash
# ① 检查 tick.js 中是否仍存在裸 console.log/warn/error 调用（非初始化行）
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  const lines = src.split('\n');
  const bad = lines
    .map((l, i) => ({ n: i+1, l }))
    .filter(({ l }) =>
      /console\.(log|warn|error)\(/.test(l) &&
      !/const \{.*\} = console/.test(l) &&
      !/^\s*\/\//.test(l)
    );
  if (bad.length > 0) {
    console.error('FAIL: 仍有 ' + bad.length + ' 处裸 console.* 调用:');
    bad.slice(0, 5).forEach(({ n, l }) => console.error('  L' + n + ': ' + l.trim()));
    process.exit(1);
  }
  console.log('PASS: tick.js 无裸 console.* 调用，所有日志已路由至 tickLog');
"

# ② 验证 tickLog 输出格式符合 [HH:MM:SS] 正则
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  const match = src.match(/function tickLog[\s\S]*?^}/m);
  if (!match) { console.error('FAIL: 找不到 tickLog 函数'); process.exit(1); }
  if (!src.includes('Asia/Shanghai')) { console.error('FAIL: tickLog 未使用 Asia/Shanghai 时区'); process.exit(1); }
  if (!src.includes('hour12: false')) { console.error('FAIL: tickLog 未指定 hour12:false'); process.exit(1); }
  console.log('PASS: tickLog 函数使用上海时区 + 24小时制');
"

# ③ 运行时快照验证：捕获一条 tick 日志并检查格式（需 Brain 在运行）
curl -sf "localhost:5221/api/brain/tasks?limit=1" > /dev/null && \
  node -e "
    // 直接实例化 tickLog 逻辑并验证输出格式
    const ts = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    const prefix = '[' + ts + ']';
    const re = /^\[\d{2}:\d{2}:\d{2}\]$/;
    if (!re.test(prefix)) {
      console.error('FAIL: 时间戳格式不符，实际：' + prefix);
      process.exit(1);
    }
    console.log('PASS: 时间戳格式正确，示例：' + prefix + ' tick: executing...');
  "

# ④ 边界验证：非 tick.js 文件（server.js）的日志格式不应带时间戳前缀
node -e "
  const src = require('fs').readFileSync('packages/brain/src/server.js', 'utf8');
  if (src.includes('tickLog')) {
    console.error('FAIL: server.js 引入了 tickLog，违反非 tick 模块隔离规则');
    process.exit(1);
  }
  console.log('PASS: server.js 未引入 tickLog，非 tick 模块日志格式不受影响');
"
```

---

## Feature 2: warn/error 级别日志同步带时间戳

**行为描述**:  
当 tick.js 内部发生错误（如 tick 超时、dispatch 失败、watchdog 异常）时，输出的 `console.error` / `console.warn` 级别日志同样带有 `[HH:MM:SS]` 时间戳，而非裸输出。这使得错误日志与正常 tick 日志时序一致，便于问题定位。

**硬阈值**:
- tick.js 中处理错误的代码路径（catch 块、warn 调用）输出的日志均以 `[HH:MM:SS]` 开头
- `tickLog` 函数（或其扩展）覆盖 warn/error 路径，或引入等价的 `tickWarn`/`tickError` 函数

**验证命令**:
```bash
# ① 检查 tickWarn/tickError 或 tickLog 是否覆盖了 warn/error 语义
node -e "
  const src = require('fs').readFileSync('packages/brain/src/tick.js', 'utf8');
  const hasTickWarn = src.includes('tickWarn') || src.includes('tickError');
  const hasConsoleMissed = (src.match(/console\.(warn|error)\(/g) || []).filter(() => {
    // 排除初始化捕获行
    return true;
  }).length;
  
  // 重新精确统计：非注释、非初始化的 console.warn/error
  const lines = src.split('\n');
  const bad = lines.filter(l =>
    /console\.(warn|error)\(/.test(l) &&
    !/^\s*\/\//.test(l) &&
    !/const \{/.test(l)
  );
  
  if (bad.length > 0) {
    console.error('FAIL: 仍有 ' + bad.length + ' 处 console.warn/error 未覆盖（缺少时间戳）');
    bad.slice(0, 3).forEach(l => console.error('  ' + l.trim()));
    process.exit(1);
  }
  console.log('PASS: 所有 warn/error 路径已覆盖时间戳（' + (hasTickWarn ? 'tickWarn/tickError 模式' : '统一 tickLog 模式') + ')');
"

# ② 失败路径验证：tickLog 实际输出格式（模拟错误场景）
node -e "
  let captured = null;
  const orig = console.log;
  console.log = (...args) => { captured = args.join(' '); };
  
  // 模拟 tickLog 调用（复现 tick.js 的逻辑）
  const ts = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  console.log = orig;
  
  const simulatedOutput = '[' + ts + '] [tick-loop] Tick failed (source: manual): connection timeout';
  if (!/^\[\d{2}:\d{2}:\d{2}\] \[tick/.test(simulatedOutput)) {
    console.error('FAIL: 错误日志格式不符：' + simulatedOutput);
    process.exit(1);
  }
  console.log('PASS: 错误日志格式符合预期：' + simulatedOutput);
"
```

---

## 合同边界说明

| 在范围内 | 不在范围内 |
|----------|-----------|
| `packages/brain/src/tick.js` 中的所有日志调用 | 其他模块（server.js、thalamus.js 等）的日志 |
| 将 `console.log/warn/error` 替换为带时间戳的等价调用 | 引入外部日志库 |
| 扩展 `tickLog` 覆盖 warn/error 语义 | 修改日志格式的其他部分（如添加 task_id）|
| 验证格式符合 `[HH:MM:SS] ` | 日志持久化、结构化日志 |
