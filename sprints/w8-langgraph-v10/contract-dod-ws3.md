---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: 验证报告渲染器

**范围**: `scripts/render-report.sh` + 阶段耗时聚合 lib，从 brain_tasks 抽取数据填充 markdown 模板
**大小**: S
**依赖**: Workstream 2（复用 PG 查询 lib）

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/scripts/render-report.sh` 存在且可执行，接受 `$1=initiative_id` CLI 参数
  Test: node -e "const fs=require('fs');const s=fs.statSync('sprints/w8-langgraph-v10/scripts/render-report.sh');if(!(s.mode & 0o111))process.exit(1);const c=fs.readFileSync('sprints/w8-langgraph-v10/scripts/render-report.sh','utf8');if(!c.includes('verification-report.md'))process.exit(2)"

- [ ] [ARTIFACT] `sprints/w8-langgraph-v10/lib/render-report.cjs` 导出 `aggregatePhaseDurations`、`renderMarkdown` 两个函数
  Test: node -e "const m=require('./sprints/w8-langgraph-v10/lib/render-report.cjs');for(const k of ['aggregatePhaseDurations','renderMarkdown']){if(typeof m[k]!=='function')process.exit(1)}"

- [ ] [ARTIFACT] 报告模板片段（在 render-report.cjs 内或独立文件）含必备 4 段：起止时间块、各阶段耗时表、子任务列表表、最终 SQL 输出代码块
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v10/lib/render-report.cjs','utf8');for(const k of ['起始时间','结束时间','Planner','Contract GAN','Generator','Evaluator']){if(!c.includes(k))process.exit(1)}"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/render-report.test.ts`，覆盖：
- aggregatePhaseDurations() 输入子任务行数组，按 task_type 分桶聚合 (created_at→completed_at) 耗时
- renderMarkdown() 输出含 `| Planner ... |`、`| Contract GAN ... |`、`| Generator ... |`、`| Evaluator ... |` 四行表格
- renderMarkdown() 在缺失某阶段子任务时仍渲染该行（值为 `N/A` 或 0），不丢段
