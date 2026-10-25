---
task_id: 3d11e9d3-3660-4412-afba-722c7a1936c3
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 6
场景覆盖: 6
回归风险: 6
可执行: 7

### R-1
针对: S-4, Q-4, I-4
严重度: 阻断
场景: 开发者先在一个提交里改动需求外的程序文件，下一提交又还原；QA 按 Q-4 执行后只看到提交编号和最终 README 差异，漏掉这次越界改动并给出范围通过结论。
依据: S-4 和 Q-4 列出的 `git rev-list --parents --reverse <base>..HEAD` 只给提交及父节点，`git diff --name-status <base> HEAD` 只给终态差异；Q-4 的逐提交核对只点名 README、报告和 manifest，没有要求枚举每个提交相对各父节点改过的全部路径。I-4 明确要求完整 DAG、逐提交归属，并拒绝改后 revert。
说明: 把逐提交全路径及 blob/mode 枚举写成 Q-4 的实际只读操作，覆盖普通提交与合并提交的各父边；再用该清单判定所有自产路径和改后 revert，不能只凭最终 diff 或已知文件清单放行。
