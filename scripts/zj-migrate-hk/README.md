# zj-migrate-hk — 拆库刀3 迁移工具集

方案 SSOT：`docs/architecture/2026-07-14-zj-migrate-hk/architecture.md`。本目录是 T2 起的可复用交付物。

## 文件

| 文件 | 用途 | 部署位置 |
|---|---|---|
| `docker-compose.db.yml` | HK 独立 postgres 栈（T1 §1 候选 A） | hk-vps `/opt/zenithjoy/db/docker-compose.yml` |
| `backup-zenithjoy-hk.sh` | HK 本地每日备份（03:30，保留 14 天） | hk-vps `/opt/zenithjoy/db/backup-zenithjoy-hk.sh` |
| `compare-us-hk.sh` | US↔HK 全量表零漂移核对 | 美国本机运行 |

## 部署步骤（T2）

1. 密码：1Password CS「ZenithJoy HK Postgres」为唯一源，双写本机 `~/.credentials/zenithjoy-hk-db.env` 与 HK `/opt/zenithjoy/db/.env`（均 chmod 600，禁 git）。
2. HK 起栈：`cd /opt/zenithjoy/db && COMPOSE_PROJECT_NAME=zenithjoy-db docker compose up -d`，验证 `docker exec zenithjoy-db-postgres pg_isready -U zenithjoy`。
3. staging 迁移：见 T1 文档 §2 迁移主命令序列（pg_dump -Fc → scp → createdb + pg_restore --clean --if-exists --no-owner --no-privileges）。
4. 核对：`bash scripts/zj-migrate-hk/compare-us-hk.sh zenithjoy_staging`，exit 0 = 零漂移。
5. 备份 cron（root crontab）：`30 3 * * * /opt/zenithjoy/db/backup-zenithjoy-hk.sh >> /opt/zenithjoy-backups/hk-local/backup.log 2>&1`。
   时区依据：HK 系统时区 = Asia/Shanghai（`timedatectl` 为证），crontab 直接按北京时间触发；Ubuntu vixie cron **不支持 CRON_TZ**，勿以 CRON_TZ 行为调度依据。

## 回滚（T1 回滚表 T2-1）

```bash
# 全撤 HK postgres 栈（连数据卷）：
cd /opt/zenithjoy/db && COMPOSE_PROJECT_NAME=zenithjoy-db docker compose down -v
# 判据：docker ps -a | grep zenithjoy-db 无输出；ss -ltn | grep 5432 无输出
```

## 铁律

- 写入侧仍在美国（T1 §4 SSOT 规则），HK 库在 T3 切流前只允许 restore/compare。
- 12 个 disabled GitHub runner（名单见 T1 文档「Runner 防呆」节）任何步骤不得重启。
- 美国生产侧只读（pg_dump），不停服、不改配置。
