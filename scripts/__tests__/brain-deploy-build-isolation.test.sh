#!/usr/bin/env bash
# brain-build-isolation.test.sh — v1.2.0 origin/main 隔离验证
#
# v1.2.0：build 用 git fetch origin + git archive FETCH_HEAD（origin/main）
#   不再用 git archive HEAD（HEAD 可能是 cp-* 分支，缺最新合并修复）
# v1.1.0：用 git archive 输出到临时 dir 构建（脏工作树/untracked 文件隔离）

set -uo pipefail
PASS=0; FAIL=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/brain-build.sh"

# Test 1: 执行真实构建入口；固定 SHA、默认 main、脏树都不允许漂移。
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT
mkdir -p "$FIXTURE/repo/scripts" "$FIXTURE/repo/packages/brain" "$FIXTURE/bin"
cp "$SCRIPT" "$FIXTURE/repo/scripts/brain-build.sh"
mkdir -p "$FIXTURE/repo/scripts/lib"
cp "$REPO_ROOT/scripts/lib/brain-candidate-docker.sh" "$FIXTURE/repo/scripts/lib/brain-candidate-docker.sh"
printf '{"version":"1.0.0"}\n' > "$FIXTURE/repo/packages/brain/package.json"
printf 'FROM scratch\n' > "$FIXTURE/repo/packages/brain/Dockerfile"
printf 'candidate-A\n' > "$FIXTURE/repo/source.txt"
git init -q -b main "$FIXTURE/repo"
git -C "$FIXTURE/repo" config core.hooksPath /dev/null
# 仅隔离测试私有仓库不继承宿主 hook；被测真实仓库门禁不变。
git -C "$FIXTURE/repo" add .
git -C "$FIXTURE/repo" -c user.email=t@t -c user.name=t commit -qm candidate
PINNED=$(git -C "$FIXTURE/repo" rev-parse HEAD)
printf 'new-main-B\n' > "$FIXTURE/repo/source.txt"
git -C "$FIXTURE/repo" add .
git -C "$FIXTURE/repo" -c user.email=t@t -c user.name=t commit -qm main
LATEST=$(git -C "$FIXTURE/repo" rev-parse HEAD)
git init -q --bare "$FIXTURE/remote"
git -C "$FIXTURE/repo" remote add origin "$FIXTURE/remote"
git -C "$FIXTURE/repo" push -q origin main
git -C "$FIXTURE/repo" checkout -qb cp-unrelated
printf 'other-branch-C\n' > "$FIXTURE/repo/source.txt"
git -C "$FIXTURE/repo" add .
git -C "$FIXTURE/repo" -c user.email=t@t -c user.name=t commit -qm unrelated
printf 'dirty-D\n' > "$FIXTURE/repo/source.txt"
printf 'secret\n' > "$FIXTURE/repo/UNTRACKED_SECRET"
cat > "$FIXTURE/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
if [[ "$1" == build ]]; then
  context="${!#}"
  cat "$context/source.txt" > "$CAPTURE.source"
  printf '%s\n' "$*" > "$CAPTURE.args"
  printf '%s\n' "$context" > "$CAPTURE.context"
  [[ ! -e "$context/UNTRACKED_SECRET" ]] || exit 31
elif [[ "$1" == image && "$2" == inspect ]]; then exit 1
fi
DOCKER
chmod +x "$FIXTURE/bin/docker"
for selector in pinned default; do
  expected="$PINNED"; content=candidate-A
  [[ "$selector" == pinned ]] || { expected="$LATEST"; content=new-main-B; }
  if PATH="$FIXTURE/bin:$PATH" CAPTURE="$FIXTURE/$selector" EXPECTED_SHA="$([[ "$selector" == pinned ]] && echo "$PINNED" || true)" bash "$FIXTURE/repo/scripts/brain-build.sh" > "$FIXTURE/$selector.log" 2>&1       && [[ "$(cat "$FIXTURE/$selector.source")" == "$content" ]]       && grep -q "GIT_SHA=$expected" "$FIXTURE/$selector.args"       && [[ ! -e "$(cat "$FIXTURE/$selector.context")" ]]; then
    pass "真实构建 ${selector}：源码和戳同 SHA，隔离 cp 分支、脏树、未跟踪文件并清理上下文"
  else fail "真实构建 $selector 隔离失败：$(tail -2 "$FIXTURE/$selector.log")"; fi
done

echo ""
echo "=== brain-build-isolation: $PASS PASS / $FAIL FAIL ==="
[[ "$FAIL" -eq 0 ]]
