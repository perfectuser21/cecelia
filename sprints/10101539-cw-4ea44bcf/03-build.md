---
task_id: 4ea44bcf-780b-41e2-b150-299f1a7a5bd7
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 构建记录：strategic-decisions 非法 category 返回 400

### B-1
- 对应：S-1
- 改动文件：新增 `packages/brain/src/decision-categories.js`（`DECISION_CATEGORIES` 冻结 13 值，同 migration 384 顺序；`DEFAULT_DECISION_CATEGORY='decision'`；`isValidDecisionCategory`；`DECISION_MADE_BY`、`DECISION_PRIORITIES` 冻结数组，同 migration 193）
- 新增测试：由 B-3 的漂移守卫与常量用例覆盖
- 测试命令：`node -e "import('./packages/brain/src/decision-categories.js').then(m=>{...})"` → `S-1 exit=0`
- 提交：8e2a8b363（与 B-3 测试同一提交）

### B-2
- 对应：S-2
- 改动文件：`packages/brain/src/routes/strategic-decisions.js`
  - import 常量模块，删除 `'general'` 字面量；category 为 undefined/null/'' 时写 `decision`
  - 非法 category → 400 + `allowed_categories`；非法 made_by → 400 + `allowed_made_by`；非法 priority → 400 + `allowed_priorities`，均在写库前 return
  - catch：`err.code==='23514'` → 400 `字段 <field> 取值不符合约束`（约束名→字段固定映射，查不到写「未知」）；其它异常 → 500 `创建决策失败`；原文只进 console.error
  - GET/PUT 不改
- 测试命令：`cd packages/brain && npx vitest run src/routes/strategic-decisions.test.js src/routes/__tests__/strategic-decisions-category.test.js src/routes/__tests__/strategic-decisions-source-ref.test.js` → `Test Files 3 passed (3) / Tests 27 passed (27)`
- grep 校验：`grep -n "'general'" src/routes/strategic-decisions.js` 无输出；`err.message` 在 POST 段只出现在第 137 行 `console.error`
- 提交：dafc4d683

### B-3
- 对应：S-3
- 新增测试：`packages/brain/src/routes/__tests__/strategic-decisions-category.test.js`（vitest + supertest，mock `../../db.js`，共 19 个用例）：非法 category 400 + 不泄露约束名 + 未写库；大小写/前导空格/数字/数组/对象/10000 字符 6 种输入 400；缺省/null/'' → 201 写 `decision`；`judgment` 原样写入；23514 → 400 只给字段名；未知约束 → 「未知」；普通异常 → 500 不含 `boom SQL`；`made_by:'ai'` 400、`system` 201；`priority:'P9'` 400；migration 384/193 漂移守卫；常量冻结与大小写敏感
- 红灯（路由未改时）：`npx vitest run src/routes/__tests__/strategic-decisions-category.test.js` → `Tests 15 failed | 4 passed (19)`（失败的是全部路由行为用例，通过的是 4 个常量/漂移用例）
- 绿灯（B-2 后）：同一命令包含在 B-2 的 27 passed 中，全绿
- 提交：8e2a8b363（测试提交在实现提交 dafc4d683 之前）

### B-4
- 对应：S-4
- 改动文件：
  - `packages/brain/scripts/coding-workflow/activities/spec-review.mjs`：`made_by:'ai'` → `'system'`
  - `packages/brain/scripts/coding-workflow/__tests__/spec-review.test.mjs`：判定点写库断言 `objectContaining` 加 `made_by:'system'`
  - `packages/quality/tests/api/cross-package-integration.test.ts`：`category:'test'` → `'testing'`
  - `apps/api/features/knowledge/pages/DecisionRegistry.tsx`：默认 category 改为 `''`；占位文案改为「留空即 decision」；submit 检查 `res.ok`，非 2xx 时在弹窗内显示服务端 `error`，不调用 onCreated/onClose，finally 复位 saving；不在前端抄允许列表
- 红→绿：spec-review.mjs 临时恢复 `'ai'` 跑 `npx vitest run scripts/coding-workflow/__tests__/spec-review.test.mjs` → `1 failed | 17 passed (18)`；改回 `'system'` → `18 passed (18)`
- 类型检查：`cd apps/api && npx --no-install tsc --noEmit -p .`（tsc 5.9.3）无输出、无报错
- 全仓 grep 核对清单（`grep -rn "strategic-decisions" packages apps scripts`，含 *.md）：
  | 调用方 | 字面量 | 结论 |
  |---|---|---|
  | spec-review.mjs:70-77 | category judgment / made_by ai | 已改 system |
  | cross-package-integration.test.ts:179 | category test | 已改 testing |
  | DecisionRegistry.tsx | 默认 general | 已改 ''（服务端缺省 decision） |
  | harness-contract-reviewer/SKILL.md:459 | judgment / cecelia | 合法，未改 |
  | learning-loop.integration.test.js:108 | deployment / P2 | 合法 |
  | decisions-lifecycle.integration.test.js | testing / P2 / user | 合法 |
  | decisions-api-chain.test.js | architecture / user / P1 | 合法 |
- 提交：2dda33497

### B-5
- 对应：S-5
- 命令与结果：
  - `node scripts/facts-check.mjs` → exit 0，`All facts consistent.`
  - `bash scripts/check-version-sync.sh` → exit 0，`All version files in sync`
  - `node packages/quality/scripts/devgate/check-dod-mapping.cjs` → exit 0，`映射检查通过 (292 项)`
- 未改 DEFINITION.md
- 汇总回归：`npx vitest run src/routes/strategic-decisions.test.js src/routes/__tests__/strategic-decisions-category.test.js src/routes/__tests__/strategic-decisions-source-ref.test.js src/__tests__/decisions-api-chain.test.js scripts/coding-workflow/__tests__/spec-review.test.mjs` → `Test Files 5 passed (5) / Tests 60 passed (60)`
- 附注：跑 `npx vitest run src/routes` 整目录时 `src/routes/__tests__/preview.test.js` 8 例失败（均为 `expected 401 to be ...`，本机鉴权环境导致），该文件与 preview.js 均不涉及 decisions，与本改动无关
- 改动规模：相对 main `7 files changed, 262 insertions(+), 13 deletions(-)`
- 提交：无（仅验证）
