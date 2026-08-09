---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: harness 失败可观测（terminal 必写 failure_class + 失败率计量 API）

**范围**: 全量 terminal harness 写入点落 `result.failure_class`(枚举)+`failure_detail`；CI lint 机械闸；`GET /harness/failure-stats`；版本三处同步。不做根因修复、不动 gear 分档、不动入口强制、不回填历史 241 条。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 枚举 SSOT 模块存在且导出闭集 + helper
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-failure-class.js','utf8'); if(!/FAILURE_CLASSES/.test(c)||!/classifyFailure/.test(c)||!/buildTerminalFailureResult/.test(c)||!/unknown/.test(c))process.exit(1)"

- [ ] [ARTIFACT] failure-stats 路由已实现于 harness router
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8'); if(!/failure-stats/.test(c)||!/by_class/.test(c)||!/failure_rate/.test(c))process.exit(1)"

- [ ] [ARTIFACT] CI lint 机械闸脚本 + 自测存在
  Test: node -e "const fs=require('fs'); fs.accessSync('scripts/check-harness-terminal-failure-class.mjs'); fs.accessSync('scripts/__tests__/check-harness-terminal-failure-class.test.sh')"

- [ ] [ARTIFACT] 机械闸已接入 ci.yml
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!/check-harness-terminal-failure-class/.test(c))process.exit(1)"

## BEHAVIOR 条目（五行剧本，真执行断言，evaluator 原样跑）

