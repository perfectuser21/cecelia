#!/usr/bin/env bash
# 真 git 库 e2e：模拟 task container push origin → brain 端 fetchAndShowOriginFile 拿到内容
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

WORK=$(mktemp -d -t git-fence-smoke-XXXXXX)
trap "rm -rf '$WORK'" EXIT

git init --bare "$WORK/origin.git" >/dev/null 2>&1
git clone "$WORK/origin.git" "$WORK/proposer" >/dev/null 2>&1
git clone "$WORK/origin.git" "$WORK/brain" >/dev/null 2>&1

cd "$WORK/proposer"
git config user.email t@t && git config user.name T
echo '{"hello":"world"}' > test-file.json
git checkout -b cp-fence-test-branch >/dev/null 2>&1
git add . && git commit -m t --quiet
git push origin cp-fence-test-branch --quiet 2>&1

# 验证：brain 端起步 git show 应失败（没 fetch）
cd "$WORK/brain"
git config user.email t@t && git config user.name T
if ! git show "origin/cp-fence-test-branch:test-file.json" >/dev/null 2>&1; then
  echo "✓ brain 起步未 fetch 状态符合预期"
fi

# 调用 helper
RESULT=$(node --input-type=module -e "
  process.chdir('$WORK/brain');
  const m = await import('$BRAIN_ROOT/src/lib/git-fence.js');
  const content = await m.fetchAndShowOriginFile('$WORK/brain', 'cp-fence-test-branch', 'test-file.json');
  console.log(content);
" 2>&1)

if [[ "$RESULT" == *'"hello":"world"'* ]]; then
  echo "✅ git-fence smoke PASS — fetch + show 真链路通"
  exit 0
fi
echo "❌ FAIL: $RESULT"
exit 1
