---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明文档

**范围**: 实现仅新增 `docs/current/attempt-run-bridge-guide.md`；不修改任何代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于约定路径并含四个主题章节
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');for(const x of ['端点与鉴权','角色白名单','payload 必填字段','派发失败自动回滚'])if(!s.includes(x))process.exit(1)"

## BEHAVIOR 条目（五行剧本）

- [ ] [BEHAVIOR] [L1] B-01: 操作者能确认端点用途与鉴权
  动作: 打开 attempt-run 桥接说明并阅读「端点与鉴权」节
  预期观察: 文档区分 POST 异步派发和 GET 轮询结果，并说明 internalAuthOrLoopback 与宿主/远端 Bearer CECELIA_INTERNAL_TOKEN 要求
  等待预算: 0s
  留证: Vitest 用例输出（端点用途与鉴权 1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "端点用途与鉴权" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L1] B-02: 操作者能从完整九项角色白名单选角
  动作: 阅读「角色白名单」节并逐项核对可派发角色
  预期观察: 九个允许角色逐字齐全，且文档说明白名单外角色会被拒绝
  等待预算: 0s
  留证: Vitest 用例输出（九项角色白名单 1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "九项角色白名单" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L1] B-03: 操作者能正确填写 payload
  动作: 阅读「payload 必填字段」节并按示例构造 POST 请求
  预期观察: sprint_dir、base_repo、branch 明确为必填，base_sha 明确可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 用例输出（payload 必填字段 1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L1] B-04: 操作者能识别派发失败自动回滚终态
  动作: 阅读「派发失败自动回滚」节并核对三类桥接资源终态
  预期观察: 文档明确 run→failed、session→closed、task→cancelled，并限定为本调用新建的资源
  等待预算: 0s
  留证: Vitest 用例输出（派发失败自动回滚 1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L1] B-05: 实现范围只允许新增目标文档
  动作: 对 implementation baseline 与候选 HEAD 做路径级 diff
  预期观察: docs/current 与 packages 范围内唯一变化是 docs/current/attempt-run-bridge-guide.md，packages 无变化
  等待预算: 0s
  留证: git diff 文件清单与 Vitest 范围用例输出
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "实现范围只允许目标文档" --no-cache --reporter=dot'
