#!/bin/bash
# ============================================
# DLQ Replay Script
# ============================================
# Replays failed memory/evidence writes from DLQ
#
# Usage:
#   ./replay-dlq.sh              # Replay all
#   ./replay-dlq.sh memory       # Replay memory only
#   ./replay-dlq.sh evidence     # Replay evidence only
#   ./replay-dlq.sh --status     # Show status only

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/dlq-utils.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "============================================"
echo "Cecelia DLQ Replay"
echo "============================================"
echo ""

# Check status first
echo "Current DLQ Status:"
echo "-------------------"
STATUS=$(dlq_status)
echo "$STATUS" | jq '.'

MEMORY_PENDING=$(echo "$STATUS" | jq '.memory.pending')
EVIDENCE_PENDING=$(echo "$STATUS" | jq '.evidence.pending')
TOTAL_PENDING=$(echo "$STATUS" | jq '.total_pending')

if [[ "$1" == "--status" ]]; then
  exit 0
fi

if [[ "$TOTAL_PENDING" == "0" ]]; then
  echo ""
  echo -e "${GREEN}No pending entries to replay.${NC}"
  exit 0
fi

echo ""

# Replay based on argument
case "$1" in
  memory)
    if [[ "$MEMORY_PENDING" -gt 0 ]]; then
      echo "Replaying memory DLQ ($MEMORY_PENDING entries)..."
      RESULT=$(dlq_replay memory)
      echo "$RESULT" | jq '.'
    else
      echo "No pending memory entries."
    fi
    ;;
  evidence)
    if [[ "$EVIDENCE_PENDING" -gt 0 ]]; then
      echo "Replaying evidence DLQ ($EVIDENCE_PENDING entries)..."
      RESULT=$(dlq_replay evidence)
      echo "$RESULT" | jq '.'
    else
      echo "No pending evidence entries."
    fi
    ;;
  *)
    # Replay all
    if [[ "$MEMORY_PENDING" -gt 0 ]]; then
      echo "Replaying memory DLQ ($MEMORY_PENDING entries)..."
      RESULT=$(dlq_replay memory)
      echo "$RESULT" | jq '.'
      echo ""
    fi

    if [[ "$EVIDENCE_PENDING" -gt 0 ]]; then
      echo "Replaying evidence DLQ ($EVIDENCE_PENDING entries)..."
      RESULT=$(dlq_replay evidence)
      echo "$RESULT" | jq '.'
    fi
    ;;
esac

echo ""
echo "============================================"
echo "Replay Complete"
echo "============================================"

# Show final status
echo ""
echo "Final DLQ Status:"
dlq_status | jq '.'
