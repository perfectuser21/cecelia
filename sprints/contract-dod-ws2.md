# Contract DoD — Workstream 2: F3 回血回填（callback → KR +1%）

**范围**: 在 `progress-reviewer.js` 新增 thin 计数函数 `incrementKRProgressByOnePercent(krId)`（**单语句原子 SQL** 自增 + 100 封顶）；`callback-processor.js` 在 task=completed + pr_url + kr_id 三齐全时调用一次，且对重复 callback **幂等短路**（DB 中 task.status 已是 completed → 不再调用）。
**大小**: S
**依赖**: 无

**Round 2 修订**: 补"单语句原子 SQL（含 LEAST(...,100)）"与"callback 幂等短路文本"两条 ARTIFACT。

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/progress-reviewer.js` 命名导出 `incrementKRProgressByOnePercent`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/progress-reviewer.js','utf8');if(!/export\s+(async\s+)?function\s+incrementKRProgressByOnePercent\b/.test(c)&&!/export\s*\{[^}]*\bincrementKRProgressByOnePercent\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/src/callback-processor.js` 引用 `incrementKRProgressByOnePercent`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/callback-processor.js','utf8');if(!c.includes('incrementKRProgressByOnePercent'))process.exit(1)"

- [ ] [ARTIFACT] progress-reviewer.js 中 incrementKRProgressByOnePercent 实现使用单语句原子 SQL（含 `LEAST(` + 100 封顶）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/progress-reviewer.js','utf8');const m=c.match(/incrementKRProgressByOnePercent[\s\S]{0,1500}?\n\}/);if(!m)process.exit(1);const seg=m[0];if(!/LEAST\s*\(/i.test(seg))process.exit(1);if(!/100/.test(seg))process.exit(1);if(!/UPDATE/i.test(seg))process.exit(1)"

- [ ] [ARTIFACT] callback-processor.js 含幂等短路逻辑（DB 中 task.status 已是 completed 时 short-circuit）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/callback-processor.js','utf8');if(!/already.*completed|already_completed|status\s*===\s*['\"]completed['\"]/i.test(c))process.exit(1);if(!/return\b/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/callback-kr-update.test.ts`，覆盖：
- progress-reviewer.js 导出 incrementKRProgressByOnePercent
- completed task with kr_id (kr at 50) → KR progress 升至 51
- completed task with kr_id (kr at 100) → KR progress 仍为 100，不溢出
- completed task with kr_id (kr at 99) → KR progress 升至 100
- completed task without kr_id → 不调用 incrementKRProgressByOnePercent
- completed task without pr_url → 不调用 incrementKRProgressByOnePercent
- callback-processor 在 task=completed + pr_url + kr_id 三齐全时调用 incrementKRProgressByOnePercent 一次
- incrementKRProgressByOnePercent 使用单语句原子 SQL（Round 2 新增）
- 两次并发调用触发两条独立 UPDATE 调用（Round 2 新增）
- callback 重放幂等：DB 中 task.status 已是 completed → 不再调用（Round 2 新增）
