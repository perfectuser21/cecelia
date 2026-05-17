---
branch: cp-04060407-520aceea-6332-4908-8a6f-15409e
task_id: 520aceea-6332-4908-8a6f-15409ed431d0
date: 2026-04-06
type: diagnosis
---

# Learning: Deploy CI 死锁根因

## 现象

Deploy workflow 的 `Trigger Deploy` job 连续 0秒失败（Fast Lane 路径），持续约 1.5 小时（08:12 ~ 09:01 UTC）。

## 根本原因

### 根因 1：job-level + workflow-level 同名 concurrency 死锁

```yaml
# workflow level
concurrency:
  group: deploy-production   # ← 持有锁

jobs:
  deploy:
    # job level (已移除)
    concurrency: deploy-production   # ← 尝试获取同名锁 → 死锁
```

GitHub Actions 中，同一 workflow run 里 job-level concurrency 与 workflow-level concurrency 同名时，job 进入排队等待自己释放锁的死锁状态，表现为 job 立即失败（0s）。

### 根因 2：BRAIN_URL 默认值指向无效域名

```yaml
BRAIN_URL: ${{ secrets.BRAIN_DEPLOY_URL || 'http://dev-autopilot:5221' }}
# dev-autopilot 域名不可达 → 404 → deploy 失败
```

## 修复（PR #1953）

1. 移除 `deploy` job 的 `concurrency: deploy-production` 配置
2. 将 BRAIN_URL 默认值改为 `http://38.23.47.81:5221`
3. shepherd.js 中补充 PR merge 后 task 状态回写

## 下次预防

- [ ] 新增 `concurrency` 配置时，检查是否与 workflow-level 同名
- [ ] CI 中写 `secrets.X || 'default'` 时，确认 default 值在当前网络可达
- [ ] 0s 失败的 job 优先检查 concurrency 死锁（不是权限/配置问题）
