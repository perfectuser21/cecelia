# Brain Keepalive 自动重启设计

**Goal:** 将 `scripts/ops/brain-keepalive-check.sh` 从"只发告警"升级为"先自动重启，失败才告警"

**Architecture:** 单一 shell 脚本修改，launchd 每 60s 触发一次，发现 Brain 不在运行时先尝试 `docker compose up -d node-brain`，等 15s 确认，成功发恢复通知，失败才发 P0 告警。

**Tech Stack:** bash, docker compose, launchd

---

## 行为变更

| 触发条件 | 旧行为 | 新行为 |
|---------|--------|--------|
| Brain 不在运行，state file 不存在 | 发 P0 告警，写 state file | 执行 `docker compose up -d node-brain`，等 15s 确认 |
| 重启后健康 | — | 发"已自动重启"通知，不写 state file |
| 重启后仍失败 | — | 发 P0 告警，写 state file |
| Brain 不在运行，state file 已存在 | SILENCED（不重复告警） | SILENCED（不重复触发重启） |
| Brain 在运行，state file 存在 | 发恢复通知，删 state file | 同左（不变） |
| Brain 在运行，state file 不存在 | OK 日志 | 同左（不变） |

## 实现细节

**文件：** `scripts/ops/brain-keepalive-check.sh`

新增变量：
```bash
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"
```

not-running 分支逻辑：
```
if state file 不存在:
  docker compose -f $COMPOSE_FILE up -d node-brain
  sleep 15
  re-check status
  if running:
    send_feishu "✅ Brain 已自动重启恢复"
    (不写 state file)
  else:
    send_feishu "🚨 [P0] Brain 停止且自动重启失败"
    touch $STATE_FILE
else:
  echo SILENCED（已在告警中，不重复重启）
```

## 成功标准

- Brain 挂掉后 60s 内自动拉起（launchd 60s interval + 15s wait ≤ 75s）
- 重启失败时才发 P0 飞书告警
- state file 防止重复重启（每 60s 最多触发一次，失败后 SILENCED）

## 测试策略

- `fix:` 类型 PR，不触及 `brain/src/`，CI lint 规则不强制 smoke.sh
- `manual:` 静态检查：`grep -q "docker compose" scripts/ops/brain-keepalive-check.sh`
- `manual:` 验证 state file 防重逻辑存在：`grep -q "STATE_FILE" scripts/ops/brain-keepalive-check.sh`
