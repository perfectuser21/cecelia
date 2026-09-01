---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 产品文档；不改代码、配置或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在于约定路径
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

- [ ] [ARTIFACT] 产品交付范围只有目标文档
  Test: bash -c 'C=$(git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750...HEAD -- docs/current packages apps scripts .github | sort); [ "$C" = "docs/current/attempt-run-bridge-guide.md" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能分别识别创建派发与按 id 查询端点
  动作: 执行冻结测试读取最终中文说明中的两个端点章节
  预期观察: POST 被说明为创建并派发 attempt，GET 被说明为按 id 查询 attempt-run 状态
  等待预算: 0s
  留证: Vitest verbose 输出中的“分别说明两个端点用途”测试结果
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "分别说明两个端点用途" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-02: 宿主与远端鉴权说明安全且可操作
  动作: 执行冻结测试检查鉴权章节与示例凭据表达
  预期观察: 文档同时出现 internalAuthOrLoopback、Bearer、CECELIA_INTERNAL_TOKEN，并明确宿主或远端必须携带且不得写真实 token
  等待预算: 0s
  留证: Vitest verbose 输出中的“说明 internalAuthOrLoopback 与远端 Bearer 鉴权”测试结果
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "说明 internalAuthOrLoopback 与远端 Bearer 鉴权" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-03: 九项角色白名单完整可辨
  动作: 执行冻结测试逐项匹配 PRD 指定的九个角色
  预期观察: planner、proposer、critic、generator、generator-fix、evaluator、evaluator-fix、judge、reporter 均位于明确的白名单章节
  等待预算: 0s
  留证: Vitest verbose 输出中的“列出九项角色白名单”测试结果
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "列出九项角色白名单" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-04: payload 必填与可省略语义无漂移
  动作: 执行冻结测试读取 payload 章节
  预期观察: sprint_dir、base_repo、branch 明确标为必填，base_sha 明确可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest verbose 输出中的“说明 payload 必填字段与 base_sha 省略语义”测试结果
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "说明 payload 必填字段与 base_sha 省略语义" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-05: 派发失败三对象回滚说明完整
  动作: 执行冻结测试检查失败回滚章节
  预期观察: run → failed、session → closed、task → cancelled 三条最终状态同时存在
  等待预算: 0s
  留证: Vitest verbose 输出中的“完整说明派发失败自动回滚状态”测试结果
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "完整说明派发失败自动回滚状态" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-06: 产品交付没有代码或既有文档改动
  动作: 执行冻结测试比较实现基线与候选 HEAD 的产品文件集合
  预期观察: 排除 Sprint 冻结合同后，唯一产品变更为 docs/current/attempt-run-bridge-guide.md
  等待预算: 0s
  留证: Vitest verbose 输出中的“产品交付只新增目标文档且不改代码”测试结果
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "产品交付只新增目标文档且不改代码" --reporter=verbose'

## Invariant 映射

- [凭据安全] 由 B-02 断言只使用环境变量名且明确不得展示真实 token。
- [端点鉴权] 由 B-02 断言两个端点的 `internalAuthOrLoopback` 与远端 Bearer 要求；本 Sprint 不改端点代码。
- [禁止写死环境] 由 B-02 断言 token 使用 `$CECELIA_INTERNAL_TOKEN` 环境变量，不写死环境值。
- [Planner 分支] N/A：本 Sprint 不修改 Planner 派发或分支行为。
