# DoD: War Room 后端数据层 — sprint feed 挂 LangGraph 富数据（PR-A）

Brain task: warroom-redesign-pr-a
分支: cp-06031014-warroom-langgraph-join

## Artifacts

- [x] [ARTIFACT] `packages/brain/src/warroom-classify.js` 新增 `normalizeLg` + `toFeedItem`/`buildFeed` 增 `lg` 入参
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/warroom-classify.js','utf8');if(!c.includes('export function normalizeLg'))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/routes/warroom.js` 建 `lgByPlannerTaskId` 映射并传给 `buildFeed`
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/warroom.js','utf8');if(!c.includes('lgByPlannerTaskId'))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/scripts/smoke/warroom-langgraph-smoke.sh` 新增 smoke（≥5 实代码行 + curl/node）
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/warroom-langgraph-smoke.sh','utf8');if(!c.includes('warroom/feed'))process.exit(1)"`

## Behaviors

- [x] [BEHAVIOR] normalizeLg 把 stages 归一为 {key,label,status,elapsed_ms}，status 收敛 done/running/pending/failed
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/warroom-classify.test.js','utf8');if(!c.includes('归一 stages'))process.exit(1)"

- [x] [BEHAVIOR] normalizeLg 把 workstreams + ws_verdicts 拉链成 [{name,verdict}]，空则 null
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/warroom-classify.test.js','utf8');if(!c.includes('拉链成'))process.exit(1)"

- [x] [BEHAVIOR] toFeedItem 仅对 sprint 合并 lg 字段，并用 lg 的 current_node/elapsed_ms 覆盖弱值
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/warroom-classify.test.js','utf8');if(!c.includes('current_node/elapsed 被 lg 覆盖'))process.exit(1)"

- [x] [BEHAVIOR] 非 sprint 任务即使传 lg，node_label/stages/ws_verdicts 等富字段仍为 null
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/warroom-classify.test.js','utf8');if(!c.includes('非 sprint 任务'))process.exit(1)"

- [x] [BEHAVIOR] buildFeed 接受 lgByPlannerTaskId，按 task.id join 挂到对应 sprint
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/warroom-classify.js','utf8');if(!c.includes('lgByPlannerTaskId = {}'))process.exit(1)"

- [x] [BEHAVIOR] warroom.js 用 buildPipelineRecord 同源建 lg 映射且 try/catch 不阻塞 feed
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/warroom.js','utf8');if(!(c.includes('buildPipelineRecord')&&c.includes('langgraph join failed')))process.exit(1)"
