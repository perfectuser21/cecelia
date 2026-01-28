#!/bin/bash
# Database initialization and management script

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_FILE="$PROJECT_ROOT/db/cecelia.db"
SCHEMA_FILE="$PROJECT_ROOT/db/schema.sql"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

usage() {
  cat <<EOF
Database Management Script

Usage:
  $0 init              # Initialize database (create if not exists)
  $0 reset             # Reset database (drop and recreate)
  $0 query <SQL>       # Execute SQL query
  $0 stats             # Show database statistics
  $0 backup            # Backup database
  $0 restore <file>    # Restore from backup

Examples:
  $0 init
  $0 query "SELECT * FROM active_tasks LIMIT 5;"
  $0 stats
  $0 backup
EOF
}

# Function: Initialize database
init_db() {
  echo -e "${GREEN}Initializing database...${NC}"

  if [[ -f "$DB_FILE" ]]; then
    echo -e "${YELLOW}Database already exists: $DB_FILE${NC}"
    echo "Use '$0 reset' to recreate from scratch"
    return 0
  fi

  mkdir -p "$(dirname "$DB_FILE")"
  sqlite3 "$DB_FILE" < "$SCHEMA_FILE"

  echo -e "${GREEN}✅ Database initialized: $DB_FILE${NC}"

  # Show initial state
  stats
}

# Function: Reset database
reset_db() {
  echo -e "${YELLOW}⚠️  Warning: This will delete all data!${NC}"
  read -p "Are you sure? (yes/no): " confirm

  if [[ "$confirm" != "yes" ]]; then
    echo "Aborted"
    return 1
  fi

  if [[ -f "$DB_FILE" ]]; then
    rm "$DB_FILE"
    echo -e "${GREEN}Deleted existing database${NC}"
  fi

  init_db
}

# Function: Execute query
query() {
  local sql="$1"

  if [[ ! -f "$DB_FILE" ]]; then
    echo -e "${RED}Database not found. Run '$0 init' first${NC}"
    return 1
  fi

  sqlite3 -header -column "$DB_FILE" "$sql"
}

# Function: Show statistics
stats() {
  echo -e "${GREEN}📊 Database Statistics${NC}"
  echo ""

  if [[ ! -f "$DB_FILE" ]]; then
    echo -e "${RED}Database not found${NC}"
    return 1
  fi

  # System health
  echo "=== System Health ==="
  query "SELECT * FROM system_health;"
  echo ""

  # Tasks by status
  echo "=== Tasks by Status ==="
  query "SELECT status, COUNT(*) as count FROM tasks GROUP BY status ORDER BY count DESC;"
  echo ""

  # Runs by status (last 24h)
  echo "=== Runs (Last 24h) ==="
  query "SELECT status, COUNT(*) as count FROM runs WHERE created_at > datetime('now', '-24 hours') GROUP BY status ORDER BY count DESC;"
  echo ""

  # Recent runs
  echo "=== Recent Runs (Last 5) ==="
  query "SELECT id, task_id, status, intent, started_at FROM runs ORDER BY created_at DESC LIMIT 5;"
  echo ""

  # Database size
  local db_size=$(du -h "$DB_FILE" | cut -f1)
  echo "Database size: $db_size"
}

# Function: Backup database
backup() {
  local timestamp=$(date +%Y%m%d_%H%M%S)
  local backup_file="$PROJECT_ROOT/db/backups/cecelia_$timestamp.db"

  mkdir -p "$(dirname "$backup_file")"

  if [[ ! -f "$DB_FILE" ]]; then
    echo -e "${RED}Database not found${NC}"
    return 1
  fi

  cp "$DB_FILE" "$backup_file"
  echo -e "${GREEN}✅ Backup created: $backup_file${NC}"

  # Keep only last 10 backups
  local backup_count=$(ls -1 "$PROJECT_ROOT/db/backups/" | wc -l)
  if [[ $backup_count -gt 10 ]]; then
    cd "$PROJECT_ROOT/db/backups/"
    ls -t | tail -n +11 | xargs rm -f
    echo "Cleaned up old backups (kept last 10)"
  fi
}

# Function: Restore from backup
restore() {
  local backup_file="$1"

  if [[ ! -f "$backup_file" ]]; then
    echo -e "${RED}Backup file not found: $backup_file${NC}"
    return 1
  fi

  echo -e "${YELLOW}⚠️  Warning: This will replace current database!${NC}"
  read -p "Are you sure? (yes/no): " confirm

  if [[ "$confirm" != "yes" ]]; then
    echo "Aborted"
    return 1
  fi

  # Backup current database first
  if [[ -f "$DB_FILE" ]]; then
    backup
  fi

  cp "$backup_file" "$DB_FILE"
  echo -e "${GREEN}✅ Database restored from: $backup_file${NC}"
}

# Main
main() {
  local command="${1:-help}"

  case "$command" in
    init)
      init_db
      ;;
    reset)
      reset_db
      ;;
    query)
      if [[ $# -lt 2 ]]; then
        echo "Usage: $0 query <SQL>"
        exit 1
      fi
      query "$2"
      ;;
    stats)
      stats
      ;;
    backup)
      backup
      ;;
    restore)
      if [[ $# -lt 2 ]]; then
        echo "Usage: $0 restore <backup_file>"
        exit 1
      fi
      restore "$2"
      ;;
    help|--help|-h)
      usage
      ;;
    *)
      echo "Unknown command: $command"
      usage
      exit 1
      ;;
  esac
}

main "$@"
