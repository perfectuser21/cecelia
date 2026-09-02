---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文说明页。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明页存在且按四个独立章节组织
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');for(const h of ['端点用途','鉴权方式','角色白名单','payload 与失败回滚'])if(!s.includes('## '+h))process.exit(1);if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者能识别两个端点的用途
  动作: 打开说明页并阅读「端点用途」章节
  预期观察: POST 被说明为创建并派发，GET 被说明为按 id 查询运行状态
  等待预算: 0s
  留证: Vitest 输出中的「说明创建与查询端点用途」结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "说明创建与查询端点用途"'

- [ ] [BEHAVIOR] [L2] B-02: 宿主与远端调用方能采用正确鉴权
  动作: 阅读「鉴权方式」章节并核对请求头示例
  预期观察: 页面写明 internalAuthOrLoopback 与 Bearer CECELIA_INTERNAL_TOKEN 占位符，且无真实 token
  等待预算: 0s
  留证: Vitest 输出中的「说明鉴权且不泄露凭据」结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "说明鉴权且不泄露凭据"'

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单是封闭九项
  动作: 阅读「角色白名单」章节并提取反引号角色项
  预期观察: 角色集合精确为 canary、planner、proposer、reviewer、generator、generator-fix、evaluator、evaluator-evidence-repair、judge，不含其他角色
  等待预算: 0s
  留证: Vitest 输出中的「角色白名单是封闭九项」结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "角色白名单是封闭九项"'

- [ ] [BEHAVIOR] [L2] B-04: payload 字段与失败回滚语义完整
  动作: 阅读「payload 与失败回滚」章节
  预期观察: 三个必填字段、base_sha 可省略语义、三项失败终态与查询可见性均明确
  等待预算: 0s
  留证: Vitest 输出中的 payload 与回滚测试结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "说明 payload 必填与可省略字段|说明派发失败自动回滚"'

- [ ] [BEHAVIOR] [L2] B-05: canonical 全仓 diff 不越界
  动作: 以冻结基线 SHA 对候选 HEAD 执行全仓 diff，并排除 Sprint 合同控制产物
  预期观察: 实现差异精确只有 docs/current/attempt-run-bridge-guide.md，不含任何代码
  等待预算: 0s
  留证: Vitest 输出中的「canonical 全仓 diff 仅包含目标文档」结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "canonical 全仓 diff 仅包含目标文档"'

- [ ] [BEHAVIOR] [L2] INV-1: 每个文档化端点均声明鉴权
  动作: 核对两个端点所在章节与统一鉴权说明
  预期观察: 两端点均受 internalAuthOrLoopback 保护，远端不可匿名访问
  等待预算: 0s
  留证: B-01 与 B-02 测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "说明创建与查询端点用途|说明鉴权且不泄露凭据"'

- [ ] [BEHAVIOR] [L2] INV-2: 凭据不硬编码、不进 Git、不进日志
  动作: 扫描说明页中的 Authorization 示例
  预期观察: 仅出现 CECELIA_INTERNAL_TOKEN 占位符，不出现 Bearer 后的固定秘密值
  等待预算: 0s
  留证: 鉴权测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "说明鉴权且不泄露凭据"'

- [ ] [BEHAVIOR] [L2] INV-3: Planner 分支铁律不受影响
  动作: 执行 canonical 全仓 diff 范围检查
  预期观察: 候选仅新增说明页，不修改 Planner workspace 或分支签发逻辑
  等待预算: 0s
  留证: canonical diff 测试输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "canonical 全仓 diff 仅包含目标文档"'
