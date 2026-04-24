# brain-deploy.sh 幂等检查设计

## 问题

`scripts/brain-deploy.sh` 当前在 Docker 模式下无条件执行 `docker compose up -d`，导致即使 image SHA 未变，也会触发容器 recreate（SIGTERM → 新容器启动）。

触发路径：`/dev cleanup` 合并 Brain PR → 自动跑 `brain-deploy.sh` → `docker compose up -d` → Brain 容器被 recreate → 长跑 Initiative（含多分钟子任务）被 SIGTERM 中断。

影响：P0。每 3 小时左右就有一次误杀，自我驱动能力（Initiative / Rumination）无法稳定运行。

## 目标

让 `brain-deploy.sh` 在 image SHA 未变时跳过容器 recreate，保留容器继续运行。

## 方案

在 `[7/8] Container recreate`（行 135）前插入幂等检查：

```bash
CURRENT_IMG=$(docker inspect cecelia-node-brain --format '{{.Image}}' 2>/dev/null || echo "")
TARGET_IMG=$(docker inspect "cecelia-brain:${VERSION}" --format '{{.Id}}' 2>/dev/null || echo "")
if [[ -n "$CURRENT_IMG" && -n "$TARGET_IMG" && "$CURRENT_IMG" == "$TARGET_IMG" ]]; then
  echo "  [skip] 容器已在 v${VERSION}（image SHA 一致），跳过 recreate"
  DEPLOY_SUCCESS=true
  exit 0
fi
```

关键点：
- `docker inspect cecelia-node-brain --format '{{.Image}}'` 返回当前容器运行的 image SHA（sha256:...）
- `docker inspect "cecelia-brain:${VERSION}" --format '{{.Id}}'` 返回目标 tag 对应的 image SHA
- 两个 SHA 相等 = 容器已经在跑这个版本，没必要 recreate
- 设 `DEPLOY_SUCCESS=true` 让 EXIT trap 写 success 状态，避免 Brain 感知到"deploy 失败"
- 直接 `exit 0`，不做健康检查（容器已经在跑，无需重新等）

## 权衡

**缺点**：跳过会让步骤 8/9/10（cecelia-run / cecelia-bridge / notion-sync）不执行。但这些是 host 脚本自更新和补偿性 sync，下次有真版本变更时会自动补齐。相对"误杀 Initiative"的代价，这是可接受的权衡。

**替代方案**：只跳过 `docker compose up -d`、保留后续健康检查和步骤 8/9/10。但这会让脚本逻辑复杂（需要拆分 if-else 分支）。用户明确要了简单方案（5 行 + `exit 0`），尊重用户选择。

## 验证

DoD：
- [BEHAVIOR] 当 image SHA 一致时跳过 recreate：runs `CURRENT_IMG == TARGET_IMG` 分支并 `exit 0`
- [ARTIFACT] `scripts/brain-deploy.sh` 包含 `docker inspect cecelia-node-brain --format '{{.Image}}'` 字符串

Test：
- `manual:node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.includes('docker inspect cecelia-node-brain --format'))process.exit(1);if(!c.includes('CURRENT_IMG == ') && !c.includes('CURRENT_IMG\" == \"TARGET_IMG'))process.exit(1)"`
- 手动验证：在已跑 v2.x 的机器上 `bash scripts/brain-deploy.sh`，应看到 `[skip] 容器已在 v2.x` 并立即退出

## 范围

- **In scope**：Docker 模式的 `[7/8]` 前加幂等检查
- **Out of scope**：launchd 模式（launchctl kickstart -k 本质就是重启，不在本次修复范围）；build/migrate/selfcheck/version/tag 步骤（这些开销低且有自己的幂等保护）
