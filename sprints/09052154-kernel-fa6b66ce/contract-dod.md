---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 四格路由器（task 入口 artifact_kind + answer_known + routed_lane）

**范围**: POST /api/brain/tasks 入口新增 artifact_kind（规则）+ answer_known（一次 LLM）两维分类，四格 → routed_lane 路由，三字段落 tasks.payload；最近 30 真实任务分格完备准确率报告。不含下游各 lane 实现、skill 蒸馏、registry 固化、历史回填。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 回放脚本存在且查真实任务 + 调四格路由函数
  Test: node -e "const c=require('fs').readFileSync('sprints/09052154-kernel-fa6b66ce/replay-four-lane-accuracy.mjs','utf8');if(!c.includes('routeFourQuadrant')||!c.includes('FROM tasks'))process.exit(1)"

- [ ] [ARTIFACT] 冻结合同测试存在且覆盖四格互斥完备
  Test: node -e "const c=require('fs').readFileSync('sprints/09052154-kernel-fa6b66ce/tests/four-lane-router.test.ts','utf8');if(!c.includes('routeFourQuadrant')||!c.includes('judgeAnswerKnown'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 创建任务后响应含三字段且取值合法（真 Brain + 真 LLM 一次）
  动作: 调 POST /api/brain/tasks 创建一个 code 类任务（task_type=dev, change_kind=code）
  预期观察: 返回体含 artifact_kind∈{code,execution}、answer_known∈{true,false}（真实一次 LLM 判定产生）
  等待预算: 30s（LLM 判定含超时兜底，须在预算内返回）
  留证: curl | jq 命令输出（exit 0）
  Test: manual:bash -c 'curl -sf -X POST http://localhost:5221/api/brain/tasks -H "content-type: application/json" -d "{\"title\":\"four-lane dod b01 $RANDOM-$(date +%s)\",\"description\":\"fix retry and implement\",\"task_type\":\"dev\",\"change_kind\":\"code\"}" | jq -e "(.artifact_kind==\"code\" or .artifact_kind==\"execution\") and (.answer_known==true or .answer_known==false)"'

