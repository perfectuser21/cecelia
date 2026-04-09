# Contract Review Feedback (Round 4)

**Reviewer**: Evaluator (harness-contract-reviewer)
**Reviewer Task ID**: c1993e4b-cae7-4541-b90a-a292bb6b4427
**Propose Branch**: cp-harness-propose-r4-bb9301b9
**Planner Task ID**: 5bf2908f-4709-4053-8fe5-ab6a577c2aef
**Verdict**: REVISION

---

## 必须修改项

### 1. [P0 致命] PRD-合同主题完全不匹配 — 合同覆盖错误的功能点

**问题**:

当前合同草案（第 1-4 轮均如此）的内容：
- Feature 1: tick.js 所有日志行带 [HH:MM:SS] 时间戳前缀
- Feature 2: warn/error 级别日志同步带时间戳

当前 Planner Task `5bf2908f` 在 `sprints/sprint-prd.md` 中要求的功能：
- Feature 1: arch_review 去重修复 + 积压清理（`daily-review-scheduler.js` + `task-cleanup.js`）
- Feature 2: content-pipeline terminal failure 状态修复（`0e1cd015` 任务 + `task-cleanup.js` 规则）
- Feature 3: account-usage-scheduling 测试隔离修复（`account-usage-scheduling.test.js` + 相关测试文件）
- Feature 4: quickcheck.sh brain 测试提速（`scripts/quickcheck.sh` vitest --related 模式）

**影响**: 合同对 PRD 中 4 个功能点的覆盖率为 **0/4**。任何 Evaluator 执行这份合同的命令，都无法验证 PRD 要求的任何一个功能是否被正确实现。即使 tick.js 日志格式完全正确，4 个真正的 Pipeline 瓶颈仍然存在。

**根因分析**: 推测 Proposer 在 Round 4 修订时直接从 Round 3 的 tick.js 合同继续迭代，未重新读取当前 Planner 任务的 `sprints/sprint-prd.md`。这是 Harness Pipeline 的路由问题，不是合同质量问题本身——但结果同样需要修正。

**建议修复**: Proposer 须重新读取 `origin/cp-04090326-5bf2908f-4709-4053-8fe5-ab6a57:sprints/sprint-prd.md`，围绕 4 个真实功能点重新起草合同。tick.js 日志格式化不在本 Sprint 范围内（PRD 的"范围限定"章节未列出 tick.js）。

---

### 2. [命令漏洞] Feature 2 ② — brace-depth 追踪器对无大括号箭头函数产生错误 PASS

**问题**:

Feature 2 ② 通过 brace-depth 追踪定位 `tickWarn`/`tickError` 函数体，验证其中 `_tickWrite` 调用是否含时间戳。但当函数定义为**无大括号箭头函数**时：

```js
// 实现方案（不含时间戳，错误实现）
const tickWarn = (msg) => _tickWrite(msg);
```

追踪逻辑：
1. `const fnRe = new RegExp('(?:function|const) tickWarn')` → 匹配到该行，设 `start = i`
2. 遍历行字符寻找 `{`：箭头函数无大括号，`depth` 永远不从 0 增加，`end` 保持 `-1`
3. `lines.slice(start, -1 + 1)` = `lines.slice(start, 0)` = `[]`（空数组）
4. `badLines = []` → 输出 **PASS**

**影响**: 一个没有添加时间戳的 `tickWarn = (msg) => _tickWrite(msg)` 实现，能蒙混过 Feature 2 ② 的验证。

Feature 2 ① 只检测 `console.warn/error` 调用，不检测 `_tickWrite` 是否携带时间戳——两条命令合并也无法覆盖此漏洞。

**建议修复**:

```javascript
// 在 brace-depth 追踪器后，增加 arrow function fallback
// 若 end === -1（无大括号函数体），则改用单行正则检查
if (start !== -1 && end === -1) {
  // 单行箭头函数：验证该行 _tickWrite 调用包含时间戳参数
  const line = lines[start];
  if (/_tickWrite\(/.test(line) && !line.includes('${ts}')) {
    console.error('FAIL: ' + fnName + ' 单行箭头函数中 _tickWrite 无时间戳参数');
    console.error('  ' + line.trim());
    anyFail = true;
  }
  return; // 无需继续扫描
}
```

---

### 3. [命令假失败] Feature 1 ① — tickLog 函数检测正则假设 `function` 声明风格

**问题**:

Feature 1 ① 中定位 tickLog 函数体的代码：

```javascript
if (/^function tickLog\(/.test(l)) { inTickLog = true; tickLogStart = i; braceDepth = 0; }
```

正则 `/^function tickLog\(/` 仅匹配行首的函数声明。以下等价实现均不被识别：
- `const tickLog = function(prefix, msg) { ... }` → 找不到
- `const tickLog = (prefix, msg) => { ... }` → 找不到

若实现者使用任意 const/arrow 定义 tickLog，命令①会以：
```
FAIL: 找不到 tickLog 函数定义
```
退出，产生**假失败**（正确实现被判为失败）。

**建议修复**: 将正则改为同时支持两种定义风格：
```javascript
if (/^(?:function tickLog\(|const tickLog\s*=)/.test(l)) {
  inTickLog = true; tickLogStart = i; braceDepth = 0;
}
```

---

## 注意事项

以上问题 **#1（PRD 主题不匹配）** 是根本性问题——若不修复，合同对本 Sprint 无效；问题 #2 和 #3 是合同命令层面的技术漏洞，在重新起草合同后需同步规避。

若 Proposer 确认 Planner Task `5bf2908f` 的真实 PRD **确实**是 tick.js 日志格式化（而非4项流水线瓶颈），请在下一轮合同草案的"背景分析"中明确注明 PRD 来源文件路径和内容摘要，消除歧义。
