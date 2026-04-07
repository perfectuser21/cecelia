# 合同审查反馈（第 1 轮）

## 必须修改

### 1. [Feature 1 验证命令逻辑 bug] 弱测试，永远不会触发 exit(1)

**问题**：
```js
if (!c.includes('SPRINT_ACCOUNT1_TASK_TYPES') && !c.includes('sprint_contract_propose') || !c.includes('account1'))
```
JS 操作符优先级：`&&` 优先于 `||`，实际逻辑是 `(!A && !B) || !C`。
而 `account1` 字符串在 executor.js 中已大量存在（账号配置路径、注释等），
导致 `!c.includes('account1')` 永远为 false，整个条件永远为 false，命令永远不会 exit(1)。

**修复方向**：
```bash
node -e "
const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
if (!c.includes('SPRINT_ACCOUNT1_TASK_TYPES')) process.exit(1);
if (!c.includes(\"'account1'\")) process.exit(1);  // 引号内的字面量
// 验证数组包含所有6个 sprint task types
const types = ['sprint_contract_propose','sprint_contract_review','sprint_generate','sprint_evaluate','sprint_fix','sprint_report'];
for (const t of types) {
  if (!c.includes(t)) { console.error('Missing: ' + t); process.exit(1); }
}
console.log('OK');
"
```

---

### 2. [Feature 1 缺失] spending-cap fallback 路径完全未验证

PRD 明确验收标准：
> "当 account1 处于 spending-cap 状态时，executor 正常 fallback 到 selectBestAccount 动态选择，不报错不中断"

草案中没有任何命令测试这条路径。

**修复方向**：在单元测试 `dispatch-task-action.test.js` 中增加一个 case：
mock account1 为 spending-capped 状态，断言 executor 调用了 `selectBestAccount` 且没有抛出错误。

---

### 3. [Feature 2 验证命令太弱] 字符串存在性检查，无法验证逻辑正确性

**问题**：检查 `c.includes('fetchSprintFiles')` 或 `c.includes('sprintPrdContent')` 只证明这些标识符出现在文件里，不能验证它们在正确的函数中（`preparePrompt`）、对正确的 task_type 分支生效。

更严重：`sprint_contract_review` 路径需要嵌入 `contract-draft.md`，但验证命令只检查了 `sprint-prd.md`，完全遗漏。

**修复方向**：
```bash
# 验证 sprint_contract_review 分支也嵌入 contract-draft.md
node -e "
const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
if (!c.includes('sprint_contract_review')) process.exit(1);
if (!c.includes('contract-draft.md')) process.exit(1);
// 验证 git show 或 fetchSprintFile 在 preparePrompt 函数范围内
const ppIdx = c.indexOf('preparePrompt');
const fetchIdx = c.indexOf('git show', ppIdx);
if (fetchIdx === -1) process.exit(1);
console.log('OK');
"
```

---

### 4. [Feature 2 缺失] 跨 worktree 核心场景（本地无文件）未测试

Feature 2 的核心动机就是"本地 worktree 没有目标文件，靠 git fetch 从远端获取"。
但草案没有任何命令测试这个路径。

**修复方向**：在单元测试中增加 case：mock 文件系统中不存在 `sprints/sprint-prd.md`，断言系统执行了 `git fetch origin` 并通过 `git show` 获取文件内容。

---

### 5. [Feature 3 验证命令不足] 只验证约束存在，不验证枚举值内容

**问题**：
```sql
SELECT constraint_name FROM information_schema.check_constraints
  WHERE constraint_name = 'tasks_task_type_check'
```
这个查询只检查约束是否存在（旧约束也满足条件），不能证明 `sprint_report` 和 `cecelia_event` 已被加入约束。

**修复方向**：查询约束定义内容：
```bash
node -e "
const { Pool } = require('pg');
const pool = new Pool({ database: 'cecelia' });
pool.query(\"SELECT check_clause FROM information_schema.check_constraints WHERE constraint_name = 'tasks_task_type_check'\")
  .then(r => {
    if (r.rows.length === 0) { console.error('constraint missing'); process.exit(1); }
    const clause = r.rows[0].check_clause;
    if (!clause.includes('sprint_report')) { console.error('sprint_report missing from constraint'); process.exit(1); }
    if (!clause.includes('cecelia_event')) { console.error('cecelia_event missing from constraint'); process.exit(1); }
    console.log('OK: both values in constraint');
    return pool.end();
  });
"
```

---

### 6. [Feature 3 缺失] PRD 明确要求的负向测试未出现

PRD 验收标准：
> "若尝试插入不在约束范围内的 task_type 值，数据库拒绝并返回可读错误，而不是静默接受"

草案完全没有测试这个场景。

**修复方向**：
```bash
node -e "
const { Pool } = require('pg');
const pool = new Pool({ database: 'cecelia' });
pool.query(\"INSERT INTO tasks (task_type) VALUES ('invalid_type_xyz')\")
  .then(() => { console.error('FAIL: constraint not enforced'); process.exit(1); })
  .catch(e => {
    if (e.message.includes('violates check constraint') || e.message.includes('tasks_task_type_check')) {
      console.log('OK: invalid task_type rejected');
    } else {
      console.error('FAIL: unexpected error: ' + e.message); process.exit(1);
    }
    return pool.end();
  });
"
```

---

## 可选改进

- Feature 1 的 `npx vitest run` 命令：per memory 规则，`npx vitest` 不在 CI 白名单，建议改用 `node --experimental-vm-modules node_modules/.bin/vitest run` 或改为 `npm test -- --testPathPattern=dispatch-task-action`，或使用 `manual:` + `node` 方式直接断言
- migration 文件验证命令可增加对 SQL 语法结构的检查（确认包含 `ALTER TABLE` 和 `schema_version` 插入）
