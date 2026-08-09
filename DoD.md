contract_branch: cp-harness-propose-r1-b426ab41-r20eebb17-a4
sprint_dir: sprints/08091131-harness-failure-observability

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: harness 失败可观测（terminal 必写 failure_class + 失败率计量 API）

**范围**: ①全量 harness terminal 写入点经 fail-closed 共享 helper 强制写 `result.failure_class`(枚举)+`result.failure_detail`；②CI lint 机械闸防回归；③GET /api/brain/harness/failure-stats?days=N。**不做**：失败根因修复、gear 分档、/dev 入口强制、回填历史 241 条 null。
**大小**: L

## ARTIFACT 条目

- [x] [ARTIFACT] 共享枚举 + fail-closed helper 模块存在
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/lib/harness-failure-class.js','utf8');if(!c.includes('FAILURE_CLASSES')||!c.includes('markHarnessTerminal')||!c.includes('assertFailureClass'))process.exit(1)"

- [x] [ARTIFACT] 机械闸 lint 脚本存在且支持 --fixture-files
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/ci/harness-terminal-failure-class-gate.mjs','utf8');if(!c.includes('fixture-files')||!c.includes('failure_class'))process.exit(1)"

- [x] [ARTIFACT] failure-stats 路由已在 harness.js 注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('failure-stats'))process.exit(1)"

- [x] [ARTIFACT] lint 已接入 brain-ci-deploy.yml
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/brain-ci-deploy.yml','utf8');if(!c.includes('harness-terminal-failure-class-gate'))process.exit(1)"

## BEHAVIOR 条目（五行剧本 + 内嵌 manual:bash，evaluator 原样跑）

- [x] [BEHAVIOR] [L2] B-01: harness terminal 写入点经真 helper 把 failure_class 真落 result 列 [接缝×2]
  动作: 插入一条 harness_initiative 任务，调用真 markHarnessTerminal(pool,{status:failed,failureClass:invalid_gear}) 打成 terminal
  预期观察: tasks.result->>'failure_class' 变为 'invalid_gear'（非 null、∈枚举），failure_detail 非空
  等待预算: 0s
  留证: behaviors.sh B01 stdout（含 result.failure_class=invalid_gear）
  Test: manual:bash -c 'bash sprints/08091131-harness-failure-observability/tests/behaviors.sh B01'

- [x] [BEHAVIOR] [L2] B-02: GET /failure-stats 返回 failure_rate(number) 与 by_class(object)
  动作: curl GET /api/brain/harness/failure-stats?days=7
  预期观察: HTTP 200，body.failure_rate 为数值，body.by_class 为对象
  等待预算: 0s
  留证: curl 响应 JSON 与两条 jq -e 输出
  Test: manual:bash -c 'R=$(curl -sf "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/failure-stats?days=7"); echo "$R" | jq -e ".failure_rate|type==\"number\"" && echo "$R" | jq -e ".by_class|type==\"object\""'

- [x] [BEHAVIOR] [L2] B-03: failure-stats schema keys 完整且无禁用字段名
  动作: curl GET /failure-stats?days=7 并核对顶层 keys
  预期观察: 含 days/window_start/total_terminal/total_failed；不含禁用字段 rate/count/classes/window
  等待预算: 0s
  留证: 两条 jq -e 输出
  Test: manual:bash -c 'R=$(curl -sf "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/failure-stats?days=7"); echo "$R" | jq -e "has(\"days\") and has(\"window_start\") and has(\"total_terminal\") and has(\"total_failed\")" && echo "$R" | jq -e "(has(\"rate\") or has(\"count\") or has(\"classes\") or has(\"window\"))|not"'

- [x] [BEHAVIOR] [L2] B-04: error path — 非法 days=0 返回 400 + error 字段
  动作: curl GET /failure-stats?days=0
  预期观察: HTTP 400，body.error 为字符串
  等待预算: 0s
  留证: http_code + jq -e error 输出
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/fs-e.json -w "%{http_code}" "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/failure-stats?days=0"); [ "$CODE" = "400" ] || { echo "FAIL got $CODE"; exit 1; }; jq -e ".error|type==\"string\"" /tmp/fs-e.json'

- [x] [BEHAVIOR] [L2] B-05: 本 sprint 上线后新产生的 terminal harness 任务无一 result.failure_class IS NULL
  动作: psql 统计 5 分钟窗口内 terminal harness 任务中 result.failure_class 为 null 的条数
  预期观察: 计数 = 0（新写入点全部经 helper 写 failure_class）
  等待预算: 0s
  留证: behaviors.sh B05 stdout（null-class count=0）
  Test: manual:bash -c 'bash sprints/08091131-harness-failure-observability/tests/behaviors.sh B05'

- [x] [BEHAVIOR] [L1] B-06 (INV-1 合同实跑): 机械闸自测 — 脏 fixture exit 1、干净 fixture exit 0、真实树 exit 0
  动作: 用 --fixture-files 喂一个「terminal 裸写无 failure_class」的脏 fixture 与一个带 failure_class 的干净 fixture，再扫真实树
  预期观察: 脏 fixture lint exit 1；干净 fixture exit 0；真实树 exit 0
  等待预算: 0s
  留证: behaviors.sh B06 stdout（gate dirty=1 clean=0 real=0）
  Test: manual:bash -c 'bash sprints/08091131-harness-failure-observability/tests/behaviors.sh B06'

- [x] [BEHAVIOR] [L2] B-07: 空窗口失败率定义良好（0 条 terminal → failure_rate=0，不 NaN/null）
  动作: curl GET /failure-stats?days=7 并核对 failure_rate 与 total_terminal 的一致性
  预期观察: failure_rate 恒为有限数值；total_terminal=0 时 failure_rate 恰为 0
  等待预算: 0s
  留证: jq -e 一致性断言输出
  Test: manual:bash -c 'R=$(curl -sf "${BRAIN_URL:-http://localhost:5221}/api/brain/harness/failure-stats?days=7"); echo "$R" | jq -e "(.failure_rate|type==\"number\") and (.failure_rate>=0) and (if .total_terminal==0 then .failure_rate==0 else true end)"'

- [x] [BEHAVIOR] [L2] B-08 (Invariant fail-closed): 非法枚举必抛错且绝不落库为 failed [接缝×2]
  动作: 对新任务调用 markHarnessTerminal，传 failureClass='__free_text__'（白名单外）
  预期观察: helper 抛错；task 状态未被改成 failed（不落 null failure_class）
  等待预算: 0s
  留证: behaviors.sh B08 stdout（fail-closed threw + not persisted）
  Test: manual:bash -c 'bash sprints/08091131-harness-failure-observability/tests/behaviors.sh B08'

## 铁律映射（历史约束三源）

- INV-1 [合同实跑] → 由上方 **B-06** 承载：机械闸「故意漏写 → exit 1」已实测（脏 fixture 实跑 lint exit 1），非纸面约定
- INV-2 [judge分流] → N/A：本 sprint 不触及 judge 证据链路/evidence_insufficient 分流逻辑，无相关改动

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A —— 写路径 B-01/B-05/B-08 走真 Postgres 真 helper，读路由 B-02/B-03/B-04/B-07 走真 Brain，机械闸 B-06 纯静态真跑。）
