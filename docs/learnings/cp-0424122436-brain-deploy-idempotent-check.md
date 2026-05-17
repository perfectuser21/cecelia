# Learning: brain-deploy.sh 幂等检查

## 现象

Brain 容器每 3 小时左右被 recreate 一次，长跑 Initiative（含多分钟子任务）被 SIGTERM 中断。

### 根本原因

`scripts/brain-deploy.sh` 在 Docker 模式下无条件执行 `docker compose up -d`。

触发链：
1. `/dev cleanup` 合并 Brain PR 后自动调用 `brain-deploy.sh`
2. 即使镜像 SHA 未变（Dockerfile 未变 / 代码未进 image），`docker compose up -d` 仍会 recreate 容器
3. 新容器启动时对旧容器发 SIGTERM → 长跑 Initiative 被打断

叠加"每合并一次 Brain PR 就触发 deploy"的自动化路径，导致每几个 PR 合并周期就炸一次容器。

### 修复

在 `[7/8] Starting container...` 块内、`docker compose up -d` 前插入 image SHA 比对：

```bash
CURRENT_IMG=$(docker inspect cecelia-node-brain --format '{{.Image}}' 2>/dev/null || echo "")
TARGET_IMG=$(docker inspect "cecelia-brain:${VERSION}" --format '{{.Id}}' 2>/dev/null || echo "")
if [[ "$DRY_RUN" == false && -n "$CURRENT_IMG" && -n "$TARGET_IMG" && "$CURRENT_IMG" == "$TARGET_IMG" ]]; then
    echo "  [skip] 容器已在 v${VERSION}（image SHA 一致），跳过 recreate"
    DEPLOY_SUCCESS=true
    exit 0
fi
```

两个 SHA 相等 = 容器已在目标版本，无需 recreate。设 `DEPLOY_SUCCESS=true` 让 EXIT trap 写 success 状态文件，避免 Brain 感知为"deploy 失败"。

### 下次预防

- [ ] 所有 deploy 脚本在调用会导致容器 recreate 的命令前，必须有幂等检查（image SHA / config hash）
- [ ] 不要依赖 `docker compose up -d` 的"幂等"错觉——即使镜像未变，显式 `up -d` 仍会触发 recreate
- [ ] 长跑任务要考虑部署中断，但更根本的修复是让部署本身具备幂等性
- [ ] 权衡：跳过 recreate 会让步骤 8/9/10（cecelia-run/bridge/notion-sync 自更新）不执行，但下次真版本变更会自动补齐，相比"误杀 Initiative"更可接受