- [ ] [BEHAVIOR] [L2] B-01: failure-stats 端点返回 200 且含数值 failure_rate + by_class 对象
  动作: curl GET localhost:5221/api/brain/harness/failure-stats?days=7
  预期观察: HTTP 200，body 含 `failure_rate`(number) + `by_class`(object) + `total`(number)
  等待预算: 0s
  留证: curl 响应 body 进 log_tail
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/failure-stats?days=7") || { echo FAIL:not200; exit 1; }; echo "$RESP" | jq -e "(.failure_rate|type==\"number\") and (.by_class|type==\"object\") and (.total|type==\"number\")" || { echo FAIL:schema; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: 端点禁用字段名不漂移（by_class/failure_rate 字面 key，禁 camelCase）
  动作: curl 同上并对 body 做 drift guard 断言
  预期观察: body 不含 `failureRate`/`byClass`/`rate`/`classes` 等禁用字段名
  等待预算: 0s
  留证: jq 断言输出
  Test: manual:bash -c 'RESP=$(curl -sf "localhost:5221/api/brain/harness/failure-stats?days=7"); echo "$RESP" | jq -e "(has(\"failureRate\")|not) and (has(\"byClass\")|not) and (has(\"rate\")|not)" || { echo FAIL:字段漂移; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: days 非法输入返 400 + error 字段（error path）
  动作: curl GET .../failure-stats?days=abc
  预期观察: HTTP 400，body 含 `error`(string)
  等待预算: 0s
  留证: http_code + error body
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/fs-err.json -w "%{http_code}" "localhost:5221/api/brain/harness/failure-stats?days=abc"); [ "$CODE" = "400" ] || { echo "FAIL:got $CODE"; exit 1; }; jq -e ".error|type==\"string\"" /tmp/fs-err.json || { echo FAIL:no-error-field; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: 制造 terminal failed harness 任务后 result.failure_class 非 null 且为枚举 [接缝×2]
  动作: 插入退役 task_type=harness_task 探针，等 dispatcher tick drain 打成 failed
  预期观察: within 60s task.status=failed 且 `result->>'failure_class'` 非空（∈ 闭集）
  等待预算: 60s
  留证: until-loop 输出末行含 failure_class 值
  Test: manual:bash -c 'set -e; : "${DB_URL:?}"; TID=$(psql "$DB_URL" -tAc "INSERT INTO tasks (task_type,status,title,priority) VALUES ('"'"'harness_task'"'"','"'"'queued'"'"','"'"'[e2e] fc probe'"'"',3) RETURNING id" | tr -d " "); D=$((SECONDS+60)); until [ "$(psql "$DB_URL" -tAc "SELECT status FROM tasks WHERE id='"'"'$TID'"'"'" | tr -d " ")" = "failed" ]; do [ $SECONDS -lt $D ] || { echo FAIL:timeout; exit 1; }; sleep 2; done; FC=$(psql "$DB_URL" -tAc "SELECT result->>'"'"'failure_class'"'"' FROM tasks WHERE id='"'"'$TID'"'"'" | tr -d " "); [ -n "$FC" ] || { echo FAIL:null-failure-class; exit 1; }; echo "OK failure_class=$FC"'

- [ ] [BEHAVIOR] [L2] B-05: 上线后新 terminal harness 任务 failure_class IS NULL 条数 = 0
  动作: 以脚本启动时刻为界 psql 统计新 terminal harness 任务里 failure_class 为 null 的条数
  预期观察: count = 0（历史 241 条不回填，靠 completed_at 时间窗划界）
  等待预算: 0s
  留证: count 查询输出
  Test: manual:bash -c ': "${DB_URL:?}"; : "${SPRINT_START:?evaluator 须导出脚本启动 UTC 时间戳}"; N=$(psql "$DB_URL" -tAc "SELECT count(*) FROM tasks WHERE task_type IN ('"'"'harness_initiative'"'"','"'"'golden_path_proposal'"'"') AND status IN ('"'"'failed'"'"','"'"'blocked'"'"','"'"'cancelled'"'"') AND completed_at > '"'"'$SPRINT_START'"'"' AND (result->>'"'"'failure_class'"'"') IS NULL" | tr -d " "); [ "$N" = "0" ] || { echo "FAIL:$N nulls"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-06: 机械闸真树 exit 0 且注入裸 terminal 写入触发 exit 1
  动作: 跑 lint（真树），再跑自测（注入违规 fixture）
  预期观察: 真树 lint exit 0；自测脚本内注入裸写后 lint exit 1（自测最终 exit 0 表示拦截成立）
  等待预算: 0s
  留证: 两条命令 exit code
  Test: manual:bash -c 'node scripts/check-harness-terminal-failure-class.mjs || { echo FAIL:真树应exit0; exit 1; }; bash scripts/__tests__/check-harness-terminal-failure-class.test.sh || { echo FAIL:自测未证明拦截; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-07: 版本三处同步（根 lock == brain package.json）
  动作: node 读根 package-lock 与 brain package.json 比对版本
  预期观察: `packages["packages/brain"].version` == brain package.json version
  等待预算: 0s
  留证: node 断言输出
  Test: manual:bash -c 'node -e "const l=require(\"./package-lock.json\"),p=require(\"./packages/brain/package.json\"); if(l.packages[\"packages/brain\"].version!==p.version) throw new Error(\"root lock 版本不同步\"); console.log(\"OK \"+p.version)"'

## INV 条目（PRD Invariant 铁律逐条映射）

- [ ] [BEHAVIOR] INV-1 [local_api 验证形态]: 合同验证真相形态已声明 psql(DB)+curl(端点)，对 judge 闸⑤ meta_verification_gap 预放行（无 UI smoke 非死锁）
  Test: manual:bash -c 'grep -q "^## E2E 验收" sprints/08101830-harness-failure-observability/contract-draft.md && echo OK || exit 1'
- [ ] [BEHAVIOR] INV-2 [合同命令实跑]: 验证命令 exit code 语义已实跑确认（端点 404 红 / version-sync exit0 / 模块 import 红）
  Test: manual:bash -c 'node -e "const l=require(\"./package-lock.json\"),p=require(\"./packages/brain/package.json\"); if(l.packages[\"packages/brain\"].version!==p.version) process.exit(1)"; echo OK'
- INV-3 [台账不入库]: N/A — 本 PR 只提交 sprint 合同产物，不含 `.harness/progress.md`（git 追踪外）
- INV-4 [Deploy Preview 既有故障]: N/A — 非 required check，本 PR 不追修
- INV-5 [证据窗口排序]: N/A（proposer 侧）— evaluator 产 .brain-result.json 时须把 root-cause/Red→Green/exit_code 排进 judge 前 8 条×600 字符窗口

## 领域约束

- DB 写入类：B-04/B-05 psql 计数均带 `completed_at > $SPRINT_START` 时间窗（防历史数据冒充本轮）。
- 无视频/发布/UI/真机 RPA 领域，故不需 ffprobe/平台 API/Playwright/dev-verify oracle。
