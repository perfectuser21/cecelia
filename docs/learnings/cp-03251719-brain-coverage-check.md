# Learning: 扩展 check-coverage-completeness 覆盖 Brain 代码

## 根本原因

`check-coverage-completeness.mjs` 只扫描 Engine 自身，不感知 Brain 的 151 个 src/*.js 文件。CI 对 Brain 测试覆盖率盲区一无所知，高风险模块（tick/thalamus/executor/cortex/planner）缺测试不会阻断 CI。

## 解决方案

在 `check-coverage-completeness.mjs` 新增 Check 4：
- `HIGH_RISK_BRAIN_MODULES = new Set(['tick','thalamus','executor','cortex','planner'])`
- `checkBrainCoverage(brainRoot)` 函数：扫描 `{brainRoot}/src/*.js`，对应测试路径为 `src/__tests__/MODULE*.test.js`（前缀匹配）
- 高风险模块缺测试 → `missingRequired` → exit 1；其余 → `missingOptional` → warning

## 关键技术细节

**前缀匹配规则**：`executor.js` 被 `executor-billing.test.js` 覆盖，规则为 `t === src || t.startsWith(src + '-') || t.startsWith(src + '.')`。

**DoD Test: 字段格式教训**：
- ❌ 错误：`Test: tests/devgate/check-coverage-completeness.test.ts`（相对于 git root，文件不在那里）
- ✅ 正确：`Test: manual:node -e "require('fs').accessSync('packages/engine/tests/devgate/...')"`
- check-dod-mapping.cjs 的 `validateTestRef()` 把 `tests/xxx` 路径解析为 `{gitRoot}/tests/xxx`，但 Engine 测试在 `packages/engine/tests/`，因此必须用 `manual:` 格式 + 完整路径

## 下次预防

- [ ] 写 Engine 测试路径相关 DoD 时，直接用 `manual:node -e "require('fs').accessSync('packages/engine/tests/...')"` 格式
- [ ] 参考最近合并 PR 的 task card（`git show <SHA>:.task-xxx.md`）确认 Test: 格式
- [ ] Brain 高风险模块测试完整性现在由 CI Check 4 保障，不会再有盲区
