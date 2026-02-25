#!/bin/bash
# Test: C-DB-INIT-001 - Database 初始化
# Scope: SQLite schema 创建成功，所有表和视图正确初始化

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "Testing Database Initialization (C-DB-INIT-001)..."

# Cleanup
TEST_DB="/tmp/test-cecelia-$(date +%s).db"
trap "rm -f $TEST_DB" EXIT

# Test 1: Initialize database with custom path
echo -n "  [1/4] Database schema creation... "
# Use sqlite3 directly with the schema file
mkdir -p "$(dirname "$TEST_DB")"
if sqlite3 "$TEST_DB" < "$PROJECT_ROOT/db/schema.sql" 2>/dev/null; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Test 2: Verify all 8 tables exist
echo -n "  [2/4] Verify 8 tables exist... "
TABLES=$(sqlite3 "$TEST_DB" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" | wc -l)
if [ "$TABLES" -eq 8 ]; then
    echo -e "${GREEN}PASS${NC} ($TABLES tables)"
else
    echo -e "${RED}FAIL${NC} (Expected 8, got $TABLES)"
    exit 1
fi

# Test 3: Verify 3 views exist
echo -n "  [3/4] Verify 3 views exist... "
VIEWS=$(sqlite3 "$TEST_DB" "SELECT name FROM sqlite_master WHERE type='view' ORDER BY name;" | wc -l)
if [ "$VIEWS" -eq 3 ]; then
    echo -e "${GREEN}PASS${NC} ($VIEWS views)"
else
    echo -e "${RED}FAIL${NC} (Expected 3, got $VIEWS)"
    exit 1
fi

# Test 4: Verify key tables structure
echo -n "  [4/4] Verify key table structure... "
TASKS_COLS=$(sqlite3 "$TEST_DB" "PRAGMA table_info(tasks);" | wc -l)
RUNS_COLS=$(sqlite3 "$TEST_DB" "PRAGMA table_info(runs);" | wc -l)
if [ "$TASKS_COLS" -ge 8 ] && [ "$RUNS_COLS" -ge 9 ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ C-DB-INIT-001 PASSED${NC}"
echo "   Database: $TEST_DB"
echo "   Tables: $TABLES, Views: $VIEWS"