- [ ] [BEHAVIOR] [L2] B-02: 三字段真落库 tasks.payload（5 分钟时间窗防历史冒充）
  动作: 创建任务后按返回 id 查真库 tasks.payload
  预期观察: payload 同时含 artifact_kind / answer_known / routed_lane 三键，且 created_at 在近 5 分钟内
  等待预算: 30s
  留证: psql count 输出（=1）
  Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; RESP=$(curl -sf -X POST http://localhost:5221/api/brain/tasks -H "content-type: application/json" -d "{\"title\":\"four-lane dod b02 $RANDOM-$(date +%s)\",\"task_type\":\"dev\",\"change_kind\":\"code\"}"); TID=$(echo "$RESP" | jq -er .id); C=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE id='"'"'$TID'"'"' AND payload ? '"'"'artifact_kind'"'"' AND payload ? '"'"'answer_known'"'"' AND payload ? '"'"'routed_lane'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$C" = "1" ] || { echo "FAIL count=$C"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: routed_lane 命中四值集合且 schema 类型正确
  动作: 创建一个 execution 类任务（task_type=content_publish）
  预期观察: routed_lane∈{dev,prototype_dev,canvas_skill,skill_explore}，artifact_kind 为 string，answer_known 为 boolean
  等待预算: 30s
  留证: curl | jq 输出（exit 0）
  Test: manual:bash -c 'curl -sf -X POST http://localhost:5221/api/brain/tasks -H "content-type: application/json" -d "{\"title\":\"four-lane dod b03 $RANDOM-$(date +%s)\",\"task_type\":\"content_publish\"}" | jq -e "(.routed_lane==\"dev\" or .routed_lane==\"prototype_dev\" or .routed_lane==\"canvas_skill\" or .routed_lane==\"skill_explore\") and (.artifact_kind|type==\"string\") and (.answer_known|type==\"boolean\")"'

- [ ] [BEHAVIOR] [L2] B-04: 边界——空 description 仍 201 且 artifact_kind 有确定值（不抛异常）
  动作: 调 POST /api/brain/tasks 只带 title + task_type=research，无 description
  预期观察: 正常创建返回，artifact_kind 命中枚举（规则判定不因空 description 失败）
  等待预算: 30s
  留证: curl | jq 输出（exit 0；curl -f 保证非 201 会失败）
  Test: manual:bash -c 'curl -sf -X POST http://localhost:5221/api/brain/tasks -H "content-type: application/json" -d "{\"title\":\"four-lane dod b04 edge $RANDOM-$(date +%s)\",\"task_type\":\"research\"}" | jq -e ".artifact_kind==\"code\" or .artifact_kind==\"execution\""'

- [ ] [BEHAVIOR] [L2] B-05: 冻结纯函数套件通过（四格互斥完备 + LLM 兜底）
  动作: 从仓库根跑冻结 vitest 套件
  预期观察: routeFourQuadrant 4 组合各命中唯一 lane（set size=4）、judgeAnswerKnown 注入失败 llm 时确定性返回 unknown 不抛
  等待预算: 60s
  留证: vitest reporter 输出（全绿 exit 0）
  Test: manual:bash -c 'npx vitest run --no-cache sprints/09052154-kernel-fa6b66ce/tests/four-lane-router.test.ts --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-06: 回放 30 真实任务 → 分格完备准确率报告（真库 + 真产物）
  动作: 跑回放脚本产出 replay-report.json 并断言完备率
  预期观察: 报告 total≥1、四格计数之和==total、completeness_rate==1（互斥完备于真实数据）
  等待预算: 60s
  留证: sprints/09052154-kernel-fa6b66ce/replay-report.json + jq 断言输出
  Test: manual:bash -c 'node sprints/09052154-kernel-fa6b66ce/replay-four-lane-accuracy.mjs > sprints/09052154-kernel-fa6b66ce/replay-report.json; jq -e ".total>=1 and (.per_lane.dev + .per_lane.prototype_dev + .per_lane.canvas_skill + .per_lane.skill_explore == .total) and .completeness_rate==1" sprints/09052154-kernel-fa6b66ce/replay-report.json'

## Invariant 覆盖（铁律映射）

- INV-1 [四格互斥完备]：任一任务命中且仅命中一格 → 由 B-05（纯函数遍历 4 组合 set size=4）+ B-06（30 真实任务 completeness_rate==1）双证。
- INV-2 [禁写死环境]：artifact_kind 规则依赖 task_type/change_kind 集合，不写死屏幕坐标/env 阈值等环境假设值 → 冻结测试断言规则输入→输出，无环境常量。
- INV-3 [真环境验证]：三字段落库由 B-02 真 psql 查真库验证，非 mock DB。
- INV-4 [日志脱敏]：LLM 兜底日志只含 task_id + reason，不含 prompt/凭据 → N/A 于可执行 E2E（兜底分支无法确定性触发），由未覆盖真实链路清单登记 + 生产 Brain log 观测把关。
- INV-5 [端点鉴权]：POST /api/brain/tasks 沿用现有 server ingress `x-tenant-id` 鉴权，本 sprint 不改鉴权 → N/A（不触及鉴权边）。
- INV-6 [多租户默认 / 租户隔离]：三字段落入既有 tenant-scoped payload，不跨租户读写 → N/A（沿用现有 tenant ingress，不新增跨租户读路径）。
- INV-7 [新task_type七点]：本 sprint 不新增 task_type（仅给现有任务加两维标签 + lane）→ N/A（七点清单不触发）。
- INV-8 [target_env读payload]：本 sprint 不改 target_environment 读取路径 → N/A。
- INV-9 [单slot串行 / 凭据安全]：无并发调度改动、无凭据入 git → N/A。
