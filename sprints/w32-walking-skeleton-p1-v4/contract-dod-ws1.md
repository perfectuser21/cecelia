---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: W32 Walking Skeleton P1 终验脚本 + 报告生成器

**范围**: 在 `sprints/w32-walking-skeleton-p1-v4/` 产出 `verify-p1.sh` 和（由它生成的）`p1-final-acceptance.md`；脚本依次完成 POST 创建 Initiative / 错误反向 / 轮询收敛 / 5 API + 2 SQL oracle 采集 / 报告渲染 8 个阶段；不改 `packages/brain/**`。
**大小**: M
**依赖**: 无（B1-B10 已 merge 进 main）

> BEHAVIOR 已全部搬到 `tests/ws1/verify-p1.test.ts`（v5 DoD 纯度规则：本文件只装 [ARTIFACT]，BEHAVIOR 走测试文件）。

## ARTIFACT 条目

- [x] [ARTIFACT] `sprints/w32-walking-skeleton-p1-v4/verify-p1.sh` 文件存在且 chmod +x
  Test: node -e "const fs=require('fs');const st=fs.statSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh');if(!(st.mode & 0o111))process.exit(1)"

- [x] [ARTIFACT] `verify-p1.sh` 内含 `curl -fs -X POST localhost:5221/api/brain/tasks` 创建 harness_initiative 的代码段
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/curl[^\n]+-X\s+POST[^\n]+\/api\/brain\/tasks/.test(c))process.exit(1);if(!/harness_initiative/.test(c))process.exit(1)"

- [x] [ARTIFACT] `verify-p1.sh` 内含 `dispatch/recent?initiative_id=` query 字面（不使用 iid/task/root_id/n 等禁用名）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/dispatch\/recent\?initiative_id=/.test(c))process.exit(1);for(const k of ['?iid=','?task=','?root_id=','?n=','?max=']){if(c.includes('dispatch/recent'+k)){console.error('forbidden query '+k);process.exit(1)}}"

- [x] [ARTIFACT] `verify-p1.sh` 内含 `/api/brain/fleet/slots` 调用 + `in_use == in_progress_task_count` 不变量断言
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/\/api\/brain\/fleet\/slots/.test(c))process.exit(1);if(!/in_use[^\n]*in_progress_task_count/.test(c))process.exit(1)"

- [x] [ARTIFACT] `verify-p1.sh` 内含 SQL `count(DISTINCT thread_id)` 检查 thread 连续性的代码段
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/count\(DISTINCT\s+thread_id\)/i.test(c))process.exit(1)"

- [x] [ARTIFACT] `verify-p1.sh` 内含 SQL `last_heartbeat_at < NOW\(\) - interval '60 minutes'` zombie 反向检查（B8 60min 阈值）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/last_heartbeat_at\s*<\s*NOW\(\)\s*-\s*interval\s*'60 minutes'/.test(c))process.exit(1)"

- [x] [ARTIFACT] `verify-p1.sh` 渲染 `p1-final-acceptance.md` 含 `## Verdict: PASS|FAIL` 字面 + `## Oracle a-g 实测` + `## Anomaly` 三段
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');for(const seg of ['## Verdict:','## Oracle a-g 实测','## Anomaly']){if(!c.includes(seg)){console.error('script missing render of: '+seg);process.exit(1)}}"

- [x] [ARTIFACT] `verify-p1.sh` 不含对 `packages/brain/**` 任何文件的写操作（编辑/sed/cp 输出到 brain 路径）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');for(const pat of [/>\s*packages\/brain/,/sed\s+-i[^\n]*packages\/brain/,/cp\s+[^\n]+\s+packages\/brain/]){if(pat.test(c)){console.error('script writes into packages/brain');process.exit(1)}}"

- [x] [ARTIFACT] `verify-p1.sh` 响应字段名严格字面引用 PRD（含 `status`/`thread_id`/`event_type`/`in_use`/`in_progress_task_count`，不引入禁用同义名）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');for(const k of ['.status','.thread_id','.event_type','.in_use','.in_progress_task_count']){if(!c.includes(k)){console.error('missing literal field '+k);process.exit(1)}}for(const k of ['.state','.task_state','.phase','.stage','.used','.busy','.running_count']){if(c.includes('jq -e \\''+k) || c.includes('jq -e \"'+k)){console.error('forbidden field literal in jq -e: '+k);process.exit(1)}}"

- [x] [ARTIFACT] **R2 新增 — Reviewer R1 修复**：`verify-p1.sh` 含 `tasks/{id}` 响应 `keys | sort == ["id","last_heartbeat_at","parent_task_id","result","status","task_type","thread_id"]` 严等校验字面（捕获 generator 加新字段 / alias 漂移，跟 dispatch/recent 的 `keys == ["count","events"]` 严等同构）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');const need=`keys | sort == [\"id\",\"last_heartbeat_at\",\"parent_task_id\",\"result\",\"status\",\"task_type\",\"thread_id\"]`;if(!c.includes(need)){console.error('verify-p1.sh missing tasks/{id} keys|sort strict equality literal');process.exit(1)}"

- [x] [ARTIFACT] **R2 新增**：`verify-p1.sh` 在 B5 HOL primary check 失败时含 secondary 并发触发逻辑（PRD oracle f 明示路径：未观察到 skipped→dispatched 时主动制造并发场景再测）
  Test: node -e "const c=require('fs').readFileSync('sprints/w32-walking-skeleton-p1-v4/verify-p1.sh','utf8');if(!/HOL_OK/.test(c)){console.error('missing HOL_OK variable');process.exit(1)}if(!/skipped[^\n]+dispatched/.test(c)){console.error('missing skipped/dispatched sequence check');process.exit(1)}"
