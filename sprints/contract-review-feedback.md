# 合同审查反馈（第 2 轮）

> reviewer_task_id: 61cde398-057f-4c5c-b13b-76ee34791ce9
> propose_task_id: 6abefcd0-fb19-435d-a040-40e3f4f64c38
> propose_round: 2

---

## 必须修改

### 1. [具体失效] Feature 3 验证命令 1 — `indexOf('fallback')` 定位到错误行

**问题**：`c.indexOf('fallback')` 返回文件中**第一个** `fallback` 出现的位置，即 `packages/brain/src/routes/execution.js` 第 184 行：
```javascript
let fallback = `[callback: result=null] task=${task_id} exit_code=${exitCodeStr} at ${ts} | ...`;
```
这是 `callback_result=null` 的处理，与 harness fallback 无关。实际的 harness fallback 日志在第 1746 行：
```javascript
console.warn(`[execution-callback] harness: ${harnessType} ${task_id} verdict=null，fallback→PROPOSED...`);
```

两者相差 1500+ 行，验证命令检查的是完全错误的上下文区域。在**正确实现**上该命令可能产生 FALSE NEGATIVE（附近无 console.warn → exit 1）；在**错误实现**上如果 line 184 区域碰巧有 log 调用可能 FALSE POSITIVE。

**修复**：不能用 `indexOf('fallback')` 做定位。改用 `indexOf('fallback→PROPOSED')` 或 `indexOf('verdict=null')` 精确定位到 harness fallback 行：

```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const fallbackIdx = c.indexOf('fallback→PROPOSED');
  if (fallbackIdx === -1) { console.error('FAIL: 未找到 fallback→PROPOSED 关键字'); process.exit(1); }
  const nearby = c.slice(Math.max(0, fallbackIdx - 300), fallbackIdx + 300);
  const hasLog = nearby.includes('console.warn') || nearby.includes('console.log') || nearby.includes('logger');
  if (!hasLog) {
    console.error('FAIL: fallback→PROPOSED 附近无日志调用');
    process.exit(1);
  }
  console.log('PASS: fallback→PROPOSED 事件有日志记录');
"
```

---

### 2. [命令太弱] Feature 1 验证命令 2 — 全文件独立字符串搜索，无关联性

**问题**：
```javascript
const hasFallbackLog = c.includes('fallback') && (c.includes('console.warn') || c.includes('console.log') || c.includes('logger'));
```
这个命令检查"文件任意位置有 `fallback`" AND "文件任意位置有 `console.warn`"——两个条件完全独立。

`execution.js` 文件有 2000+ 行，`fallback` 在第 184、535、726、1731、2435 行均有出现，`console.warn` 在多处也存在。一个**假实现**（删掉 harness fallback 日志，其他地方有任意 fallback 和 console.warn 就能通过），也能蒙混过关。

**修复**：精确定位 harness_contract_propose 区域内的 fallback 日志（同 Issue 1 的修复思路）：

```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = c.indexOf('harness_contract_propose');
  if (idx === -1) { console.error('FAIL: 未找到 harness_contract_propose'); process.exit(1); }
  // 向后找 fallback→PROPOSED 赋值
  const section = c.slice(idx, idx + 6000);
  const fallbackInSection = section.indexOf('fallback→PROPOSED');
  if (fallbackInSection === -1) { console.error('FAIL: harness_contract_propose 区域内无 fallback→PROPOSED'); process.exit(1); }
  // 验证该 fallback 附近有日志
  const near = section.slice(Math.max(0, fallbackInSection - 300), fallbackInSection + 300);
  if (!near.includes('console.warn') && !near.includes('console.log') && !near.includes('logger')) {
    console.error('FAIL: fallback→PROPOSED 附近无日志调用（静默 fallback）');
    process.exit(1);
  }
  console.log('PASS: fallback 日志在 harness_contract_propose 区域内存在');
"
```

---

### 3. [命令逻辑错误] Feature 1 验证命令 3 — `&&` 导致验证条件过松

**问题**：
```javascript
if (!section.includes('fallback') && !section.includes('PROPOSED')) {
  console.error('FAIL: ...');
  process.exit(1);
}
```
De Morgan 展开：失败条件 = "section 中既无 `fallback` 也无 `PROPOSED`"。  
通过条件 = "section 中包含 `fallback` 或包含 `PROPOSED`（任一）"。

实际上 `harness_contract_propose` 所在行附近的注释里就有类似文字，几乎任何实现都能通过。应改为 `||`（两者都必须存在）：

```javascript
if (!section.includes('fallback') || !section.includes('PROPOSED')) {
  console.error('FAIL: fallback/PROPOSED 不在 harness_contract_propose 区域内（需同时存在）');
  process.exit(1);
}
```

更严格的版本应像问题 2 的修复一样，检查 `fallback→PROPOSED` 这个精确的复合字符串。

---

## 可选改进

- **Feature 2 验证命令 2 中的 hardcode R1 ID**：`propose_task_id === '7e6f21ac-4554-4d53-bb5f-e4607a917ede'` 是 Round 1 的 propose task ID，混在 R2 的合同里造成混乱（虽然 OR 条件的 `planner_task_id` 过滤正确，不影响功能），建议删除该条件或注释说明。

- **Feature 2 缺少 psql 直查 DB 的备用验证**：当前 curl + node inline 管道容易因 API 返回格式变化而失效。可以加一条 psql 命令直接查任务表，更可靠：
  ```bash
  psql $DATABASE_URL -c "SELECT id, task_type, payload->>'propose_round' FROM tasks WHERE task_type='harness_contract_review' AND payload->>'planner_task_id'='2fbff570-b03e-49bd-9a51-94191117ee91' LIMIT 5;"
  ```

---

## 整体评价

第 2 轮相比第 1 轮已大幅改进：新增 Feature 3、命令有 exit code 语义、无占位符、覆盖了所有功能点。但存在 3 个影响验证有效性的结构性问题：精确定位错误（Issue 1）、独立字符串搜索无关联性（Issue 2）、逻辑运算符错误（Issue 3）。修复后可 APPROVED。
