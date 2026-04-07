# 合同草案（第 2 轮）

## 本次实现的功能

- Feature 1: Dispatch 账号切换为 account1 — 为所有 sprint_* task_type 在 executor 层硬指定 account1，account1 被 spending-capped 时 fallback 到 selectBestAccount 动态选择
- Feature 2: 跨 worktree 文件自动同步 — Brain `preparePrompt` 在派发 sprint_contract_propose / sprint_contract_review 前执行 `git fetch origin`，用 `git show origin/<branch>:<path>` 读取文件内容直接嵌入 prompt（对 agent 透明）
- Feature 3: task_type 约束 migration 固化 — 新增 migration 219，把 `sprint_report` 和 `cecelia_event` 加入 tasks_task_type_check 枚举约束

---

## 验收标准（DoD）

### Feature 1: Dispatch 账号固定为 account1

- [x] Brain tick 派发 sprint_contract_propose / sprint_contract_review / sprint_generate / sprint_evaluate / sprint_fix / sprint_report 时，executor 使用 account1 凭据
- [x] account1 处于 spending-cap 状态时，executor 正常 fallback 到 `selectBestAccount` 动态选择，不报错不中断

**验证命令**：
```bash
# 验证 executor.js 存在 sprint 类型数组声明 + account1 凭据赋值（regex 精确匹配）
node -e "
const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
const hasTypes = /SPRINT_ACCOUNT1_TASK_TYPES\s*=\s*\[/.test(c);
const hasAssign = /CECELIA_CREDENTIALS\s*=\s*['\"]account1['\"]/.test(c);
if (!hasTypes) { console.error('FAIL: SPRINT_ACCOUNT1_TASK_TYPES array not found'); process.exit(1); }
if (!hasAssign) { console.error('FAIL: CECELIA_CREDENTIALS = account1 assignment not found'); process.exit(1); }
console.log('OK: sprint task types hardwired to account1');
"
```

```bash
# 验证 spending-cap fallback 逻辑存在
node -e "
const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
const hasFallback = c.includes('selectBestAccount') && /spending.?[Cc]ap|spendingCap/.test(c);
if (!hasFallback) { console.error('FAIL: spending-cap fallback to selectBestAccount not found'); process.exit(1); }
console.log('OK: spending-cap fallback to selectBestAccount exists');
"
```

---

### Feature 2: 跨 worktree 文件自动嵌入 prompt

- [x] Brain 派发 sprint_contract_propose 时，prompt 中包含 `## sprints/sprint-prd.md` 段，内容来自 git fetch 后的 origin 分支
- [x] Brain 派发 sprint_contract_review 时，prompt 额外包含 `## sprints/contract-draft.md` 内容
- [x] 当文件在本地 worktree 不存在时（跨 worktree 场景），系统通过 `git fetch origin` + `git show origin/<branch>:<path>` 自动获取，不输出「找不到文件」错误

**验证命令**：
```bash
# 验证 sprint-prd.md 嵌入逻辑存在
node -e "
const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
const hasPrd = c.includes('sprint-prd.md') && (c.includes('git show') || c.includes('sprintPrdContent'));
if (!hasPrd) { console.error('FAIL: sprint-prd.md embed logic not found'); process.exit(1); }
console.log('OK: sprint-prd.md embed logic present');
"
```

```bash
# 验证 contract-draft.md 嵌入逻辑存在（R1 遗漏项）
node -e "
const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
const hasDraft = c.includes('contract-draft.md') && (c.includes('git show') || c.includes('contractDraftContent'));
if (!hasDraft) { console.error('FAIL: contract-draft.md embed logic not found'); process.exit(1); }
console.log('OK: contract-draft.md embed logic present');
"
```

```bash
# 验证跨 worktree 核心机制：git fetch origin + git show origin/ 路径（本地无文件场景）
node -e "
const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
const hasFetch = /git fetch origin/.test(c);
const hasShow = /git show origin\//.test(c);
if (!hasFetch) { console.error('FAIL: git fetch origin not found'); process.exit(1); }
if (!hasShow) { console.error('FAIL: git show origin/ not found'); process.exit(1); }
console.log('OK: git fetch origin + git show origin/ present for cross-worktree file access');
"
```

---

### Feature 3: sprint_report / cecelia_event migration 固化

