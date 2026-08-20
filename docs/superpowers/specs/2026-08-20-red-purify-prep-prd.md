# Bug PrepPRD：generator (Red) commit 混入合同产物 → TDD 门禁 × 血统闸 fail-closed 死锁

## 症状
r30（run ee2f9ff9）fix 阶段：TDD 顺序门禁要求 (Red) commit 纯净（只含测试），但 generator 的 (Red) commit 混入了合同产物（contract-draft/dod/sprint-prd/tests）→ 门禁红；generator-fix 想重排 commit 历史 → append-only 血统闸判改写历史 → 也红。两闸互锁，run 无路可走，终态 failed。

## 根因假设（已由 attempt 0a2c004e 陈词证实）
合同产物在 propose 分支、未合 main。generator 工作区由 entrypoint 的 materialize-frozen-contract-artifacts.cjs 写入这些文件（untracked）。Provider 做 (Red) commit 时把 untracked 合同文件一起卷进去 → 不纯。结构矛盾，不是 Provider 行为问题。

## 关联上下文
- 相关 Journey：F1 造完真验（journey e6f803f2，line00/f1_dev_loop#step3）
- Brain task：80623752-efb7-4032-bb42-58515fce3ed4
- 相关决策：b14dc8e4（四条线+自举）/ 109dd8eb（产物闸）
- 方案出处：generator-fix 自己的陈词方案 (b)（attempt 0a2c004e，run ee2f9ff9）

## 修法
`docker/cecelia-runner/entrypoint.sh` generator 段：materialize 成功后（≈行 2966 调用点之后）、Provider 开跑之前：
1. 仅 generator 角色（`is_generator_task_bundle`）
2. 从 task_bundle 的 `inputs.artifacts[].path` 取合同产物路径，只 `git add` 其中当前 untracked 的文件
3. 有 staged 内容才 `git commit -m "chore(harness): import contract"`（带显式 git identity `-c user.name/user.email`）；无新物化文件（fix 重入/已提交）→ 无声跳过，幂等
4. 不动任何闸：TDD 闸已有「(Red) 之前的 commit 全部豁免」规则直接吃下；血统闸快照在 pre-push 前拍，视该 commit 为 attempt 自己写的

附带（排队待办 2，同 PR）：产物闸 lint-gp-anchor-artifact 路径清单补 `packages/brain/src/impact-contract/`（#4982 时发现漏判"未触碰"），并让本 PR 带 tests/gp/f1/step3 真 import 守卫满足产物闸。

## Regression Test 计划
`docker/cecelia-runner/__tests__/` bash 测试套（沿 entrypoint-frozen-contract-artifacts.test.sh 模式）：
- RED 用例：generator bundle 物化后 → 工作区存在 `chore(harness): import contract` commit，合同文件不再 untracked（当前实现不产生该 commit → 先红）
- 负向：evaluator 角色不预提交；文件已 tracked（fix 重入）不产生空 commit；非合同 untracked 文件不被卷入
- 修完永久留 CI（brain-ci 已跑 __tests__ bash 套）

## 后续（merge 后，不在本 PR）
重建 runner 镜像 + digest repin 11 处 + fleet rollout → 发 r31

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 守卫 proven-to-fire（亲眼看 RED 用例在无修复时报红）
- [ ] CI 全绿
