# Learning: generator (Red) 混入合同产物 → TDD 闸 × 血统闸 fail-closed 死锁

### 根本原因
- 合同文档（contract-draft/dod/sprint-prd）在 propose 分支未合 main；冻结档下 generator
  Provider 按 skill 指令自行落盘这些文档，随 (Red) 一起 commit → TDD 顺序闸（Red 白名单
  只认 tests/DoD/red-evidence）红。
- fix 想重排历史 → append-only 血统闸判改写 → fail-closed 死锁（r30 run ee2f9ff9 终态 failed）。
- 结构矛盾：两道闸各自正确，冲突点在「合同产物以 untracked 形态进入 Provider 视野」。
- 深层：canonical 文档字节其实一直在 TaskBundle `inputs.contract_artifacts`（封印集
  requireCore 强制三文档），runner 从未消费——只物化了 tests。
- 附带发现：docker/cecelia-runner/__tests__（19 bash + 2 cjs）从未接入任何 CI job（守卫全盲）。

### 下次预防
- 机械闸之间的矛盾要在「进入不可控执行体视野之前」由可信 runner 化解，不能指望 LLM
  Provider 守规则（同 judge-deferred 教训：机械判定不能建立在 LLM 自愿配合之上）。
- 新增闸时列一张「与现有闸交互矩阵」：TDD 闸 v5.1 其实早已预留 import 预提交豁免，
  缺的只是生产侧动作——闸和执行两侧要同 PR 落地，否则豁免规则空转。
- 判「测试已接 CI」必须枚举 workflows 的 glob 范围（memory 教训再验证）：runner 测试套
  整目录盲区两个月无人发现。
- [ ] r31 验证 import commit 在真实 kernel run 中通过 TDD 闸 + 血统闸 + evaluator 全链

### 证据
- fix 陈词：harness_attempts 0a2c004e（方案 b 原文）
- r30 Red commit db7fbea4：DoD.md/red-evidence/tests（白名单内）+ 三文档（白名单外）
- 血统闸 install 断言 HEAD==START_SHA → 预提交必须在闸安装之后（本修复调用点位置的依据）
