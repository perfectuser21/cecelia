---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 2 轮）

## 评分
意图对齐: 8
可验证: 6
场景覆盖: 7
回归风险: 7
可执行: 7

## 上轮问题
- R-1: 关闭 —— S-2 已按 `/pull/<编号>` 的实际匹配规则改写，Q-2 已加入非 GitHub URL 和同编号 `cifix-37.json` 的真实 CLI 验证。

### R-2
针对: S-4, Q-4, I-4
严重度: 阻断
场景: 开发方在基线之后的一个提交改动了非 README 程序文件，下一提交又恢复原字节；QA 照 Q-4 执行 `git rev-list --parents` 和基线到 HEAD 的 `git diff --name-status`，只看到两个提交哈希及最终零差异，误判越界修改未发生。
依据: I-4 明确要求“先改后 revert 也不能因最终字节相同而放行”；Q-4 列出的 `git rev-list --parents` 只列提交关系，三条 `git diff --name-status` 只比较当时端点或工作区，没有列出每个提交实际改动的路径、内容和模式。S-4 虽要求“逐提交区分”，但 Q-4 没有可执行的逐提交检查步骤。
说明: 在 Q-4 写明如何沿固定 initial base 到测试 HEAD 的完整 DAG，逐提交核对所有父边上的改动路径、内容与模式，并将中途越界修改及后续 revert 判为失败；保留命令、完整输出和退出码作为本轮证据。
