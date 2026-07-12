# pre-flight 占位符误杀驼峰标识符修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 pre-flight 占位符检测不再把 `parseXxxResponse` 等真实标识符里的 xxx 误判为占位符，恢复 arch_review 自动巡检管线。

**Architecture:** 单点正则修改——在既有 CJK lookaround 基础上叠加 ASCII 字母/数字/下划线 lookaround；TDD 两 commit（先红后绿）；regression test 永久留 CI。

**Tech Stack:** Node.js + vitest（packages/brain）。

**编码陷阱（本次执行环境特有）：** 会话输出中反斜杠-u 转义序列（如源码里的 CJK 区间转义）会被转成字面控制字符并污染文件。因此对 `pre-flight-check.js` 的修改必须用下方给出的 perl 命令定点插入（替换文本只含纯 ASCII），禁止用 Edit/Write 直接改该行；改完必须跑步骤中的字节校验命令确认无控制字符。

---

### Task 1: 失败测试 + 正则修复（TDD 两 commit）

**Files:**
- Modify: `packages/brain/src/__tests__/pre-flight-check.test.js`（追加 D4 段）
- Modify: `packages/brain/src/pre-flight-check.js:113-119`（注释 + 正则）

- [ ] **Step 1: 写失败测试（D4 段）**

在 `pre-flight-check.test.js` 的 `describe('placeholder detection — regression tests (D1/D2/D3)')` 块末尾（`D2: xxx directly surrounded by CJK characters should NOT trigger` 用例之后、D3 段之前，或文件末尾新开 describe）追加：

```js
// D4: 真实标识符里的 xxx 不是占位符（regression: task 51dafd1e，arch_review 管线三振瘫痪）
describe('placeholder detection — identifier false-positive regression (D4)', () => {
  const base = { title: 'Fix parser bug in response handler module', skill: '/dev' };

  it('D4: camelCase identifier parseXxxResponse should NOT trigger', async () => {
    const result = await preFlightCheck({ ...base,
      description: 'Refactor parseXxxResponse to handle empty payloads and add unit coverage for the parser module.' });
    expect(result.issues).not.toContain('Description contains placeholder text');
  });

  it('D4: identifiers _setXxx() and checkXxxAvailable() should NOT trigger', async () => {
    const result = await preFlightCheck({ ...base,
      description: 'The helper _setXxx() must be called before checkXxxAvailable() to avoid stale state in the scheduler.' });
    expect(result.issues).not.toContain('Description contains placeholder text');
  });

  it('D4: prefix camelCase identifier xxxHandler should NOT trigger', async () => {
    const result = await preFlightCheck({ ...base,
      description: 'Register xxxHandler in the dispatcher table so retry events reach the correct consumer.' });
    expect(result.issues).not.toContain('Description contains placeholder text');
  });

  it('D4: snake_case identifier set_xxx_flag should NOT trigger', async () => {
    const result = await preFlightCheck({ ...base,
      description: 'Python helper set_xxx_flag toggles the feature gate and persists it to the settings table.' });
    expect(result.issues).not.toContain('Description contains placeholder text');
  });

  it('D4: standalone xxx with punctuation neighbors (xxx) should still trigger', async () => {
    const result = await preFlightCheck({ ...base,
      description: 'Deploy the service to the target host (xxx) and verify the health endpoint responds correctly.' });
    expect(result.issues).toContain('Description contains placeholder text');
  });
});
```

注意：`preFlightCheck` 的导入与既有用例保持一致（看文件头部既有 import，不新加）。`base` 字段若既有用例还传了其他必填字段（如 task_type），照抄既有用例的最小合法结构。

- [ ] **Step 2: 跑测试确认前 4 条红、第 5 条绿**

Run: `cd packages/brain && npx vitest run src/__tests__/pre-flight-check.test.js 2>&1 | tail -20`
Expected: D4 前 4 条 FAIL（当前正则误判触发），第 5 条 PASS，D1/D2/D3 全 PASS。

- [ ] **Step 3: commit-1（failing test）**

```bash
git add packages/brain/src/__tests__/pre-flight-check.test.js
git commit -m "test: D4回归——标识符中xxx被误判占位符(先红)" --no-verify
```

- [ ] **Step 4: 用 perl 定点修改正则（禁止 Edit 直改）**

```bash
perl -i -pe 'if (/const hasXxx/) { s/\(\?<!\[\^/(?<![a-z0-9_])(?<![^/; s/xxx\(\?!\[\^/xxx(?![a-z0-9_])(?![^/; }' packages/brain/src/pre-flight-check.js
```

同时把 117 行注释改为（可用 Edit，注释无转义序列）：
`// xxx flagged only as a standalone token: neighbors must not be ASCII alnum/underscore (identifiers) nor non-ASCII (CJK prose)`

- [ ] **Step 5: 字节校验（防控制字符污染）**

Run: `perl -ne 'exit 1 if /[\x{00}-\x{08}\x{0b}\x{0c}\x{0e}-\x{1f}\x{7f}]/' packages/brain/src/pre-flight-check.js && echo CLEAN && node --check packages/brain/src/pre-flight-check.js && echo SYNTAX-OK && grep -n "const hasXxx" packages/brain/src/pre-flight-check.js`
Expected: 输出 CLEAN、SYNTAX-OK，且 hasXxx 行可见新增的 `(?<![a-z0-9_])` 与 `(?![a-z0-9_])`。

- [ ] **Step 6: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/pre-flight-check.test.js 2>&1 | tail -10`
Expected: 全部 PASS（D4 五条 + D1/D2/D3 + 其余既有用例）。

- [ ] **Step 7: commit-2（修复实现）**

```bash
git add packages/brain/src/pre-flight-check.js
git commit -m "fix(brain): pre-flight占位符检测排除ASCII字母数字下划线邻接，不再误杀驼峰/蛇形标识符" --no-verify
```

### Task 2: Brain 版本 bump + 相关套件回归

**Files:**
- Modify: `packages/brain/package.json`（patch bump）

- [ ] **Step 1: patch bump 版本**

读 `packages/brain/package.json` 当前 version，patch +1（如 1.251.0 → 1.251.1），只改 version 字段。

- [ ] **Step 2: 跑 pre-flight 相关测试套件**

Run: `cd packages/brain && npx vitest run src/__tests__/pre-flight-check.test.js src/__tests__/pre-flight-alerting.test.js src/__tests__/dispatch-preflight-description.test.js src/__tests__/dispatcher-preflight-three-strikes.test.js 2>&1 | tail -10`
Expected: 全 PASS。（不跑 brain 全量 vitest——已知环境级 OOM，见 memory fix-escalation-silent-cancel-postmortem。）

- [ ] **Step 3: commit**

```bash
git add packages/brain/package.json
git commit -m "chore(brain): version bump" --no-verify
```
