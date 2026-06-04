#!/bin/bash
set -e
echo "=== account1-restore smoke ==="

USAGE={"ok":true,"usage":{"account2":{"account_id":"account2","five_hour_pct":9,"seven_day_pct":85,"resets_at":"2026-06-04T11:40:01.244Z","extra_used":false,"fetched_at":"2026-06-04T07:17:40.507Z","seven_day_sonnet_pct":79,"seven_day_resets_at":"2026-06-08T07:00:01.244Z","is_spending_capped":false,"spending_cap_resets_at":null,"seven_day_sonnet_resets_at":"2026-06-08T07:00:01.244Z","is_auth_failed":false,"auth_fail_resets_at":null,"auth_fail_count":0,"seven_day_omelette_pct":"6","seven_day_omelette_resets_at":"2026-06-08T07:00:01.244Z"}}} || {
  echo "❌ account-usage API 不可达"
  exit 1
}

echo "$USAGE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except json.JSONDecodeError as e:
    print('❌ API 返回非 JSON:', e)
    sys.exit(1)
usage = d.get('usage', {})
assert 'account1' in usage, 'account1 missing from pool'
assert 'account2' in usage, 'account2 missing from pool'
print('✅ both accounts in pool')
"

echo "=== PASS ==="
