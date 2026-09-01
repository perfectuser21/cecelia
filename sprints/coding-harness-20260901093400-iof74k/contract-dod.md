---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 目标文档存在，且除合同产物外实现提交不修改代码或其他文档
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';if(!fs.existsSync(p))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者看到两个端点的用途与安全鉴权说明
  动作: 打开《attempt-run 桥接使用说明》的端点与鉴权一节
  预期观察: POST/GET 用途、internalAuthOrLoopback 与宿主或远端 Bearer 要求均明确，且不含真实 token
  等待预算: 0s
  留证: Vitest 对应测试输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "文档包含两个端点用途与 Bearer 鉴权说明"'

- [ ] [BEHAVIOR] [L1] B-02: 读者看到恰好九项角色白名单
  动作: 打开文档的「角色白名单」一节并逐项核对
  预期观察: 九项角色与冻结 PRD 指定列表完全相等，没有省略或额外角色
  等待预算: 0s
  留证: Vitest 对应测试输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好列出 PRD 指定的九项角色"'

- [ ] [BEHAVIOR] [L1] B-03: 读者能正确构造 POST payload
  动作: 打开文档的「POST payload」一节并核对字段要求
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 对应测试输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "payload 说明三个必填字段且 base_sha 可省略并由生产 Brain 自解析"'

- [ ] [BEHAVIOR] [L1] B-04: 读者能判断派发失败已自动收口
  动作: 打开文档的「派发失败自动回滚」一节并核对三类对象终态
  预期观察: 同时看到 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: Vitest 对应测试输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "派发失败说明 run session task 三类对象的自动回滚终态"'

- [ ] [BEHAVIOR] [L1] B-05: 实现范围不越过目标文档
  动作: 比较实现提交与冻结实现基线的 docs/packages/apps 文件差异
  预期观察: 目标文档之外的实现文件变更数为零
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'test "$(git diff --name-only 6496b3ba2e74f278f60fedb621127cde6c618108...HEAD -- docs packages apps | grep -v "^docs/current/attempt-run-bridge-guide\\.md$" | wc -l | tr -d " ")" = 0'

## Invariant 映射

- [凭据安全] 由 B-01 的占位变量与 E2E 高熵 Bearer 检查覆盖。
- [端点鉴权] 由 B-01 明确两个端点均采用 `internalAuthOrLoopback` 覆盖。
- [环境假设] N/A：纯静态文档，不写死环境地址或校准值。
- [真环境验证] N/A：不修改真实调用链，仅记录已有契约。
- [Planner 分支] N/A：本 Sprint 不修改 Planner 或分支签发行为。
