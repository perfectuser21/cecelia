---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档，不修改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `docs/current/attempt-run-bridge-guide.md` 存在且标题为《attempt-run 桥接使用说明》
  Test: node -e "const c=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!/^# .*attempt-run.*桥接使用说明/m.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 维护者读到两个端点及鉴权用法
  动作: 打开 attempt-run 桥接使用说明的“端点与鉴权”章节
  预期观察: 同页给出 POST 派发、GET 轮询、internalAuthOrLoopback 与宿主/远端 Bearer 要求
  等待预算: 0s
  留证: 校验器 stdout 中的 `OK endpoints`
  Test: manual:bash -c 'node sprints/coding-harness-20260831042346-jlgxtw/tests/verify-attempt-run-guide.mjs endpoints'

- [ ] [BEHAVIOR] [L1] B-02: 维护者读到完整九项角色白名单
  动作: 打开文档的“角色白名单”章节并逐项核对
  预期观察: 九个生产角色逐字出现且明确总数为九项
  等待预算: 0s
  留证: 校验器 stdout 中的 `OK roles`
  Test: manual:bash -c 'node sprints/coding-harness-20260831042346-jlgxtw/tests/verify-attempt-run-guide.mjs roles'

- [ ] [BEHAVIOR] [L1] B-03: 维护者读到 payload 必填项与 base_sha 省略规则
  动作: 打开文档的“payload 字段”章节
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 可省略并由生产 Brain 解析
  等待预算: 0s
  留证: 校验器 stdout 中的 `OK payload`
  Test: manual:bash -c 'node sprints/coding-harness-20260831042346-jlgxtw/tests/verify-attempt-run-guide.mjs payload'

- [ ] [BEHAVIOR] [L1] B-04: 维护者读到派发失败的自动回滚结果
  动作: 打开文档的“派发失败自动回滚”章节
  预期观察: run、session、task 分别落到 failed、closed、cancelled
  等待预算: 0s
  留证: 校验器 stdout 中的 `OK rollback`
  Test: manual:bash -c 'node sprints/coding-harness-20260831042346-jlgxtw/tests/verify-attempt-run-guide.mjs rollback'

- [ ] [BEHAVIOR] [L1] B-05: 交付保持中文且不要求生产代码变更
  动作: 对目标文档运行整体验收校验
  预期观察: 中文字符存在，四类内容一次性通过；实现范围只包含目标文档
  等待预算: 0s
  留证: 校验器 stdout 中的 `OK all` 与 git diff 文件清单
  Test: manual:bash -c 'node sprints/coding-harness-20260831042346-jlgxtw/tests/verify-attempt-run-guide.mjs all && git diff --name-only f06b922d05c1105783b66c22b5912d3430dc2d44...HEAD | awk '\''!/^docs\/current\/attempt-run-bridge-guide.md$/ && !/^sprints\/coding-harness-20260831042346-jlgxtw\// {bad=1} END {exit bad ? 1 : 0}'\'''

## 铁律映射

- 语言规则：B-05 机器检查中文字符。
- 分支规则：实现必须通过 `cp-*` 分支与 PR，禁止直接推送 main。
- Brain DevGate：N/A，本 sprint 不修改 `packages/brain`。
- Bug 修复先红测试：N/A，本 sprint 是文档新增；冻结测试仍先于实现落盘并产生 RED。
- 凭据管理：示例只引用环境变量名，不写入 token 值。

