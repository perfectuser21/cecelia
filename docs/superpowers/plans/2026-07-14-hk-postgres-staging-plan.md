# 刀3-T2 Implementation Plan

> **For agentic workers:** 本计划由主会话按序执行（实操类，涉及 ssh 生产资源与 1Password，不派 worktree 隔离 subagent）。

**Goal:** HK 起独立 postgres + staging 库迁入零漂移 + 备份 cron + 证据 PR。

### Task 1: repo 交付物（4 文件）＋ bash -n ＋ commit

按 spec §Repo 交付物写 `scripts/zj-migrate-hk/{docker-compose.db.yml,backup-zenithjoy-hk.sh,compare-us-hk.sh,README.md}`；`bash -n` 两脚本过；commit "feat(zj-migrate-hk): T2 HK postgres 栈交付物"。

### Task 2: 密钥（1Password → 双写）

`openssl rand -base64 24` 生成 → `op item create --category password --vault CS --title "ZenithJoy HK Postgres"` → 写 `~/.credentials/zenithjoy-hk-db.env`（chmod 600）→ HK `/opt/zenithjoy/db/.env`（chmod 600）。

### Task 3: HK 起栈（前置证据快照 → up → 双判据验证）

证据（前）：`docker ps --format '{{.Names}}' | sort` + runner unit 状态（enabled 应为空）。
scp compose 到 HK `/opt/zenithjoy/db/` → up -d → pg_isready + restart policy + volume 检查 → `docker compose restart` 后重验（持久化判据）。

### Task 4: dump/restore + compare 零漂移

美国 `pg_dump -Fc zenithjoy_staging` → scp → HK `createdb` + `pg_restore --clean --if-exists --no-owner --no-privileges` → 本机跑 `compare-us-hk.sh zenithjoy_staging` exit 0、输出存档。

### Task 5: 备份 cron + TZ 证据

scp backup 脚本到 HK `/opt/zenithjoy/db/` → root crontab 加 `CRON_TZ=Asia/Shanghai` + 03:30 行 → 手跑一次验证产物 → `crontab -l` + HK `date` 输出存证。

### Task 6: 证据（后）+ PR + watchdog + handoff

docker ps/runner 快照（后）+ diff → compare 输出等证据写 PR body → push（--no-verify）→ PR → engine-pr-watchdog → Brain completed + handoff。
