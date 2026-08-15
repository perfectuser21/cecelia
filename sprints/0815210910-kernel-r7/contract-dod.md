---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: runtime version repair smoke

**范围**: 仅动态 PASS 版本回显与永久回归测试
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] smoke 最终 PASS 使用从 `VERSION_JSON` 提取的运行时变量，且 PASS 模板无三段版本字面量
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh','utf8');const p=s.split(/\n/).find(x=>x.includes('PASS: Brain'))||'';if(!/RUNTIME_VERSION=.*VERSION_JSON/.test(s)||!/PASS: Brain \\$\\{?RUNTIME_VERSION\\}? schema 430/.test(p)||/Brain \\d+\\.\\d+\\.\\d+ schema/.test(p))process.exit(1)"

- [ ] [ARTIFACT] 永久 Vitest 回归测试存在并覆盖动态版本与两类 fail-closed 约束
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('packages/brain/scripts/__tests__/harness-control-plane-repair-version-report.test.mjs','utf8');for(const x of ['拒绝最终 PASS 中硬编码版本字面量','最终 PASS 上报 API 返回的确切运行时版本','schema_version 低于 430 时 fail-closed 且不输出 PASS','权威表检查失败时 fail-closed 且不输出 PASS'])if(!s.includes(x))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: Step 1 API 返回确切 `version` 字段 [接缝×2]
  动作: 连续两次调用真实 Brain `GET /api/brain/version`
  预期观察: 两次响应的 `version` 都是字符串 semver，且值一致
  等待预算: 10s
  留证: 两次 curl 响应与 jq 输出进入 behavior_tests.log_tail
  Test: manual:bash -c 'A=$(curl -fsS "${BRAIN_URL:-http://127.0.0.1:5221}/api/brain/version" | jq -e -r ".version | select(type == \"string\" and test(\"^[0-9]+[.][0-9]+[.][0-9]+$\"))"); B=$(curl -fsS "${BRAIN_URL:-http://127.0.0.1:5221}/api/brain/version" | jq -e -r ".version | select(type == \"string\" and test(\"^[0-9]+[.][0-9]+[.][0-9]+$\"))"); [ "$A" = "$B" ]'

- [ ] [BEHAVIOR] [L2] B-02: Step 1 API schema 完整且 schema 下限满足
  动作: 调用真实 Brain 版本端点并检查完整响应 shape
  预期观察: 顶层 keys 仅为 `schema_version/version`，schema 字符串数值不低于 430
  等待预算: 10s
  留证: curl 响应与 jq 判定输出进入 behavior_tests.log_tail
  Test: manual:bash -c 'curl -fsS "${BRAIN_URL:-http://127.0.0.1:5221}/api/brain/version" | jq -e "keys == [\"schema_version\",\"version\"] and (.schema_version | type == \"string\" and tonumber >= 430)"'

- [ ] [BEHAVIOR] [L1] B-03: Step 2 低 schema 继续 fail-closed
  动作: 运行永久回归用例，以进程 fixture 向真实 smoke 输入 `schema_version=429`
  预期观察: smoke 子进程非零退出且没有最终 PASS
  等待预算: 30s
  留证: Vitest verbose 输出中的用例名、子进程退出码断言
  Test: manual:bash -c 'cd packages/brain && npx vitest run scripts/__tests__/harness-control-plane-repair-version-report.test.mjs -t "schema_version 低于 430 时 fail-closed 且不输出 PASS" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-04: Step 3 权威表失败继续 fail-closed
  动作: 运行永久回归用例，以进程 fixture 令真实 smoke 的权威表查询返回 FAIL
  预期观察: smoke 子进程非零退出且没有最终 PASS
  等待预算: 30s
  留证: Vitest verbose 输出中的用例名、子进程退出码断言
  Test: manual:bash -c 'cd packages/brain && npx vitest run scripts/__tests__/harness-control-plane-repair-version-report.test.mjs -t "权威表检查失败时 fail-closed 且不输出 PASS" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: Step 4 最终 PASS 精确回显运行时版本 [接缝×2]
  动作: 对已 migration 的 attempt DB 连续两次执行真实控制面 smoke，并与紧邻 API 响应比较
  预期观察: 两次最终行都逐字等于 `PASS: Brain <runtime version> schema 430 control-plane authorities are deployed`
  等待预算: 60s
  留证: API JSON、两次 smoke stdout、逐字比较结果
  Test: manual:bash -c ': "${DB_URL:?}"; V=$(curl -fsS "${BRAIN_URL:-http://127.0.0.1:5221}/api/brain/version" | jq -e -r ".version | select(type == \"string\")"); for N in 1 2; do O=$(BRAIN_URL="${BRAIN_URL:-http://127.0.0.1:5221}" DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh); [ "$(printf "%s\n" "$O" | tail -n 1)" = "PASS: Brain ${V} schema 430 control-plane authorities are deployed" ] || exit 1; done; printf "OK runtime_version=%s\n" "$V"'

## Invariant 映射

- Brain URL 权威 → B-01/B-02/B-05 均读取真实 `${BRAIN_URL}`，无替代地址。
- 评估时钟采纳 → N/A：实现不触及 validation clock；E2E 身份与证据由 Runner late-bind。
- 验证命令实跑 → B-03/B-04 定向 Vitest 且必须收集命名用例；B-05 真实执行 smoke。
- 证据一手 → B-01/B-02/B-05 保留当轮 API/smoke 输出；Evaluator 记录 evidence 摘要。
- 口径先查 → B-05 用同轮 API 与 PASS 逐字比较，不消费历史日志。
