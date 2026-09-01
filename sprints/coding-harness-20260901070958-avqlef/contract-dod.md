---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文说明。
**大小**: S

## Invariant 映射

- INV-1 端点鉴权：B-01 断言文档明确 `internalAuthOrLoopback` 与远端 Bearer 要求。
- INV-2 凭据安全：B-01 只出现变量名，不允许真实 token；测试 fixture 不含凭据。
- INV-3 日志脱敏：N/A，本 sprint 不新增日志。
- INV-4 分支归属：N/A，本 sprint 不改变 Planner workspace 或分支逻辑。
- INV-5 验证命令：B-01 至 B-05 均为实际执行且以非零退出表达失败。
- INV-6 真环境验证：N/A，本 sprint 为静态文档，不依赖真实调用方接缝。
- INV-7 共享文件禁区：B-05 严格限制产品 diff 为目标文档。

## ARTIFACT 条目

- [ ] [ARTIFACT] `docs/current/attempt-run-bridge-guide.md` 存在并含中文正文
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[一-龥]/u.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 中文文档包含两个端点用途与鉴权规则
  动作: 打开 attempt-run 桥接说明并阅读端点与鉴权节
  预期观察: POST 派发、GET 查询、internalAuthOrLoopback 与远端 Bearer token 规则均可见
  等待预算: 0s
  留证: Vitest 命令输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t "中文文档包含两个端点用途与鉴权规则"'

- [ ] [BEHAVIOR] [L2] B-02: 角色白名单逐项列出九个 PRD 角色
  动作: 阅读角色白名单节并逐项核对名称
  预期观察: PRD 指定九个角色名称均逐字出现
  等待预算: 0s
  留证: Vitest 命令输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t "角色白名单逐项列出九个 PRD 角色"'

- [ ] [BEHAVIOR] [L2] B-03: payload 区分三个必填字段与可省略 base_sha
  动作: 按说明构造 payload 并核对字段必填性
  预期观察: sprint_dir、base_repo、branch 为必填，base_sha 可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 命令输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t "payload 区分三个必填字段与可省略 base_sha"'

- [ ] [BEHAVIOR] [L2] B-04: 派发失败说明完整回滚三个对象终态
  动作: 阅读派发失败节并核对 run、session、task 三对象
  预期观察: run→failed、session→closed、task→cancelled 完整可见
  等待预算: 0s
  留证: Vitest 命令输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t "派发失败说明完整回滚三个对象终态"'

- [ ] [BEHAVIOR] [L2] B-05: 实现基线之外的产品改动只有目标文档
  动作: 相对冻结实现基线读取产品文件 diff
  预期观察: 排除本 sprint 合同产物后仅出现目标说明文档，不出现代码或配置
  等待预算: 0s
  留证: Vitest 命令输出与 git diff 文件列表
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901070958-avqlef/tests/attempt-run-bridge-guide.test.ts -t "实现基线之外的产品改动只有目标文档"'
