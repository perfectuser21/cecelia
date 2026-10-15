### R-1
处理: 采纳
说明: `status.mjs` 的 `parseReceipt` 仅检查对象是否有 `last_event`，或 `status` 是否为三种终态；`receipt.mjs` 对缺 PR URL 的 completed 返回 `pr_url_missing`。S-2 已按这个最小条件改写，明确非回执 JSON 也可能显示 completed，用户不能凭标签确认回执真伪；Q-4 增加 `{"status":"completed","outputs":{}}` 的真人 CLI 场景，验证它显示 completed 与 `pr_url_missing`，同时保留无判读字段的非回执 JSON 显示 unreadable 的检查。
