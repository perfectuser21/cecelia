---
task_id: 3a15fcff-3af4-49b4-a4c2-b0c7c743ef49
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 7
场景覆盖: 7
回归风险: 6
可执行: 7

### R-1
针对: S-4, Q-4, I-4
严重度: 阻断
场景: 开发者在固定基线后的第一个提交改动测试文件，第二个提交又恢复原字节；QA 照 Q-4 所列 `git log --parents` 和基线到 HEAD 的 `git diff --name-status` 核查，看到提交身份却看不到该测试文件曾被改动，从而把越界改动误判为可归属。
依据: I-4 明确要求固定 initial base 的完整 DAG、逐提交归属，并拒绝改后 revert；Q-4 列出的 `git log --parents --format='%H %P'` 只给提交和父 SHA，`git diff --name-status <base> HEAD` 只给最终差异，均不显示中间提交的路径、blob 或 mode 变化。S-4 的发布前命令清单也只有最终差异与当前现场。
说明: 在发布前 verify 和当前 QA 的验收操作中明确对固定基线至 HEAD 的每个提交读取其相对父提交的路径、内容与 mode 变化，合并提交逐父核对；任何自产越界改动即使随后恢复也拒绝。过去暂存区、工作区的历史变化仍只交给当时原生证据与独立外层核验，不能用当前 Git 补判。
