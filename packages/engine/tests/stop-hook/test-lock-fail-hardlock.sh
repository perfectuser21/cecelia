#!/usr/bin/env bash
# Test: 锁获取失败时应该 exit 2

set -e

echo "=== Test: Lock Failure Should Exit 2 ==="
echo ""
echo "This test verifies the code changes:"
echo "1. Line 68: exit 0 → exit 2"
echo "2. Line 79: exit 0 → exit 2"
echo ""

# Check the actual code
echo "Checking hooks/stop-dev.sh for correct exit codes..."

# Check first lock failure (around line 68)
if grep -A 2 "另一个会话正在执行 Stop Hook" /home/xx/perfect21/cecelia/engine/hooks/stop-dev.sh | grep -q "exit 2"; then
    echo "✅ First lock failure correctly uses exit 2"
else
    echo "❌ FAIL: First lock failure still uses exit 0"
    exit 1
fi

# Check second lock failure (around line 79)
if grep -A 1 "并发锁获取失败，等待锁释放后继续" /home/xx/perfect21/cecelia/engine/hooks/stop-dev.sh | grep -q "exit 2"; then
    echo "✅ Second lock failure correctly uses exit 2"
else
    echo "❌ FAIL: Second lock failure still uses exit 0"
    exit 1
fi

echo ""
echo "✅ All lock failure paths use exit 2"
