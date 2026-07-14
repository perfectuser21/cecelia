#!/usr/bin/env bash
# backup-zenithjoy-hk.sh — HK 本地 zenithjoy* 库每日备份（拆库刀3-T2）
# 部署位置: hk-vps /opt/zenithjoy/db/backup-zenithjoy-hk.sh
# cron: 每日 03:30（HK 系统时区已是 Asia/Shanghai，crontab 直接按北京时间触发）
# 备份目录: /opt/zenithjoy-backups/hk-local/，保留 14 天
set -euo pipefail

BACKUP_DIR="/opt/zenithjoy-backups/hk-local"
CONTAINER="zenithjoy-db-postgres"
RETENTION_DAYS=14
STAMP=$(date '+%Y%m%d-%H%M%S')

mkdir -p "$BACKUP_DIR"
echo "[$(date '+%F %T %Z')] 开始备份"

# 动态枚举容器内全部 zenithjoy* 库
DBS=$(docker exec "$CONTAINER" psql -U zenithjoy -d postgres -Atc \
  "SELECT datname FROM pg_database WHERE datname LIKE 'zenithjoy%' AND datistemplate = false;")

for DB in $DBS; do
  OUT="$BACKUP_DIR/${DB}-${STAMP}.dump"
  docker exec "$CONTAINER" pg_dump -U zenithjoy -d "$DB" -Fc > "$OUT"
  echo "[$(date '+%F %T %Z')] $DB -> $OUT ($(du -h "$OUT" | cut -f1))"
done

# 保留期清理
find "$BACKUP_DIR" -name '*.dump' -mtime +"$RETENTION_DAYS" -delete
echo "[$(date '+%F %T %Z')] 备份完成，已清理 ${RETENTION_DAYS} 天前的旧备份"
