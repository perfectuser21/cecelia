---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 只新增 `docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md` 中文说明。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 目标中文文档存在，合同与冻结测试保留在 sprint 目录
  Test: node -e "const fs=require('fs');const p='docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 端点与鉴权说明完整且远端鉴权 fail-closed
  动作: 阅读端点与鉴权节，分别确认 POST、GET 的用途及宿主/远端认证要求
  预期观察: 文档明确 POST 创建派发、GET 按 id 查询，远端必须携带 Bearer CECELIA_INTERNAL_TOKEN
  等待预算: 0s
  留证: Vitest 用例输出中的端点与鉴权断言
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831154531-41o7s4/tests/attempt-run-bridge-guide.test.ts -t "端点与鉴权说明完整且远端鉴权 fail-closed"'

- [ ] [BEHAVIOR] [L2] B-02: 角色白名单完整列出生产九项角色
  动作: 阅读角色白名单节并解析其中的 JSON 角色数组
  预期观察: 数组恰有九项，且与生产 ALLOWED_ROLES 集合逐项一致
  等待预算: 0s
  留证: Vitest 用例输出中的九项集合比较结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831154531-41o7s4/tests/attempt-run-bridge-guide.test.ts -t "角色白名单完整列出生产九项角色"'

- [ ] [BEHAVIOR] [L2] B-03: payload 必填字段与 base_sha 省略语义准确
  动作: 阅读 payload 节，逐项核对三个必填字段及 base_sha 的权威解析说明
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 用例输出中的字段与语义断言
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831154531-41o7s4/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段与 base_sha 省略语义准确"'

- [ ] [BEHAVIOR] [L2] B-04: 派发失败回滚三个对象与终态完整
  动作: 阅读派发失败自动回滚节，核对 run、session、task 的收口状态
  预期观察: 文档完整出现 run → failed、session → closed、task → cancelled
  等待预算: 0s
  留证: Vitest 用例输出中的三条状态转换断言
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831154531-41o7s4/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚三个对象与终态完整"'

## Invariant 覆盖

- INV-1 端点鉴权：B-01 断言文档明确两端点鉴权与远端 Bearer 要求。
- INV-2 凭据安全：冻结测试拒绝任何疑似 JWT/真实 token，只允许 `<CECELIA_INTERNAL_TOKEN>` 占位符。
- INV-3 禁止写死环境：N/A，本任务不新增环境地址或运行参数。
- INV-4 真环境验证：N/A，本任务仅描述既有行为且不修改真实接缝；事实由生产源码与既有回归测试提供。
- INV-5 Planner 分支：N/A，本任务不改 Planner 分支行为。
