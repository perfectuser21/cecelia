#!/usr/bin/env bash
# 真实恢复脚本；HOME、op 和日志全部隔离，绝不访问现有凭据。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home/.credentials" "$T/bin"
printf 'OP_SERVICE_ACCOUNT_TOKEN=fixture-only\n' > "$T/home/.credentials/1password.env"
export CALLS="$T/op.calls" FIXTURE_KIND=valid
cat > "$T/bin/op" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$CALLS"
case "$FIXTURE_KIND" in
 valid) printf '{"claudeAiOauth":{"refreshToken":"synthetic-refresh"}}' ;;
 missing) printf '{"claudeAiOauth":{}}' ;;
 malformed) printf 'not-json' ;;
esac
SH
chmod +x "$T/bin/op"
# 唯一文本替换是硬编码日志路径；恢复逻辑原样运行。
sed "s|/tmp/claude-creds-restore.log|$T/restore.log|g" "$ROOT/scripts/restore-claude-creds.sh" > "$T/restore.sh"
run_restore() {
  env -i HOME="$T/home" PATH="$T/bin:$PATH" CALLS="$CALLS" FIXTURE_KIND="$FIXTURE_KIND" \
    bash "$T/restore.sh" > "$T/out" 2>&1
}
for account in account1 account2 account3; do
 mkdir -p "$T/home/.claude-$account"
 printf 'existing-%s' "$account" > "$T/home/.claude-$account/.credentials.json"
done
run_restore
test ! -e "$CALLS"
for account in account1 account2 account3; do
 test "$(cat "$T/home/.claude-$account/.credentials.json")" = "existing-$account"
done
rm "$T/home/.claude-account2/.credentials.json"
run_restore
test "$(wc -l < "$CALLS" | tr -d ' ')" = 1
grep -Fxq 'item get claude-creds-account2 --vault CS --fields credential --reveal' "$CALLS"
node -e 'const fs=require("fs"),p=process.argv[1];const s=fs.statSync(p);if((s.mode&0o777)!==0o600)throw Error("mode");if(JSON.parse(fs.readFileSync(p)).claudeAiOauth.refreshToken!=="synthetic-refresh")throw Error("content")' "$T/home/.claude-account2/.credentials.json"
test ! -e "$T/home/.claude-account2/.credentials.json.tmp"
for FIXTURE_KIND in missing malformed; do
 export FIXTURE_KIND
 rm "$T/home/.claude-account2/.credentials.json" 2>/dev/null || true
 run_restore
 test ! -e "$T/home/.claude-account2/.credentials.json"
 test ! -e "$T/home/.claude-account2/.credentials.json.tmp"
done
! grep -q 'synthetic-refresh' "$T/restore.log"
echo '凭据恢复：已存在零读取、不覆盖；合法文件600；非法内容不落盘，通过'
