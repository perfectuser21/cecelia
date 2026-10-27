### R-1
处理: 采纳
说明: `new-task.mjs` 的 `validatePlan` 经 `resolveRepo` 拒绝未登记仓库，原 Q-1 的临时仓库建单步骤确会失败。S-1 明确由交付代码常量固定可信索引路径和 Git SHA，S-2 明确 `authority` 计划字段及 `payload.authority` 传递；Q-1/Q-2 改为在已登记 `cecelia` 仓库的隔离克隆中提交正文，以 `--repo cecelia` 建单，并先只读核对独立锚、四类 path/kind 登记与 initial base。任务自身提交或修改索引不能授权自己。验证：真人按 Q-1 建单运行 intent 可见四类 found 与 Git blob 摘要一致；Q-2 的 V1/V2 回放分别取指定版本，package.json 冒名及未固定索引修改不能得到 found。缺预先可信锚时如实报当前产品场景不可验，不伪称通过。
