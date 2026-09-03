---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-桥接使用说明.md`，不修改代码或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明页位于唯一约定路径并含标题
  Test: node -e "const c=require('fs').readFileSync('docs/current/attempt-run-桥接使用说明.md','utf8');if(!c.includes('# attempt-run 桥接使用说明'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能区分两个端点用途并选择正确鉴权方式
  动作: 读取端点与鉴权章节，对照本机 loopback 和宿主/远端两种调用位置
  预期观察: 文档同时给出 POST 创建派发、GET 查询、internalAuthOrLoopback、Bearer 占位 token，并明确缺失或无效凭据会被拒绝
  等待预算: 0s
  留证: Vitest 对应测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "两个端点用途与鉴权正反向 oracle 完整"'

- [ ] [BEHAVIOR] [L1] B-02: 读者只能从恰好九项角色白名单选择
  动作: 读取角色白名单并尝试核对允许角色与越界角色
  预期观察: 九项逐名集合完全等于生产白名单，白名单外角色明确拒绝
  等待预算: 0s
  留证: Vitest 集合相等与负向断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "角色白名单是逐项列名的封闭九项集合且含越界拒绝"'

- [ ] [BEHAVIOR] [L1] B-03: 读者能构造满足必填合同的 payload
  动作: 按 POST payload 章节构造请求，并分别检查省略 base_sha 与缺少必填字段的情形
  预期观察: sprint_dir、base_repo、branch 均为必填；base_sha 可省略且由生产 Brain 自解析；缺任一必填字段不满足合同
  等待预算: 0s
  留证: Vitest 字段语义与反向断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "payload 必填与可选语义均有对应负向 oracle"'

- [ ] [BEHAVIOR] [L1] B-04: 读者能完整解释派发失败终态
  动作: 读取失败回滚章节并核对 run、session、task 三类资源
  预期观察: 回滚集合恰好为 run → failed、session → closed、task → cancelled，且明确失败不是半成功
  等待预算: 0s
  留证: Vitest 封闭集合与负向断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "派发失败回滚封闭覆盖三个资源且否定半成功"'

- [ ] [BEHAVIOR] [L1] B-05: 冻结基线范围仅出现唯一产品文档
  动作: 从冻结 BASE_SHA 计算当前 HEAD 的产品文件差异
  预期观察: 排除本 Sprint 合同产物后，差异集合恰好只有目标 docs/current 文件且不存在代码路径
  等待预算: 0s
  留证: git diff 文件列表与 Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "范围 oracle 只允许唯一 docs 产品文件且冻结基线不漂移"'

## Invariant 映射

- INV-1 端点鉴权：由可执行条目 B-01 覆盖；同时要求 auth 策略、Bearer 正向说明与缺失/无效负向拒绝。
- INV-2 凭据安全：由可执行条目 B-01 覆盖；拒绝疑似真实 Bearer token，仅允许占位变量。
- INV-3 环境假设：由可执行条目 B-03 覆盖；明确 base_sha 省略后由生产 Brain 自解析，不要求调用方猜值。
- INV-4 真环境验证：N/A，本 Sprint 的范围明确排除真实派发副作用，仅验证说明合同。
- INV-5 Planner 分支：N/A，本 Sprint 不修改 Planner workspace 或分支逻辑。
- INV-6 单槽串行：N/A，本 Sprint 不修改调度或 slot 行为。

> INV 条目由上方 B-01/B-03 的同一可执行命令覆盖，N/A 项不产生独立执行命令。
