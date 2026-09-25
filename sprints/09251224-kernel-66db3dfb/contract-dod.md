---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: runner 原语 task_runs 统一执行留痕 + Notion 投影 + 晨报裸跑检测

**范围**: lib 层 run 原语（唯一写 task_runs 入口）+ 全执行路径/脚本步接入 + notion-push-sync 投影面 + 晨报裸跑 AMBER。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] run 原语模块存在且导出全部入口
  Test: node -e "const m=require('fs').readFileSync('packages/brain/src/lib/task-run.js','utf8'); for(const s of ['startRun','finishRun','findBareRuns','normalizeRunStatus','buildRunContext','buildRunResult','detectBareRuns']){ if(!new RegExp('export (async )?function '+s+'|export const '+s).test(m)) { console.error('缺 '+s); process.exit(1);} } console.log('OK')"

- [ ] [ARTIFACT] migration 466 加 task_runs 三 Notion 记账列（纯 additive，不改 059 现有列）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/466_task_runs_notion_projection.sql','utf8'); for(const col of ['notion_id','notion_synced_at','notion_digest']){ if(!(c.includes(col)&&/ADD COLUMN IF NOT EXISTS/i.test(c))) { console.error('缺 '+col); process.exit(1);} } console.log('OK')"

- [ ] [ARTIFACT] notion-push-sync 定义并接线 pushTaskRuns 投影面
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8'); if(!/async function pushTaskRuns/.test(c)||!/pushTaskRuns\s*\(/.test(c)) process.exit(1); console.log('OK')"

- [ ] [ARTIFACT] 冻结测试与真 PG 集成测试文件存在
  Test: node -e "const f=require('fs'); ['sprints/09251224-kernel-66db3dfb/tests/task-run-primitive.test.js','packages/brain/src/__tests__/integration/task-run-primitive.pg.integration.test.js'].forEach(p=>f.accessSync(p)); console.log('OK')"

## BEHAVIOR 条目（五行剧本，L2 服务端真验；Test 单行调 checks/dod-checks.mjs 真 PG oracle）

- [ ] [BEHAVIOR] [L2] B-01: startRun 落一行 running（含执行路径 context.source）
  动作: 对一个真实 seed task 以 source=dispatcher 调 startRun
  预期观察: task_runs 出现恰好一行，status=running、ended_at 空、context->>'source'=dispatcher
  等待预算: 0s
  留证: dod-checks.mjs b01 stdout（OK: b01）
  Test: manual:bash -c 'node sprints/09251224-kernel-66db3dfb/checks/dod-checks.mjs b01'

- [ ] [BEHAVIOR] [L2] B-02: 同 run_id 重复 startRun 幂等 — 不产生第二行
  动作: 用同一 run_id 连调两次 startRun
  预期观察: 该 run_id 的 task_runs 行数恒为 1（UNIQUE run_id + ON CONFLICT DO NOTHING）
  等待预算: 0s
  留证: dod-checks.mjs b02 stdout（OK: b02）
  Test: manual:bash -c 'node sprints/09251224-kernel-66db3dfb/checks/dod-checks.mjs b02'

- [ ] [BEHAVIOR] [L2] B-03: finishRun 补齐结束时间/exit code/产物引用/终态
  动作: start 后以 status=completed、exit_code=0、artifacts=['pr:1'] 调 finishRun
  预期观察: 同一行补齐 ended_at 非空、status=success、result.exit_code=0、result.artifacts=['pr:1']
  等待预算: 0s
  留证: dod-checks.mjs b03 stdout（OK: b03）
  Test: manual:bash -c 'node sprints/09251224-kernel-66db3dfb/checks/dod-checks.mjs b03'

- [ ] [BEHAVIOR] [L2] B-04: 裸跑检测命中且无误报（有 dispatch_events 无 task_runs = AMBER）[接缝×2]
  动作: 造一个只有 dispatched 事件无 run 的 task 与一个有 run 的 task，调 findBareRuns
  预期观察: 裸跑 task 被检出，有 run 的 task 不被误报
  等待预算: 0s
  留证: dod-checks.mjs b04 stdout（OK: b04）
  Test: manual:bash -c 'node sprints/09251224-kernel-66db3dfb/checks/dod-checks.mjs b04'

- [ ] [BEHAVIOR] [L2] B-05: task_runs 投影记账列存在且 runNotionPushSync 已接 pushTaskRuns
  动作: 查 information_schema 三记账列，并检 notion-push-sync 接线
  预期观察: notion_id/notion_synced_at/notion_digest 三列均存在，pushTaskRuns 已定义且被调用
  等待预算: 0s
  留证: dod-checks.mjs b05 stdout（OK: b05）
  Test: manual:bash -c 'node sprints/09251224-kernel-66db3dfb/checks/dod-checks.mjs b05'

- [ ] [BEHAVIOR] [L2] INV-1: 单一写口（铁律①）— 除 lib/task-run.js 外全仓零 INSERT INTO task_runs
  动作: grep packages/brain/src 全部 .js（排除 lib/task-run.js 与 __tests__）
  预期观察: 无任何执行路径直插 task_runs（违规文件数=0）
  等待预算: 0s
  留证: grep 输出（空）+ echo OK
  Test: manual:bash -c 'BAD=$(grep -rlE "INSERT[[:space:]]+INTO[[:space:]]+task_runs" packages/brain/src --include=*.js | grep -v "src/lib/task-run.js" | grep -v "__tests__" || true); [ -z "$BAD" ] || { echo "FAIL: 绕过唯一写口 $BAD"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-3: DB 为真相源（铁律③）— 已终态 run 再次 finishRun 不覆盖（防伪造终态）
  动作: start → finishRun(failed) → 再 finishRun(success)
  预期观察: status 恒为 failed、ended_at 不被改写（回调丢失/乱序不得伪造 succeeded）
  等待预算: 0s
  留证: dod-checks.mjs inv3 stdout（OK: inv3）
  Test: manual:bash -c 'node sprints/09251224-kernel-66db3dfb/checks/dod-checks.mjs inv3'

## Invariant 覆盖映射（铁律逐条）

- 铁律① 单一写口 → INV-1（上）
- 铁律② 必经留痕（有执行=恰好一行 run，不裸跑）→ N/A：由 B-01（有执行必落 running 行）+ B-04（裸跑检测暴露漏留痕）共同覆盖，不另立条目（避免重复覆盖，B50 精简）
- 铁律③ DB 为真相源（Notion 投影失败不反向抹除/伪造 run 状态）→ INV-3（上，验不覆盖终态）；Notion 投影 fail-open 不回写 run 由「未覆盖真实链路清单」接缝登记（无 token 环境不阻塞）