- [x] migration 219 文件存在，包含 `sprint_report` 和 `cecelia_event` 两个 task_type 值
- [x] 全新 DB 跑完 migration 219 后，`sprint_report` 和 `cecelia_event` 出现在 tasks_task_type_check 约束的枚举列表中
- [x] 向不在约束内的 task_type 值插入 tasks 记录时，DB 返回 constraint violation 错误（而不是静默接受）

**验证命令**：
```bash
# 验证 migration 文件存在且包含两个类型
node -e "
const c = require('fs').readFileSync('packages/brain/migrations/219_sprint_report_cecelia_event_task_types.sql','utf8');
if (!c.includes('sprint_report')) { console.error('FAIL: sprint_report not in migration'); process.exit(1); }
if (!c.includes('cecelia_event')) { console.error('FAIL: cecelia_event not in migration'); process.exit(1); }
console.log('OK: migration 219 contains sprint_report and cecelia_event');
"
```

```bash
# 验证约束枚举值实际包含目标类型（需 DB 已跑 migration）— 读取约束定义内容而非只检查约束名
node -e "
const { Pool } = require('pg');
const pool = new Pool({ database: 'cecelia' });
pool.query(\"SELECT pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conname = 'tasks_task_type_check'\")
  .then(r => {
    if (r.rows.length === 0) { console.error('FAIL: constraint tasks_task_type_check missing'); process.exit(1); }
    const def = r.rows[0].def;
    if (!def.includes('sprint_report')) { console.error('FAIL: sprint_report not in constraint def'); process.exit(1); }
    if (!def.includes('cecelia_event')) { console.error('FAIL: cecelia_event not in constraint def'); process.exit(1); }
    console.log('OK: constraint includes sprint_report and cecelia_event');
    return pool.end();
  })
  .catch(e => { console.error(e.message); process.exit(1); });
"
```

```bash
# 负向测试：插入非法 task_type 必须被 DB 拒绝（R1 完全缺失项）
node -e "
const { Pool } = require('pg');
const pool = new Pool({ database: 'cecelia' });
pool.query(\"INSERT INTO tasks (task_type, status, title) VALUES ('__invalid_type_xyz__', 'pending', 'test')\")
  .then(() => {
    console.error('FAIL: invalid task_type was NOT rejected by DB');
    process.exit(1);
  })
  .catch(e => {
    if (e.message.includes('violates check constraint') || e.message.includes('tasks_task_type_check')) {
      console.log('OK: invalid task_type correctly rejected by DB constraint');
      pool.end();
    } else {
      console.error('FAIL: unexpected error:', e.message);
      process.exit(1);
    }
  });
"
```

---

## 技术实现方向

### Feature 1 — 文件修改点
- `packages/brain/src/executor.js`
  - 在 `triggerCeceliaRun` account 选择逻辑前新增：
    ```js
    const SPRINT_ACCOUNT1_TASK_TYPES = [
      'sprint_contract_propose', 'sprint_contract_review',
      'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'sprint_report'
    ];
    ```
  - 若 `SPRINT_ACCOUNT1_TASK_TYPES.includes(task.task_type)` 且 account1 未 spending-cap → `extraEnv.CECELIA_CREDENTIALS = 'account1'`，跳过 `selectBestAccount`
  - account1 spending-cap 时 fallback 到原有 `selectBestAccount` 逻辑（条件分支，非移除）

### Feature 2 — 文件修改点
- `packages/brain/src/executor.js` — `preparePrompt` 函数中：
  - 新增 `async function _fetchSprintFile(branch, filePath)`: `git fetch origin`（cwd=WORK_DIR）→ `git show origin/${branch}:${filePath}` 读内容，返回字符串
  - `sprint_contract_propose`：读 `sprints/sprint-prd.md`，以 `## sprints/sprint-prd.md\n${content}` 追加到 prompt
  - `sprint_contract_review`：同上读 `sprint-prd.md` + `contract-draft.md`，均追加到 prompt
  - Brain 创建 sprint_contract_propose 任务时，将 planner 所在 branch 写入 `payload.planner_branch`

### Feature 3 — 文件修改点
- 新建 `packages/brain/migrations/219_sprint_report_cecelia_event_task_types.sql`
  - 复制 migration 210 完整枚举列表，追加 `'sprint_report'`、`'cecelia_event'`
  - 包含 `schema_version` 插入记录（version='219'）

---

## 不在本次范围内

- account2 的账号策略调整
- 新增 sprint 流程阶段或修改 GAN 对抗逻辑
- 其他 task_type 的枚举扩展
- 修改 cecelia-run / cecelia-bridge 底层
- UI / Dashboard 层面展示变更
