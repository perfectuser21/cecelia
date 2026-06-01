#!/usr/bin/env bash
# Smoke: 账号健壮性两项修复（429 回退缓存 + 凭据备份/恢复脚本）
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

# 1. account-usage 429 不再 hardcode 判死，回退缓存
node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('./packages/brain/src/account-usage.js', 'utf8');
// __rateLimited 分支必须回退 getStaleCached，而非无条件 five_hour_pct=100
const idx = src.indexOf('data.__rateLimited');
const block = src.slice(idx, idx + 800);
if (!block.includes('getStaleCached')) {
  console.error('FAIL: 429 分支未回退 getStaleCached');
  process.exit(1);
}
console.log('OK: account-usage 429 回退缓存');
"

# 2. 备份/恢复脚本存在且可执行
for s in scripts/backup-claude-creds.sh scripts/restore-claude-creds.sh; do
  [ -f "$s" ] || { echo "FAIL: $s 不存在"; exit 1; }
  [ -x "$s" ] || { echo "FAIL: $s 不可执行"; exit 1; }
done

# 3. restore 脚本只恢复缺失文件（已存在不覆盖）
grep -q 'if \[ -f "\$CREDS" \]; then' scripts/restore-claude-creds.sh \
  || { echo "FAIL: restore 未保护已存在文件"; exit 1; }

# 4. brain-deploy 接入了 restore
grep -q 'restore-claude-creds.sh' scripts/brain-deploy.sh \
  || { echo "FAIL: brain-deploy 未接入凭据自愈"; exit 1; }

echo "OK: account-resilience smoke passed"
