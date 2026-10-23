## 换思路

本轮评审文件没有 `## 换思路` 小节，无法采纳一项未写出的具体方案。改用 R-2 提出的逐提交、逐父边核查方向，已在 S-4 和 Q-4 加入可执行命令及失败判据，不再仅凭提交关系和最终差异判断范围。

### R-2
处理: 采纳
说明: S-4 明确固定 initial base 到测试 HEAD 的完整 DAG 每条父边都要核对路径、内容和模式；Q-4 加入对 `git rev-list --reverse --topo-order --parents` 所列每个提交、每个父提交执行 `git diff --no-ext-diff --no-renames --raw --full-index --binary <父SHA> <提交SHA> --`，合并提交也逐父检查。中途改动非 README 程序文件后 revert，即使最终差异为零，仍判失败。用户看到的是明确的不能验收结论；验证时保存各次命令、完整原生输出和退出码，核对两次提交的改动及恢复记录。`lib/source-merge-proof.mjs` 的 `touchedPaths` 已通过遍历提交父边收集历史路径，证实仅比较最终树会遗漏过程；QA 仍独立读实际 Git 并核可信来源投影。
