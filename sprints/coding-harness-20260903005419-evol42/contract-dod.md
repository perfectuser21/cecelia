---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

task_request_hash=1838c4d9069d5b08f980716d3d248df5f1cd7a8d03b585d3c89b8195798071dc

**范围**: 仅新增 `docs/current/attempt-run-桥接使用说明.md`；合同测试及合同文件位于本 sprint 目录。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在且标题为《attempt-run 桥接使用说明》
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-桥接使用说明.md';const s=fs.readFileSync(p,'utf8');if(!/^# attempt-run 桥接使用说明/m.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能识别两个端点用途与正确鉴权
  动作: 打开说明文档并阅读“端点用途”和“鉴权”章节
  预期观察: POST/GET 用途明确，loopback 与宿主/远端 Bearer 规则无歧义，示例无真实 token
  等待预算: 0s
  留证: Vitest 输出中“端点用途与鉴权说明完整”通过
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "端点用途与鉴权说明完整"'

- [ ] [BEHAVIOR] [L1] B-02: 角色白名单形成恰好九项封闭集合
  动作: 阅读“角色白名单”章节并逐项与生产导出的 ALLOWED_ROLES 比较
  预期观察: 九项集合完全相等，集合外角色明确被拒绝，正向与负向 oracle 同时成立
  等待预算: 0s
  留证: Vitest 输出中“角色白名单是恰好九项的封闭集合”通过
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "角色白名单是恰好九项的封闭集合"'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填与可省略字段可直接照用
  动作: 阅读 payload 章节并检查必填清单及 base_sha 说明
  预期观察: sprint_dir/base_repo/branch 恰为必填项，base_sha 可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中“payload 必填与可省略字段无歧义”通过
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "payload 必填与可省略字段无歧义"'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败状态被解释为完整回滚
  动作: 阅读“派发失败自动回滚”章节并核对三个资源状态
  预期观察: 同时看到 run → failed、session → closed、task → cancelled，且失败不被描述成半成功
  等待预算: 0s
  留证: Vitest 输出中“派发失败完整回滚且不是半成功”通过
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "派发失败完整回滚且不是半成功"'

- [ ] [BEHAVIOR] [L1] B-05: 提交范围不包含任何产品代码
  动作: 以冻结实现基线计算 HEAD 的 canonical 文件差异并筛选允许路径
  预期观察: 仅目标新文档和本 sprint 合同产物出现，packages/apps/scripts/.github 零改动
  等待预算: 0s
  留证: git diff 文件清单与命令退出码
  Test: manual:bash -c 'BASE_SHA=6230da4a13fad9e43d6316b70914b5b69033ef37; UNEXPECTED=$(git diff --name-only "$BASE_SHA"...HEAD | awk '\''!/^docs\/current\/attempt-run-桥接使用说明\.md$/ && !/^sprints\/coding-harness-20260903005419-evol42\//'\''); [ -z "$UNEXPECTED" ] || { echo "FAIL: 范围外改动: $UNEXPECTED"; exit 1; }; test -z "$(git diff --name-only "$BASE_SHA"...HEAD -- packages apps scripts .github)"'

## Invariant 映射

- INV-1 端点鉴权 → B-01 机检两个端点均使用 internalAuthOrLoopback，且远端 Bearer 不可省略。
- INV-2 凭据安全 → B-01 拒绝真实 token 形态，示例仅允许 CECELIA_INTERNAL_TOKEN 占位。
- INV-3 环境假设 → N/A：纯文档不写死运行环境值；BASE_SHA 是冻结实现身份而非环境假设。
- INV-4 真环境验证 → N/A：PRD 明确不验证真实派发副作用。
- INV-5 Planner 分支 → N/A：本 sprint 不修改 planner workspace 行为。
- INV-6 单槽串行 → N/A：本 sprint 不修改派发并发行为。
