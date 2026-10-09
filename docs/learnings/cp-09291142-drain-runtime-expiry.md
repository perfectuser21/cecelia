# 部署后排空不解除，派发整体停摆（09-29）

### 根本原因
- 部署先 drain，swap 后 drain-cancel 在端口切换窗口静默失败；新容器 restoreDrainState 只拒绝超过 15 分钟的残留，刚设的 drain 被原样恢复。
- 运行期唯一的解除路径是 getDrainStatus 的 auto-complete（要求 in_progress=0），但它只挂在 HTTP 路由上，且被有头任务/人审卡住的 in_progress 永久钉住。
- 结果：每次部署都可能让派发永久停摆，且完全静默；当天连合 5 个 PR，停摆反复出现。

### 下次预防
- [ ] 任何「暂停」类状态必须有运行期超时兜底，不能只在启动时自愈
- [ ] 任务积压排查先看 /api/brain/tick/status 的 draining 与熔断，再看任务本身
