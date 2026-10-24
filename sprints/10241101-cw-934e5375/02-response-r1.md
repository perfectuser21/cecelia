### R-1
处理: 采纳
说明: S-3、Q-3 已把最终诊断目标改为任务实际所属 Brain 的只读 `GET /api/brain/tasks/<task_id>`，明确预览能力只服务当前 PR/head，关闭后不能用于最终终态核对。运维可按 README 核对 `runner.phase`、`merge.merged` 和 QA 终态；本轮 QA 用自造回执实际运行 CLI、人工检查文档中的查询入口并记录真实终态未查询，符合 I-3 的本轮不调用生产边界。依据是现有 README“独立预览 QA 边界”规定能力关闭不可复用，`lib/brain.mjs` 的 `getTask` 使用上述 GET 入口。

### R-2
处理: 采纳
说明: S-4、S-5、Q-4 已补充固定基线至 HEAD 的逐提交核验：先以 `git rev-list --parents --topo-order` 列出提交及父 SHA，再对每个父提交执行 `git diff --raw --no-renames <父SHA> <提交SHA>`，读取路径、状态及旧/新 mode，覆盖普通提交与两父合并。这样配置文件的修改及后续 revert 会分别留在提交差异中；本任务自产越界改动或上游触及本任务 README/报告均失败，归属缺证记 `CANNOT_VERIFY`，不能被最终树的空差异掩盖。
