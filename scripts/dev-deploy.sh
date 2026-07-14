#!/usr/bin/env bash
# dev-deploy.sh — Cecelia develop 环境部署脚本
# 功能：pg_dump 备份 → migrate 幂等 → 失败 exit 非0 + 回滚指引
# Sprint: 07131922-环境模型三段常驻收尾
# task_id: d063b3e5-8fb1-4d53-b176-8e8198c7a084

set -uo pipefail

BACKUP_DIR="/opt/cecelia-backups"
DB_NAME="cecelia_dev"
DB_USER="${DB_USER:-cecelia}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
BRAIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/packages/brain"
MIGRATE_SUCCESS_FLAG="$BRAIN_DIR/.migrate-success"
MAX_BACKUPS=7

log_info()  { echo "[INFO]  $1"; }
log_error() { echo "[ERROR] $1" >&2; }

# ---- Step 1: 创建备份目录 ----
mkdir -p "$BACKUP_DIR"

# ---- Step 2: pg_dump 备份（若 DB 存在） ----
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
  TIMESTAMP=$(date +%Y%m%d%H%M%S)
  BACKUP_FILE="$BACKUP_DIR/cecelia_dev_backup_${TIMESTAMP}.sql"
  log_info "备份 $DB_NAME → $BACKUP_FILE"
  if ! pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$BACKUP_FILE"; then
    log_error "pg_dump 失败，中止部署"
    exit 1
  fi
  log_info "备份成功: $BACKUP_FILE"

  # 保留最近 7 份，删除旧备份
  BACKUP_COUNT=$(ls -1t "$BACKUP_DIR"/cecelia_dev_backup_*.sql 2>/dev/null | wc -l)
  if [[ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]]; then
    EXCESS=$((BACKUP_COUNT - MAX_BACKUPS))
    log_info "清理旧备份（超出 $MAX_BACKUPS 份），删除 $EXCESS 个"
    ls -1t "$BACKUP_DIR"/cecelia_dev_backup_*.sql | tail -"$EXCESS" | xargs rm -f
  fi
else
  log_info "$DB_NAME 不存在，跳过备份，将创建新 DB"
fi

# ---- Step 3: 创建 DB（若不存在） ----
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
  log_info "创建数据库 $DB_NAME"
  createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" || {
    log_error "创建 $DB_NAME 失败"
    exit 1
  }
fi

# ---- Step 4: migrate 幂等 ----
MIGRATION_DIR="$BRAIN_DIR/migrations"
if [[ ! -d "$MIGRATION_DIR" ]]; then
  log_error "migrations 目录不存在: $MIGRATION_DIR"
  exit 1
fi

# 获取当前 schema_version
CURRENT_VERSION=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -tAc "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1;" 2>/dev/null || echo "0")
CURRENT_VERSION="${CURRENT_VERSION:-0}"

# 从 brain/src/selfcheck.js 读取期望 schema 版本
EXPECTED_VERSION=$(grep -o "EXPECTED_SCHEMA_VERSION[[:space:]]*=[[:space:]]*[0-9]*" \
  "$BRAIN_DIR/src/selfcheck.js" 2>/dev/null | grep -o "[0-9]*$" || echo "")

log_info "当前 schema_version: ${CURRENT_VERSION}，期望: ${EXPECTED_VERSION:-未知}"

# 若已有 .migrate-success 且版本匹配，跳过 migrate
if [[ -f "$MIGRATE_SUCCESS_FLAG" ]] && [[ -n "$EXPECTED_VERSION" ]] && \
   [[ "$CURRENT_VERSION" == "$EXPECTED_VERSION" ]]; then
  log_info "migrate 已完成（version=${CURRENT_VERSION}），跳过"
else
  log_info "开始执行 migrations..."

  if ! node -e "
    import('./packages/brain/src/migrate.js').then(m => m.runMigrations()).then(() => {
      console.log('[migrate] 完成');
      process.exit(0);
    }).catch(err => {
      console.error('[migrate] 失败:', err.message);
      process.exit(1);
    });
  " 2>&1; then
    # migrate 失败：打印回滚指引
    LATEST_BACKUP=$(ls -1t "$BACKUP_DIR"/cecelia_dev_backup_*.sql 2>/dev/null | head -1)
    log_error "=========================================="
    log_error "migrate 失败！如需回滚，请执行："
    if [[ -n "$LATEST_BACKUP" ]]; then
      log_error "  dropdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME"
      log_error "  createdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME"
      log_error "  psql cecelia_dev < $LATEST_BACKUP"
    else
      log_error "  （未找到备份文件，请检查 ${BACKUP_DIR}）"
    fi
    log_error "=========================================="
    exit 1
  fi

  # 记录成功标志
  touch "$MIGRATE_SUCCESS_FLAG"
  log_info "migrate 完成，已写入 $MIGRATE_SUCCESS_FLAG"
fi

log_info "develop 部署完成"
exit 0
