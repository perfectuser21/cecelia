---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不修改产品代码或其他文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档是唯一产品交付文件
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 两个端点用途完整
  动作: 阅读说明中的端点用途章节
  预期观察: POST 被说明为创建并异步派发，GET 被说明为按 attempt id 查询结构化结果
  等待预算: 0s
  留证: Vitest 输出中“两个端点用途完整”用例结果
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途完整" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-02: 鉴权与九项角色白名单准确
  动作: 按文档准备宿主或远端请求并核对可用角色
  预期观察: 文档要求 Bearer CECELIA_INTERNAL_TOKEN，区分 loopback，并只列出权威九项角色
  等待预算: 0s
  留证: Vitest 输出中“鉴权与九项角色白名单准确”用例结果
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "鉴权与九项角色白名单准确" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填项与可选 base_sha 准确
  动作: 按文档构造 POST payload
  预期观察: sprint_dir、base_repo、branch 被标为必填，base_sha 被标为可省略且由生产 Brain 解析
  等待预算: 0s
  留证: Vitest 输出中“payload 必填项与可选 base_sha 准确”用例结果
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "payload 必填项与可选 base_sha 准确" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败三对象回滚完整
  动作: 阅读派发失败处置章节并核对三个对象终态
  预期观察: 文档同时给出 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: Vitest 输出中“派发失败三对象回滚完整”用例结果
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "派发失败三对象回滚完整" --reporter=verbose'

## Invariant 映射

- INV-1 语义判定：本任务无通知或写库接口，N/A；文档验收逐项检查状态语义而非 `ok:true`。
- INV-2 环境来源：本任务不读取或改变 target_environment，N/A。
- INV-3 真实历史：不复用历史合同断言；测试读取本次固定文档路径与当前提交，N/A。
- INV-4 共享禁区：合同未授权共享 CI 变更；E2E 用实现基线 diff 范围机械拦截。
