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

- [ ] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` 的 reportNode 函数 reportContent 包含 `step_timing` 字段名
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const fn=c.slice(c.indexOf('reportNode'));if(!fn.includes('step_timing'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` 的 reportNode 包含 `ws_issues` 和 `ws_costs` 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const fn=c.slice(c.indexOf('reportNode'));if(!fn.includes('ws_issues')||!fn.includes('ws_costs'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] reportNode 禁用字段 `timings`/`timing`/`issues`/`costs`/`breakdown` 不出现在 reportContent 对象键名中
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const fn=c.slice(c.indexOf('reportNode'),c.indexOf('reportNode')+3000);['timings:','timing:','issues:','costs:','breakdown:'].forEach(k=>{if(fn.includes(k)){console.error('FAIL: 禁用字段',k);process.exit(1);}});console.log('OK')"

- [ ] [ARTIFACT] reportNode 使用 `report_content` 键（而非 `report_path`）写入 tasks.result
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');const fn=c.slice(c.indexOf('reportNode'),c.indexOf('reportNode')+3000);if(!fn.includes('report_content')){console.error('FAIL: 未使用 report_content 键');process.exit(1)}if(fn.includes('report_path')){console.error('FAIL: 残留 report_path 歧义字段名');process.exit(1)}console.log('OK')"

---

## BEHAVIOR 条目

> **验证命令统一使用** `result->'report_content'`（JSONB path，不是 `->>`），psql 输出即可直接 pipe 到 jq。

- [ ] [BEHAVIOR] reportNode 完成后 `tasks.result->'report_content'` 含顶层字段 `step_timing` 为 array 类型
  Test: manual:bash -c 'REPORT=$(psql $DB -t -c "SELECT result->'"'"'report_content'"'"' FROM tasks WHERE task_type='"'"'harness_initiative'"'"' AND status='"'"'completed'"'"' AND result->'"'"'report_content'"'"' IS NOT NULL ORDER BY completed_at DESC LIMIT 1" | tr -d " \n"); if [ -z "$REPORT" ]; then echo "SKIP: 无已完成 initiative 含 report_content"; exit 0; fi; echo "$REPORT" | jq -e '"'"'.step_timing | type == "array"'"'"' && echo OK || exit 1'
  期望: OK 或 SKIP

- [ ] [BEHAVIOR] `tasks.result->'report_content'` 含顶层字段 `ws_issues` 为 array，元素结构含 `ws_id`/`feedback`/`ci_fail_type`
  Test: manual:bash -c 'REPORT=$(psql $DB -t -c "SELECT result->'"'"'report_content'"'"' FROM tasks WHERE task_type='"'"'harness_initiative'"'"' AND status='"'"'completed'"'"' AND result->'"'"'report_content'"'"' IS NOT NULL ORDER BY completed_at DESC LIMIT 1" | tr -d " \n"); if [ -z "$REPORT" ]; then echo "SKIP"; exit 0; fi; echo "$REPORT" | jq -e '"'"'.ws_issues | type == "array"'"'"' && echo "$REPORT" | jq -e '"'"'if (.ws_issues | length) > 0 then .ws_issues[0] | has("ws_id") and has("feedback") and has("ci_fail_type") else true end'"'"' && echo OK || exit 1'
  期望: OK 或 SKIP

- [ ] [BEHAVIOR] `tasks.result->'report_content'` 含顶层字段 `ws_costs` 为 array，元素结构含 `ws_id`/`cost_usd`
  Test: manual:bash -c 'REPORT=$(psql $DB -t -c "SELECT result->'"'"'report_content'"'"' FROM tasks WHERE task_type='"'"'harness_initiative'"'"' AND status='"'"'completed'"'"' AND result->'"'"'report_content'"'"' IS NOT NULL ORDER BY completed_at DESC LIMIT 1" | tr -d " \n"); if [ -z "$REPORT" ]; then echo "SKIP"; exit 0; fi; echo "$REPORT" | jq -e '"'"'.ws_costs | type == "array"'"'"' && echo "$REPORT" | jq -e '"'"'if (.ws_costs | length) > 0 then .ws_costs[0] | has("ws_id") and has("cost_usd") else true end'"'"' && echo OK || exit 1'
  期望: OK 或 SKIP

- [ ] [BEHAVIOR] `tasks.result->'report_content'` 不含禁用字段 `timings`/`timing`/`issues`/`costs`/`breakdown`
  Test: manual:bash -c 'REPORT=$(psql $DB -t -c "SELECT result->'"'"'report_content'"'"' FROM tasks WHERE task_type='"'"'harness_initiative'"'"' AND status='"'"'completed'"'"' AND result->'"'"'report_content'"'"' IS NOT NULL ORDER BY completed_at DESC LIMIT 1" | tr -d " \n"); if [ -z "$REPORT" ]; then echo "SKIP"; exit 0; fi; echo "$REPORT" | jq -e '"'"'has("timings") | not'"'"' && echo "$REPORT" | jq -e '"'"'has("timing") | not'"'"' && echo "$REPORT" | jq -e '"'"'has("issues") | not'"'"' && echo "$REPORT" | jq -e '"'"'has("costs") | not'"'"' && echo "$REPORT" | jq -e '"'"'has("breakdown") | not'"'"' && echo OK || exit 1'
  期望: OK 或 SKIP

- [ ] [BEHAVIOR] `step_timing` 数组元素（有数据时）每条含 `node`/`duration_ms` 字段
  Test: manual:bash -c 'REPORT=$(psql $DB -t -c "SELECT result->'"'"'report_content'"'"' FROM tasks WHERE task_type='"'"'harness_initiative'"'"' AND status='"'"'completed'"'"' AND result->'"'"'report_content'"'"' IS NOT NULL ORDER BY completed_at DESC LIMIT 1" | tr -d " \n"); if [ -z "$REPORT" ]; then echo "SKIP"; exit 0; fi; TLEN=$(echo "$REPORT" | jq ".step_timing | length"); if [ "$TLEN" = "0" ]; then echo "SKIP: step_timing empty"; exit 0; fi; echo "$REPORT" | jq -e '"'"'.step_timing[0] | has("node") and has("duration_ms")'"'"' && echo OK || exit 1'
  期望: OK 或 SKIP

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] evaluator 验收后截图存 screenshots/ws4-01.png，复制到 ~/claude-output/harness-screenshots/
  Screenshots:
    - ws4-01.png   期望：reportNode 增强后，完成的 initiative 详情面板可见 step_timing 区块（通过 /detail API 数据驱动），面板展示至少 1 条时间线条目
  期望：find ~/claude-output/harness-screenshots/ -name "ws4-*.png" 返回 ≥ 1 条
