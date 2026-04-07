# 合同草案（第 1 轮）

## 本次实现的功能

- Feature 1: Dispatch 账号切换为 account1 — 为所有 sprint_* task_type 在 executor 层硬指定 account1，account1 被 spending-capped 时再 fallback 动态选择
- Feature 2: 跨 worktree 文件自动同步 — Brain `preparePrompt` 在派发 sprint_contract_propose / sprint_contract_review 前执行 `git fetch origin`，并把 sprint-prd.md / contract-draft.md 内容直接嵌入 prompt（对 agent 透明）
- Feature 3: task_type 约束 migration 固化 — 新增 migration 219，把 `sprint_report` 和 `cecelia_event` 加入 tasks_task_type_check 枚举约束

---

## 验收标准（DoD）

### Feature 1: Dispatch 账号固定为 account1

- [x] Brain tick 派发 sprint_contract_propose / sprint_contract_review / sprint_generate / sprint_evaluate / sprint_fix / sprint_report 时，executor 日志显示 `CECELIA_CREDENTIALS=account1`
- [x] account1 处于 spending-cap 状态时，executor 正常 fallback 到 `selectBestAccount` 动态选择，不报错不中断

**验证命令**：
```bash
# 验证 executor.js 存在 sprint 类型硬绑定逻辑
node -e "
const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
if (!c.includes('SPRINT_ACCOUNT1_TASK_TYPES') && !c.includes('sprint_contract_propose') || !c.includes('account1')) {
  process.exit(1);
}
console.log('OK: sprint task types hardwired to account1');
"
```

```bash
# 单元测试：sprint task type 走 account1
npx vitest run packages/brain/src/__tests__/dispatch-task-action.test.js
```

---

### Feature 2: 跨 worktree 文件自动嵌入 prompt

- [x] Brain 派发 sprint_contract_propose 时，prompt 中包含 `## sprints/sprint-prd.md` 段，内容来自 git fetch 后的 origin 分支
- [x] 当 sprint-prd.md 在本地 worktree 不存在时（跨 worktree 场景），系统自动 fetch 并读取内容，不输出「找不到文件」错误
- [x] Brain 派发 sprint_contract_review 时，prompt 额外包含 `## sprints/contract-draft.md` 内容

**验证命令**：
```bash
# 验证 preparePrompt 中存在 git fetch + git show 逻辑
node -e "
const c = require('fs').readFileSync('packages/brain/src/executor.js','utf8');
const hasFetch = c.includes('git fetch origin') || c.includes('fetchSprintFiles');
const hasEmbed = c.includes('sprint-prd.md') && (c.includes('git show') || c.includes('sprintPrdContent'));
if (!hasFetch || !hasEmbed) process.exit(1);
console.log('OK: cross-worktree file sync present in preparePrompt');
"
```

---

### Feature 3: sprint_report / cecelia_event migration 固化

- [x] 全新 DB 跑完 migration 219 后，`sprint_report` 和 `cecelia_event` 出现在 tasks_task_type_check 约束的枚举列表中
- [x] 向不在约束内的 task_type 值插入 tasks 记录时，DB 返回 constraint violation 错误（而不是静默接受）

**验证命令**：
```bash
# 验证 migration 文件存在且包含两个类型
node -e "
const c = require('fs').readFileSync('packages/brain/migrations/219_sprint_report_cecelia_event_task_types.sql','utf8');
if (!c.includes('sprint_report')) process.exit(1);
if (!c.includes('cecelia_event')) process.exit(1);
console.log('OK: migration 219 contains sprint_report and cecelia_event');
"
```

```bash
# 验证约束实际生效（需 DB 已跑 migration）
node -e "
const { Pool } = require('pg');
const pool = new Pool({ database: 'cecelia' });
pool.query(\"SELECT constraint_name FROM information_schema.check_constraints WHERE constraint_name = 'tasks_task_type_check'\")
  .then(r => {
    if (r.rows.length === 0) { console.error('constraint missing'); process.exit(1); }
    console.log('OK: constraint exists');
    return pool.end();
  });
"
```

---

## 技术实现方向

### Feature 1 — 文件修改点
- `packages/brain/src/executor.js`
  - 在 `triggerCeceliaRun` 函数的 account 选择逻辑（约 2720 行）之前，新增 sprint task types 数组：
    ```js
    const SPRINT_ACCOUNT1_TASK_TYPES = [
      'sprint_contract_propose', 'sprint_contract_review',
      'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'sprint_report'
    ];
    ```
  - 若 `SPRINT_ACCOUNT1_TASK_TYPES.includes(task.task_type)` 且 account1 未被 spending-cap，则 `extraEnv.CECELIA_CREDENTIALS = 'account1'`，跳过 `selectBestAccount`
  - account1 被 cap 时 fallback 到原有 `selectBestAccount` 逻辑

### Feature 2 — 文件修改点
- `packages/brain/src/executor.js` — `preparePrompt` 函数中：
  - 新增 `async function _fetchSprintFile(branch, filePath)` 辅助函数：先 `git fetch origin`（cwd=WORK_DIR），再 `git show origin/${branch}:${filePath}` 读内容
  - `sprint_contract_propose` 路径：从 `task.payload.planner_branch`（Brain 写入）或 fallback `git show origin/HEAD:sprints/sprint-prd.md` 读取 sprint-prd.md，追加到 prompt
  - `sprint_contract_review` 路径：同上读 sprint-prd.md + contract-draft.md
  - Brain `tick.js` / 任务创建侧在创建 sprint_contract_propose 任务时，将 planner 所在 branch 写入 `payload.planner_branch`

### Feature 3 — 文件修改点
- 新建 `packages/brain/migrations/219_sprint_report_cecelia_event_task_types.sql`
  - 复制 migration 210 的完整枚举列表，追加 `'sprint_report'` 和 `'cecelia_event'` 两个值
  - 包含 `schema_version` 插入记录（version='219'）

---

## 不在本次范围内

- account2 的账号策略调整（只改 account1 优先）
- 新增 sprint 流程阶段或修改 GAN 对抗逻辑
- 其他 task_type 的枚举扩展（只加 sprint_report + cecelia_event）
- 修改 cecelia-run / cecelia-bridge 底层
- UI / Dashboard 层面展示变更
