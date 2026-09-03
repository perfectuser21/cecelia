---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不修改产品代码、配置、API 或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于约定路径并含正确标题
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!/^# attempt-run 桥接使用说明$/m.test(s)||!/[一-龥]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 端点用途与鉴权可被读者明确区分
  动作: 阅读“端点用途”和“鉴权”两节，并核对创建、查询、回环及宿主/远端要求
  预期观察: POST 对应创建、GET 对应查询；宿主/远端明确携带 Bearer CECELIA_INTERNAL_TOKEN
  等待预算: 0s
  留证: Vitest 输出中 `端点用途与鉴权正负 oracle` PASS
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t "端点用途与鉴权正负 oracle" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-02: 角色白名单是恰好九项的封闭集合
  动作: 逐项读取“角色白名单”节并与生产路由 ALLOWED_ROLES 顺序集合核对
  预期观察: 仅出现 canary、planner、proposer、reviewer、generator、generator-fix、evaluator、evaluator-evidence-repair、judge 九项
  等待预算: 0s
  留证: Vitest 输出中 `角色白名单恰好九项封闭集合正负 oracle` PASS，增删变异均被拒绝
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好九项封闭集合正负 oracle" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填项与可省略 base_sha 无歧义
  动作: 阅读 payload 字段节，分别核对 sprint_dir、base_repo、branch 和 base_sha
  预期观察: 前三项均标必填；base_sha 标可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中 `payload 必填与 base_sha 可省略正负 oracle` PASS，误标必填变异被拒绝
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t "payload 必填与 base_sha 可省略正负 oracle" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败回滚链完整
  动作: 阅读“派发失败自动回滚”节并核对四对象终态
  预期观察: 逐字看到 run→failed/session→closed/task→cancelled
  等待预算: 0s
  留证: Vitest 输出中 `派发失败回滚链正负 oracle` PASS，错误终态变异被拒绝
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚链正负 oracle" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-05: implementation diff 严守 docs-only 范围
  动作: 以冻结 implementation baseline 计算 HEAD 差异并排除本 Sprint 合同产物
  预期观察: 差异集合恰好只有 docs/current/attempt-run-bridge-guide.md
  等待预算: 0s
  留证: canonical git diff 输出与 Vitest 正负 oracle 输出
  Test: manual:bash -c 'BASE_SHA="b99c580d7fe8ca4cbf0ee834e13c91df02b57369"; CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- . ":(exclude)sprints/coding-harness-20260903125754-owbri3/**"); [ "$CHANGED" = "docs/current/attempt-run-bridge-guide.md" ] && npx vitest run sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t "范围仅新增一份 docs/current 中文文档正负 oracle" --reporter=verbose'

## Invariant 映射

- [端点鉴权] → B-01 明确两个端点采用 internalAuthOrLoopback，宿主/远端必须 Bearer。
- [凭据安全] → B-01 仅写环境变量名，不含真实 token；E2E diff 接受目标文档唯一变更。
- [禁止写死] → N/A：说明文档不写环境坐标；固定 SHA 是合同授权的实现基线，不是环境假设。
- [真环境验证] → N/A：本 Sprint 不改变真实调用链，只验证静态说明。
- [Planner 分支] → N/A：Proposer 不切换 planner 分支；当前在服务端签发 propose branch。

## 验收失败语义

任一测试、负向 oracle 或范围断言非零退出即 FAIL 并阻塞封印；无跳过、降级或吞错路径。
