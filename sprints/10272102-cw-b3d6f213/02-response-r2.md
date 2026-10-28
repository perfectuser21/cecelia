### R-2
处理: 采纳
说明: 当前 `new-task.mjs` 的 `validatePlan()` 会保留 plan 字段，但 `body()` 只发送已有 payload 字段；手工 POST 确实绕过了 I-3 所要求的入口。S-3 明确 Q-1 必须调用固定 HEAD 的 `new-task.mjs`，Q-1 改为由 QA 使用控制器预备的 plan、预览桥和传输配置实际建单，核 CLI 输出 ID、真实任务 API 中的受管声明、intent 输入及新 01 引用事实。若入口漏字段，任务会显示 `unconfigured` 或缺少引用，Q-1 不得通过。Q-2 至 Q-4 可继续用直接 POST 核版本和拒绝行为；S-5 的本地假服务回归不代替 Q-1 的真实预览接缝。
