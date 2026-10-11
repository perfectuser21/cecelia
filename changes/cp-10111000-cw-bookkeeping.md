## Brain {VERSION} — coding workflow 记账修正：运行结果以合并为准、合并刷新交接单、CI 修复尝试编号不复用

- 迁移 546：`spans_rollup_run` 认终态 span（`evidence.run_terminal = true`）——运行结果取该 span 结果并转 owner（之后只加费用）；没有终态 span 照旧按最差结果。回填已有合并 pass span 的 coding workflow 运行（金丝雀 4 #6232 在 Notion「最近执行」显示失败）
- 合并门：合并 span 标 run_terminal；合并后回写 `runner.phase = merged`（保留原字段）与合并交接单（PR 链接、分支、合并 head、QA 轮次与花费，下一步「完成，无下一步」，`synthesized: false`）
- CI 修复：尝试编号连同 commander 归档的 `archived_attempts` 往后数，span 幂等键 `ci_fix:<pr>:<n>` 不再撞旧记录（409 整批丢失）
