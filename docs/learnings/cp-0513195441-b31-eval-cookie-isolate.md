# Learning — B31 Evaluator cookie 隔离

### 根本原因
Cecelia 多 W 任务并发跑 evaluator 或同任务 fix loop N round 跑同 evaluator，如果用浏览器默认 profile，前次 cookies/localStorage 会污染下次结果。Playwright 默认 newContext 但配置不当（如复用 userDataDir）会破隔离。

### 下次预防
- [ ] Web UI evaluator 强制 Playwright newContext + storageState undefined
- [ ] 临时 userDataDir 用 /tmp/playwright-$TASK_ID（跑完 cleanup）
- [ ] 需要持久登录态时显式 storageState=path/to/auth.json（B32 配套）
- [ ] 严禁复用 ~/.config/chromium/Default profile
