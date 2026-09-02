---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不改代码或其他文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于唯一约定路径
  Test: `node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"`

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者能区分两个端点用途
  动作: 打开说明文档并阅读 POST 与 GET 两节
  预期观察: POST 被说明为异步派发，GET 被说明为按 attempt id 轮询结构化结果
  等待预算: 0s
  留证: Vitest 输出中“两个端点用途”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途"'

- [ ] [BEHAVIOR] [L2] B-02: 宿主或远端能按鉴权和九项白名单准备请求
  动作: 阅读鉴权与角色白名单两节
  预期观察: 文档要求 Bearer token，并列出恰好九个生产角色且不开放扩展
  等待预算: 0s
  留证: Vitest 输出中“鉴权与九项角色白名单”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "鉴权与九项角色白名单"'

- [ ] [BEHAVIOR] [L2] B-03: 调用方能正确构造 payload
  动作: 阅读 payload 字段节并区分必填与可省略字段
  预期观察: sprint_dir、base_repo、branch 为必填，base_sha 可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中“payload 必填字段”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段"'

- [ ] [BEHAVIOR] [L2] B-04: 读者能识别派发失败后的完整回滚
  动作: 阅读失败处理节并核对 run、session、task 三对象终态
  预期观察: 文档同时显示 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: Vitest 输出中“派发失败自动回滚”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚"'

- [ ] [BEHAVIOR] [L2] B-05: 交付范围不包含代码或第二份生产文档
  动作: 对冻结实现基线与候选 HEAD 执行 canonical git diff
  预期观察: 生产交付变化仅为约定说明文档，其他变化仅为本 sprint 合同产物
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'BASE_SHA=d32b864de5adf8d3083c91f31ed3f5f7f58be985; git diff --name-only "$BASE_SHA"...HEAD | awk '\''!/^docs\/current\/attempt-run-bridge-guide\.md$/ && !/^sprints\/coding-harness-20260902140724-6b5mog\/(contract-draft\.md|contract-dod\.md|task-plan\.json|tests\/attempt-run-bridge-guide\.test\.ts)$/{bad=1} END{exit bad}'\'''

## Invariant 映射

- INV-1 语义判定：N/A，本单不调用通知或写库接口；文档测试校验具体用途和终态而非 `ok:true`。
- INV-2 环境来源：N/A，本单不读取或改变 `target_environment`。
- INV-3 真实历史：N/A，本单不复用历史运行结果作为通过证据。
- INV-4 共享禁区：由 B-05 证明不修改共享 CI 或代码。
