---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；合同产物位于本 Sprint 目录；不改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文件为唯一实现交付物
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 两个端点用途与中文正文完整且拒绝漏项
  动作: 打开 attempt-run 桥接说明，定位创建与查询用途
  预期观察: POST 创建和 GET 查询两个端点均有中文说明，缺任一项即失败
  等待预算: 0s
  留证: Vitest 输出与文档匹配结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与中文正文完整且拒绝漏项"'

- [ ] [BEHAVIOR] [L1] B-02: 鉴权说明完整且拒绝免鉴权误导
  动作: 阅读鉴权章节并区分 loopback 与宿主或远端
  预期观察: 宿主与远端必须携带 Bearer token，免鉴权误导语句不存在
  等待预算: 0s
  留证: Vitest 输出与正负向词法断言
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "鉴权说明完整且拒绝免鉴权误导"'

- [ ] [BEHAVIOR] [L1] B-03: 角色白名单恰好九项且拒绝增删重复
  动作: 读取 ROLE_ALLOWLIST 标记内的封闭清单
  预期观察: 清单按原始拼写恰好等于九项角色，任何增删重复均失败
  等待预算: 0s
  留证: Vitest exact-equality 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好九项且拒绝增删重复"'

- [ ] [BEHAVIOR] [L1] B-04: payload 必填恰好三项且 base_sha 可省略并保持基线
  动作: 读取 REQUIRED_PAYLOAD 清单与 base_sha 说明
  预期观察: 必填仅为 sprint_dir、base_repo、branch，base_sha 可省略且实现基线不可被角色 checkout 替代
  等待预算: 0s
  留证: Vitest exact-equality 与禁止短语输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "payload 必填恰好三项且 base_sha 可省略并保持基线"'

- [ ] [BEHAVIOR] [L1] B-05: 失败回滚恰好三个终态且不是部分成功
  动作: 读取 ROLLBACK_STATES 标记内的失败出口
  预期观察: run、session、task 分别进入 failed、closed、cancelled，且明确不是部分成功
  等待预算: 0s
  留证: Vitest exact-equality 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "失败回滚恰好三个终态且不是部分成功"'

- [ ] [BEHAVIOR] [L1] INV-1: 规划分支铁律不受文档交付破坏
  动作: 验证说明未指导 Provider 切换 planner workspace 分支
  预期观察: 文档不存在“Provider 切换 planner 分支”误导文字
  等待预算: 0s
  留证: Node 只读断言输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(s.includes('"'"'Provider 切换 planner 分支'"'"'))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-2: 权威地址与 fail-closed 铁律不受文档交付破坏
  动作: 验证说明未指导覆盖 HARNESS_BRAIN_URL 或绕过预检
  预期观察: 两个禁止误导短语均不存在
  等待预算: 0s
  留证: Node 只读断言输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'覆盖 HARNESS_BRAIN_URL'"'"','"'"'绕过预检'"'"'])if(s.includes(x))process.exit(1)"'

## 范围行为

- [ ] [BEHAVIOR] [L1] B-06: canonical 全仓 diff 仅含合同产物与唯一说明文档
  动作: 从固定实现基线对候选 HEAD 执行全仓三点 diff
  预期观察: 变更路径闭合集合恰好 5 项，无任何代码路径
  等待预算: 0s
  留证: 排序后的 git diff 路径清单
  Test: manual:bash -c 'BASE=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98; S=sprints/coding-harness-20260904034439-v1423a; A=$(git diff --name-only "$BASE...HEAD" -- . | LC_ALL=C sort); E=$(printf "%s\n" docs/current/attempt-run-bridge-guide.md "$S/contract-dod.md" "$S/contract-draft.md" "$S/task-plan.json" "$S/tests/attempt-run-bridge-guide.test.ts" | LC_ALL=C sort); [ "$A" = "$E" ]'

