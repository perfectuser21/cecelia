---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: reportNode 增强

**范围**: `packages/brain/src/workflows/harness-initiative.graph.js` `reportNode` 函数 — reportContent JSON 新增 `step_timing`/`ws_issues`/`ws_costs` 三字段
**大小**: S（50-70 行）
**依赖**: Workstream 3 完成后

---

## 存储语义声明（v7.8 Round 2 修正 — 消除 report_path 歧义）

> **reportNode 报告的存储模型**：`reportNode` 函数在内存中构建 reportContent JSON 对象，通过以下 SQL 持久化到 `tasks.result` 列：
>
> ```sql
> UPDATE tasks SET result = jsonb_set(COALESCE(result, '{}'), '{report_content}', $1::jsonb) WHERE id = $2
> ```
>
> - `tasks.result` 是 JSONB 列
> - `report_content` 是嵌套在 `result` 内的 **JSONB 对象**（不是文件路径，不是字符串，不需要 JSON.parse）
> - SQL 访问：`result->'report_content'`（返回 JSONB）
> - 禁止：`result->>'report_content'`（返回字符串需二次 parse，易错）
> - 禁止：用文件路径替代（生成报告文件后把路径写入 `result->>'report_path'` — 这是 Round 1 歧义根因）
>
> **Generator 必须按此模型实现，否则 BEHAVIOR 验证命令直接 FAIL**。

---

## Risks

### R4a: harness-initiative.graph.js 导出函数名与 ARTIFACT 检测不一致
**影响**: ARTIFACT 条目用 `c.indexOf('export async function reportNode')` 定位函数，若函数名为 `report` 或 `buildReport`，ARTIFACT FAIL。
**缓解**: Generator 必须使用 `reportNode` 作为函数名（合同规定，与 PRD 描述一致）；ARTIFACT 检测字符串不变。

### R4b: 实现为文件路径写法导致 jq 解析失败
**影响**: 若 Generator 误将报告写入文件（如 `/tmp/report-${taskId}.json`）后把路径字符串存入 `result->>'report_path'`，BEHAVIOR 命令 `SELECT result->'report_content'` 返回 NULL，管道为空，jq 报 "null (null) and null cannot be added" 类错误 → FAIL。
**缓解**: 本 DoD 的存储语义声明段已明确禁止文件路径模式；BEHAVIOR 1 的 IS NOT NULL 过滤器会将 NULL 情况提前暴露为 SKIP（而非 jq 崩溃）。

---

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` 的 reportNode 函数 reportContent 包含 `step_timing` 字段名
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const fn=c.slice(c.indexOf('reportNode'));if(!fn.includes('step_timing'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` 的 reportNode 包含 `ws_issues` 和 `ws_costs` 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const fn=c.slice(c.indexOf('reportNode'));if(!fn.includes('ws_issues')||!fn.includes('ws_costs'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] reportNode 禁用字段 `timings`/`timing`/`issues`/`costs`/`breakdown` 不出现在 reportContent 对象键名中
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const fn=c.slice(c.indexOf('reportNode'),c.indexOf('reportNode')+3000);['timings:','timing:','issues:','costs:','breakdown:'].forEach(k=>{if(fn.includes(k)){console.error('FAIL: 禁用字段',k);process.exit(1);}});console.log('OK')"

- [x] [ARTIFACT] reportNode 使用 `report_content` 键（而非 `report_path`）写入 tasks.result
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const fn=c.slice(c.indexOf('reportNode'),c.indexOf('reportNode')+3000);if(!fn.includes('report_content')){console.error('FAIL: 未使用 report_content 键');process.exit(1)}if(fn.includes('report_path')){console.error('FAIL: 残留 report_path 歧义字段名');process.exit(1)}console.log('OK')"

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] evaluator 验收后截图存 screenshots/ws4-01.png，复制到 ~/claude-output/harness-screenshots/
  Screenshots:
    - ws4-01.png   期望：reportNode 增强后，完成的 initiative 详情面板可见 step_timing 区块（通过 /detail API 数据驱动），面板展示至少 1 条时间线条目
  期望：find ~/claude-output/harness-screenshots/ -name "ws4-*.png" 返回 ≥ 1 条
