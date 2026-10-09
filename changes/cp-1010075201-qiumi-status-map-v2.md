## Brain {VERSION} — 秋米中英文 Notion 状态一一对应：排队中/受阻/失败单独显示（任务 125a0cd2）

- 中文 GTD 表「状态」新增 排队中/受阻/失败，改为与英文 Tasks 库一一对应：queued→排队中/Queued，blocked/paused/quota_exhausted/pending_postdeploy→受阻/Blocked，failed/quarantined/dep_failed→失败/Failed（仍清任务号，拖回「委派」= 重试），cancelled→淘汰/Cancelled，completed→已完成/Done；「推迟」旧页只识别不再写，「委派」只作拉取入口。
- 两个受阻例外：`delegated_device_job`（转手机领单通道）→ 进行中/In Progress；`owner_hold`（主理人自己拖的「阻塞」）→ 中文页不写、英文 Blocked。`[等待中: …]` 措辞改为 `[受阻: …]`。
- `notion-push-sync.js` 的 `TASK_STATUS_TO_NOTION` 补全 paused/quota_exhausted/pending_postdeploy→Blocked、quarantined/dep_failed→Failed、completed_no_pr→Done，queued→Queued、failed→Failed；测试钉住与秋米映射表英文列一致。
- 急停/改期/换设备重派同时认新旧页状态：急停新增读「排队中」页（改期、阻塞拖回恢复），设备重派认 进行中/委派/受阻/排队中；入账后中文页写「排队中」。
- 「cancelled → 淘汰」安全：急停读到「淘汰 ∧ brain:xxx」页时，Brain 任务已是终态（含 cancelled/canceled）则不记取消命令（幂等）；页面是「淘汰」但任务未取消仍按人工态保留，不被覆盖；页面已淘汰且任务已取消时不再 PATCH 中文页。
