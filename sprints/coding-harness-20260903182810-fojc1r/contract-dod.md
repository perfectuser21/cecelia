---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-usage.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于约定路径
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-usage.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 维护者能识别创建与查询端点
  动作: 打开说明并读取两个端点用途
  预期观察: POST 被说明为创建并派发，GET 被说明为按 id 查询状态
  等待预算: 0s
  留证: Vitest 输出中对应测试通过
  Test: manual:bash -c 'BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts -t "文档包含创建与查询端点的准确用途"'

- [ ] [BEHAVIOR] [L1] B-02: 维护者能按安全要求鉴权
  动作: 读取 loopback 与宿主或远端鉴权说明
  预期观察: 文档要求宿主或远端携带 Bearer CECELIA_INTERNAL_TOKEN，且不含真实 token
  等待预算: 0s
  留证: Vitest 输出中正向与匿名远端负向 oracle 均通过
  Test: manual:bash -c 'BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts -t "鉴权说明要求宿主或远端使用 Bearer token"'

- [ ] [BEHAVIOR] [L1] B-03: 维护者只选择九项生产角色
  动作: 逐行读取角色白名单
  预期观察: 九项名称与生产封闭集合逐项一致，别名、遗漏或额外值均不合格
  等待预算: 0s
  留证: Vitest 输出中封闭集合和负向 oracle 通过
  Test: manual:bash -c 'BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts -t "角色白名单是九项封闭集合且拒绝别名和遗漏"'

- [ ] [BEHAVIOR] [L1] B-04: 维护者构造最小 payload
  动作: 按说明准备 sprint_dir、base_repo、branch，并决定是否省略 base_sha
  预期观察: 三个必填字段明确，base_sha 省略时由生产 Brain 自解析而非调用方猜测
  等待预算: 0s
  留证: Vitest 输出中正确语义与错误固定值负向 oracle 通过
  Test: manual:bash -c 'BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts -t "payload 明确三个必填字段与 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-05: 维护者识别失败回滚的全部终态
  动作: 阅读派发失败章节并核对 run、session、task
  预期观察: 三项分别显示 failed、closed、cancelled，任一缺失均失败
  等待预算: 0s
  留证: Vitest 输出中三状态正向与遗漏负向 oracle 通过
  Test: manual:bash -c 'BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts -t "派发失败回滚完整列出三个资源终态"'

- [ ] [BEHAVIOR] [L1] B-06: 候选范围只有目标文档
  动作: 相对冻结 BASE_SHA 检查 canonical git diff
  预期观察: 排除本 Sprint 冻结合同产物后仅有目标文档，不含代码
  等待预算: 0s
  留证: Vitest 输出包含范围正向与注入代码路径负向 oracle
  Test: manual:bash -c 'BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac npx vitest run --no-cache sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-bridge-usage.test.ts -t "范围 oracle 仅允许新增目标文档且拒绝代码变化"'

## Invariant 映射

- [规划分支] N/A：该约束作用于 Planner；本角色停留在服务端签发的 proposer 分支。
- [凭据安全] 已由 B-02 验证只出现变量名和占位符，不接受真实 token。
- [端点鉴权] 已由 B-02 验证两端点说明 `internalAuthOrLoopback` 及非 loopback Bearer 要求；本 Sprint 不新增端点。
