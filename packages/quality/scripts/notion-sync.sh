#!/bin/bash
# Notion Sync - One-way sync from VPS to Notion
# Syncs System State and System Runs to Notion databases

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_FILE="$PROJECT_ROOT/db/cecelia.db"

# Notion API Configuration
NOTION_TOKEN="${NOTION_TOKEN:-}"
NOTION_STATE_DB_ID="${NOTION_STATE_DB_ID:-}"
NOTION_RUNS_DB_ID="${NOTION_RUNS_DB_ID:-}"

# Check prerequisites
if [[ -z "$NOTION_TOKEN" ]]; then
  echo "ERROR: NOTION_TOKEN environment variable not set"
  echo "Set it in ~/.bashrc or ~/.zshrc:"
  echo "  export NOTION_TOKEN='secret_xxx'"
  exit 1
fi

if [[ -z "$NOTION_STATE_DB_ID" || -z "$NOTION_RUNS_DB_ID" ]]; then
  echo "ERROR: Notion database IDs not set"
  echo "Set them in ~/.bashrc or ~/.zshrc:"
  echo "  export NOTION_STATE_DB_ID='database-id-1'"
  echo "  export NOTION_RUNS_DB_ID='database-id-2'"
  exit 1
fi

# Helper: Call Notion API
notion_api() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"

  local url="https://api.notion.com/v1/$endpoint"

  if [[ -n "$data" ]]; then
    curl -s -X "$method" "$url" \
      -H "Authorization: Bearer $NOTION_TOKEN" \
      -H "Notion-Version: 2022-06-28" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -s -X "$method" "$url" \
      -H "Authorization: Bearer $NOTION_TOKEN" \
      -H "Notion-Version: 2022-06-28"
  fi
}

# Function: Sync system state
sync_state() {
  echo "📊 Syncing System State..."

  # Get system health from DB
  local health_data=$(sqlite3 -json "$DB_FILE" "SELECT * FROM system_health;")

  # Extract values
  local inbox=$(echo "$health_data" | jq -r '.[0].inbox_count // 0')
  local todo=$(echo "$health_data" | jq -r '.[0].todo_count // 0')
  local doing=$(echo "$health_data" | jq -r '.[0].doing_count // 0')
  local blocked=$(echo "$health_data" | jq -r '.[0].blocked_count // 0')
  local done=$(echo "$health_data" | jq -r '.[0].done_count // 0')
  local queued=$(echo "$health_data" | jq -r '.[0].queued_runs // 0')
  local running=$(echo "$health_data" | jq -r '.[0].running_runs // 0')
  local failed_24h=$(echo "$health_data" | jq -r '.[0].failed_24h // 0')
  local health=$(echo "$health_data" | jq -r '.[0].health // "ok"' | tr -d '"')
  local last_heartbeat=$(echo "$health_data" | jq -r '.[0].last_heartbeat // "null"' | tr -d '"')

  # Get queue length
  local queue_length=$(wc -l < "$PROJECT_ROOT/queue/queue.jsonl" || echo 0)

  # Build Notion page properties
  local properties=$(cat <<EOF
{
  "parent": { "database_id": "$NOTION_STATE_DB_ID" },
  "properties": {
    "Name": {
      "title": [
        {
          "text": {
            "content": "System State - $(date +%Y-%m-%d\ %H:%M)"
          }
        }
      ]
    },
    "Health": {
      "select": {
        "name": "$health"
      }
    },
    "Queue Length": {
      "number": $queue_length
    },
    "Inbox": {
      "number": $inbox
    },
    "Todo": {
      "number": $todo
    },
    "Doing": {
      "number": $doing
    },
    "Blocked": {
      "number": $blocked
    },
    "Done": {
      "number": $done
    },
    "Failed (24h)": {
      "number": $failed_24h
    },
    "Last Heartbeat": {
      "rich_text": [
        {
          "text": {
            "content": "$last_heartbeat"
          }
        }
      ]
    }
  }
}
EOF
)

  # Create Notion page
  local result=$(notion_api POST "pages" "$properties")
  local page_id=$(echo "$result" | jq -r '.id // empty')

  if [[ -n "$page_id" ]]; then
    echo "  ✅ State synced to Notion (page: $page_id)"
  else
    echo "  ❌ Failed to sync state"
    echo "$result" | jq .
    return 1
  fi
}

# Function: Sync recent runs
sync_runs() {
  echo "🏃 Syncing Recent Runs..."

  # Get recent runs from DB
  local runs=$(sqlite3 -json "$DB_FILE" "SELECT * FROM recent_runs LIMIT 5;")

  local count=$(echo "$runs" | jq 'length')

  if [[ "$count" -eq 0 ]]; then
    echo "  No runs to sync"
    return 0
  fi

  echo "  Found $count runs to sync"

  # Iterate over runs
  for i in $(seq 0 $((count - 1))); do
    local run=$(echo "$runs" | jq ".[$i]")

    local run_id=$(echo "$run" | jq -r '.id')
    local task_id=$(echo "$run" | jq -r '.task_id')
    local task_title=$(echo "$run" | jq -r '.task_title // "Untitled"')
    local status=$(echo "$run" | jq -r '.status')
    local intent=$(echo "$run" | jq -r '.intent')
    local started_at=$(echo "$run" | jq -r '.started_at // "N/A"')
    local completed_at=$(echo "$run" | jq -r '.completed_at // "N/A"')
    local duration=$(echo "$run" | jq -r '.duration_seconds // 0')
    local project_name=$(echo "$run" | jq -r '.project_name // "Unknown"')

    # Build Notion page properties
    local properties=$(cat <<EOF
{
  "parent": { "database_id": "$NOTION_RUNS_DB_ID" },
  "properties": {
    "Name": {
      "title": [
        {
          "text": {
            "content": "$task_title"
          }
        }
      ]
    },
    "Run ID": {
      "rich_text": [
        {
          "text": {
            "content": "$run_id"
          }
        }
      ]
    },
    "Task ID": {
      "rich_text": [
        {
          "text": {
            "content": "$task_id"
          }
        }
      ]
    },
    "Status": {
      "select": {
        "name": "$status"
      }
    },
    "Intent": {
      "select": {
        "name": "$intent"
      }
    },
    "Project": {
      "select": {
        "name": "$project_name"
      }
    },
    "Duration (s)": {
      "number": $duration
    },
    "Started At": {
      "rich_text": [
        {
          "text": {
            "content": "$started_at"
          }
        }
      ]
    },
    "Completed At": {
      "rich_text": [
        {
          "text": {
            "content": "$completed_at"
          }
        }
      ]
    }
  }
}
EOF
)

    # Create Notion page
    local result=$(notion_api POST "pages" "$properties")
    local page_id=$(echo "$result" | jq -r '.id // empty')

    if [[ -n "$page_id" ]]; then
      echo "    ✅ Run $run_id synced"

      # Record in DB
      sqlite3 "$DB_FILE" "INSERT OR REPLACE INTO notion_sync (entity_type, entity_id, notion_page_id, sync_status)
                          VALUES ('run', '$run_id', '$page_id', 'synced');"
    else
      echo "    ❌ Failed to sync run $run_id"
    fi
  done
}

# Main
main() {
  echo "🔄 Notion Sync - VPS → Notion"
  echo ""

  sync_state
  echo ""

  sync_runs
  echo ""

  # Update sync timestamp in DB
  sqlite3 "$DB_FILE" "UPDATE system_state SET value = '\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"', updated_at = datetime('now')
                      WHERE key = 'last_sync_notion';"

  echo "✅ Sync complete"
}

main "$@"
