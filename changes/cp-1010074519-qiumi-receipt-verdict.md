## Brain {VERSION} — 秋米回执 claimed_result 非 success 一律记失败

- 任务 67bdf128 / 23fc7ab7 的回执自报 `claimed_result=blocked`，但执行进程退出码为 0，被记成 `completed_no_pr`，Notion 显示「已完成」。`rpaExploreFailure` 现在对 skill-factory 非 explore 阶段（如 trial）的回执同样校验 `claimed_result`：非 success 记 failed，原因取 `fail_reason` 或 `result`（截 400 字符）；explore 阶段与非 JSON / 无 `claimed_result` 的回执行为不变。
