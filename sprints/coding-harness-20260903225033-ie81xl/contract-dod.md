---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 一页中文说明存在，页面标题为《attempt-run 桥接使用说明》
  Test: node sprints/coding-harness-20260903225033-ie81xl/tests/contract-oracles.mjs chinese

- [ ] [ARTIFACT] 冻结回归测试存在且 Test Contract 可解析
  Test: node -e "require('fs').accessSync('sprints/coding-harness-20260903225033-ie81xl/tests/attempt-run-bridge-guide.test.ts')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能识别两个端点用途与远端鉴权
  动作: 打开说明的“端点用途与鉴权”章节。
  预期观察: POST/GET 用途、internalAuthOrLoopback 及 Bearer CECELIA_INTERNAL_TOKEN 均明确，且无绕过表述。
  等待预算: 0s
  留证: oracle stdout 中的 P1/N1 结果
  Test: manual:bash -c 'node sprints/coding-harness-20260903225033-ie81xl/tests/contract-oracles.mjs endpoint-auth'

- [ ] [BEHAVIOR] [L1] B-02: 读者看到逐项列出的封闭九角色白名单
  动作: 打开说明的“角色白名单”章节并逐项核对。
  预期观察: 九项先逐项列出再声明恰好 9 项，且无未知角色或“等”式省略。
  等待预算: 0s
  留证: oracle stdout 中的 P2/N2 结果
  Test: manual:bash -c 'node sprints/coding-harness-20260903225033-ie81xl/tests/contract-oracles.mjs roles'

- [ ] [BEHAVIOR] [L1] B-03: 读者能构造必填字段恰好三项的 payload
  动作: 打开说明的“payload 字段”章节并逐项核对。
  预期观察: sprint_dir/base_repo/branch 先逐项列出再声明恰好 3 项，base_sha 明确可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: oracle stdout 中的 P3/N3 结果
  Test: manual:bash -c 'node sprints/coding-harness-20260903225033-ie81xl/tests/contract-oracles.mjs payload'

- [ ] [BEHAVIOR] [L1] B-04: 读者能判读派发失败的三个自动回滚结果
  动作: 打开说明的“派发失败自动回滚”章节并逐项核对。
  预期观察: 三项状态转换先逐项列出再声明恰好 3 项，且不要求调用方修补。
  等待预算: 0s
  留证: oracle stdout 中的 P4/N4 结果
  Test: manual:bash -c 'node sprints/coding-harness-20260903225033-ie81xl/tests/contract-oracles.mjs rollback'

- [ ] [BEHAVIOR] [L1] B-05: 最终提交仅改变唯一允许的产品文档
  动作: 相对冻结实现基线检查完整提交 diff，并排除本 sprint 冻结合同目录。
  预期观察: 产品改动列表恰好一行 docs/current/attempt-run-bridge-guide.md，任何代码或第二页文档都会失败。
  等待预算: 0s
  留证: git diff --name-only 输出
  Test: manual:bash -c 'BASE_SHA="f277cc41ebc2ae7c4669f1c77e487663be2680e6"; SPRINT_DIR="sprints/coding-harness-20260903225033-ie81xl"; CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR/**"); [ "$CHANGED" = "docs/current/attempt-run-bridge-guide.md" ]'

## Invariant 映射

- [凭据安全] INV-1：B-01 的 N1 拒绝真实 token 样式，只允许环境变量名。
- [端点鉴权] INV-2：B-01 要求两端点均说明 `internalAuthOrLoopback`。
- [环境假设] INV-3：N/A，本任务不新增环境值；固定 SHA 是合同冻结基线而非环境假设。
- [真环境验证] INV-4：N/A，静态文档无真实调用接缝。
- [分支权威] INV-5：B-05 固定实现基线，不替换服务端签发分支。
