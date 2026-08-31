---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-usage.md`
**大小**: S
**权威实现基线**: `0f52356135922cf5031406dae629211837c3de92`

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文说明文档，候选 diff 不含其他文件
  Test: bash -c 'DOC=docs/current/attempt-run-bridge-usage.md; BASE=0f52356135922cf5031406dae629211837c3de92; test -f "$DOC" && node -e "const s=require(\"fs\").readFileSync(process.argv[1],\"utf8\");if(!/[\\u4e00-\\u9fff]/.test(s))process.exit(1)" "$DOC" && [ "$(git diff --name-only "$BASE"...HEAD)" = "$DOC" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者分别看到创建与查询端点用途
  动作: 打开说明文档并阅读「端点用途」章节
  预期观察: POST 被说明为创建/派发，GET 被说明为按 id 查询状态与结果
  等待预算: 0s
  留证: Vitest 输出中「分别说明创建与查询端点用途」用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts -t "分别说明创建与查询端点用途"'

- [ ] [BEHAVIOR] [L1] B-02: 宿主与远端 Bearer 义务被独立证明
  动作: 阅读「鉴权」章节并分别查找宿主、远端说明
  预期观察: 两类调用均明确必须携带 Bearer CECELIA_INTERNAL_TOKEN，loopback 例外仅限未配置 token 的非生产本机开发
  等待预算: 0s
  留证: Vitest 输出中「分别证明宿主和远端必须携带 Bearer」用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts -t "分别证明宿主和远端必须携带 Bearer"'

- [ ] [BEHAVIOR] [L1] B-03: 九项角色白名单精确可见
  动作: 阅读「角色白名单」章节并逐项计数
  预期观察: 恰好出现生产 Brain 接受的九项角色，顺序和名称均与权威数组一致
  等待预算: 0s
  留证: Vitest 输出中「精确列出九项角色白名单」用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts -t "精确列出九项角色白名单"'

- [ ] [BEHAVIOR] [L1] B-04: payload 四个字段的必填性分别可见
  动作: 阅读「payload 字段」章节并逐字段核对
  预期观察: sprint_dir、base_repo、branch 各自标为必填，base_sha 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中「分别声明三个必填字段和可省略 base_sha」用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts -t "分别声明三个必填字段和可省略 base_sha"'

- [ ] [BEHAVIOR] [L1] B-05: 派发失败的三个回滚终态完整可见
  动作: 阅读「派发失败自动回滚」章节
  预期观察: 文档逐项显示 run→failed、session→closed、task→cancelled，且不承诺额外重试或补偿
  等待预算: 0s
  留证: Vitest 输出中「写明派发失败的三个自动回滚终态」用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts -t "写明派发失败的三个自动回滚终态"'

## Invariant 映射

- INV-1 端点鉴权：映射至 B-02，两端点与 `internalAuthOrLoopback` 同节出现。
- INV-2 凭据安全：映射至 B-02，文档只含 `$CECELIA_INTERNAL_TOKEN` 环境变量占位符，不含真实 token。
- INV-3 环境假设：映射至 B-02，仅描述生产中间件事实，不写死机器或秘密值。
- INV-4 真环境验证：N/A — 本任务不改变真实调用链，只说明已有契约。
- INV-5 Planner 分支：N/A — 本任务不触及 Planner checkout/switch 行为。
