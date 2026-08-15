---
skeleton: false
journey_type: autonomous
target_environment: local_api
implementation_base_sha: 329f2bf0a68759fae45de61d805800e278a2d587
---
# Contract DoD — Runtime Brain Version Smoke

**范围**: 仅修改 control-plane repair smoke 最终 PASS 的版本来源并新增永久回归测试；版本/schema/authority 保护逻辑不改。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] smoke 最终 PASS 使用从 `VERSION_JSON.version` 提取的变量，最终 printf 不含固定 SemVer 字面
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh','utf8');const line=s.split(/\n/).find(x=>x.includes('control-plane authorities are deployed'));if(!line||!/\$\{?[A-Z_]*VERSION/.test(line)||/Brain [0-9]+\.[0-9]+\.[0-9]+/.test(line))process.exit(1)"

- [ ] [ARTIFACT] 永久 Vitest 回归位于 Brain CI include 路径并含真实版本与两项 fail-closed 测试
  Test: node -e "const fs=require('fs');const p='packages/brain/scripts/__tests__/harness-control-plane-complete-repair-smoke.test.mjs';const s=fs.readFileSync(p,'utf8');for(const x of ['describe','it(','expect(','PASS reports the exact runtime API version instead of a hard-coded version','schema below 430 remains fail-closed','authority-table failure remains fail-closed'])if(!s.includes(x))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: version API 保持 PRD 字段 shape
  动作: 对真实 Brain 调用 GET /api/brain/version
  预期观察: 返回 version 字符串与数值化后不低于 430 的 schema_version，且不用禁用别名
  等待预算: 5s
  留证: API JSON 与 jq exit code
  Test: manual:bash -c 'curl -fsS --max-time 5 http://127.0.0.1:5221/api/brain/version | jq -e '\''(.version|type)=="string" and ((.schema_version|tonumber)>=430) and (keys|index("version")!=null) and (keys|index("schema_version")!=null) and (has("brain_version")|not) and (has("schema")|not)'\'''

- [ ] [BEHAVIOR] [L2] B-02: smoke PASS 精确报告真实 runtime version [接缝×2]
  动作: 从真实 API 读取 runtime version 后，以真实迁移数据库执行完整 smoke
  预期观察: 最终 PASS 行中的 Brain version 与同轮 API 返回值逐字一致
  等待预算: 15s
  留证: smoke stdout 与 API JSON；重复两次的输出
  Test: manual:bash -c 'for RUN in 1 2; do V=$(curl -fsS --max-time 5 http://127.0.0.1:5221/api/brain/version | jq -e -r '\''.version | select(type=="string" and length>0)'\''); O=$(BRAIN_URL=http://127.0.0.1:5221 DATABASE_URL="$DB_URL" bash packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh); printf "%s\n" "$O" | grep -Fx "PASS: Brain $V schema 430 control-plane authorities are deployed" || exit 1; done'

- [ ] [BEHAVIOR] [L1] B-03: 任意硬编码 PASS 版本被永久回归拒绝
  动作: 用两个不同的合格 API version fixture 执行真实 smoke 子进程
  预期观察: 每次 stdout 只报告各自 API version；固定版本实现至少一轮失败
  等待预算: 10s
  留证: Vitest 两个 fixture 的 assertion diff
  Test: manual:bash -c 'npx vitest run sprints/08151949-kernel-r6/tests/runtime-version-reporting.test.ts -t "PASS reports the exact runtime API version instead of a hard-coded version" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-04: schema 低于 430 保持 fail-closed
  动作: 以 schema_version=429 fixture 执行真实 smoke 子进程
  预期观察: 进程非零退出且 stdout 没有 PASS
  等待预算: 10s
  留证: Vitest 退出码与 stdout 断言
  Test: manual:bash -c 'npx vitest run sprints/08151949-kernel-r6/tests/runtime-version-reporting.test.ts -t "schema below 430 remains fail-closed" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-05: authority-table 缺失保持 fail-closed
  动作: 以 authority 查询返回 FAIL fixture 执行真实 smoke 子进程
  预期观察: grep 保护令进程非零退出且 stdout 没有 PASS
  等待预算: 10s
  留证: Vitest 退出码与 stdout 断言
  Test: manual:bash -c 'npx vitest run sprints/08151949-kernel-r6/tests/runtime-version-reporting.test.ts -t "authority-table failure remains fail-closed" --reporter=verbose'

## Invariant 映射

- INV-1 防假成功：B-02/B-03 精确绑定 API version 与 PASS，并跨两个值拒绝固定字面。
- INV-2 fail-closed：B-04/B-05 断言 schema/authority 失败非零且无 PASS。
- INV-3 Kernel 时钟：N/A — 不修改 Kernel 时钟；Evaluator/Judge 仍须由 Kernel Harness 独立角色执行并留证。
