## Gate 3 + Gate 2 — Brain CI Auto Deploy & Revert（2026-04-27）

### 根本原因

Brain 部署此前完全依赖手动触发（`workflow_dispatch`）或定时（schedule），缺乏"合并即部署"的自动化闭环。当 post-deploy smoke 失败时，需要人工手动创建 revert PR，响应速度慢且容易遗漏。

### 下次预防

- [ ] 新增 CI workflow 时，优先检查现有 `deploy.yml` 的触发机制，确认是否需要并存（本次两者职责不同：deploy.yml = webhook 间接触发；brain-deploy.yml = SSH 直连触发）
- [ ] 使用 `appleboy/ssh-action@v1` 时，`command_timeout` 需略小于 job `timeout-minutes`（本次 9m vs 10m），避免 SSH 超时被 job 超时覆盖
- [ ] Gate 2 的 `on-deploy-failure` job 需要显式声明 `permissions: contents: write + pull-requests: write`，否则 gh pr create 会因权限不足失败
- [ ] post-deploy smoke 在 GitHub Actions runner 上执行时，目标服务暴露在公网（38.23.47.81:5221），需确保防火墙允许 GitHub Actions IP 段访问
- [ ] Brain 任务状态转换需遵循状态机：`queued → in_progress → completed`，不能从 `queued` 直接跳 `completed`
