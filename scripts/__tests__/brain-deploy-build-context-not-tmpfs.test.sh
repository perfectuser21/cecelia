#!/usr/bin/env bash
# brain-deploy-build-context-not-tmpfs.test.sh — 构建上下文不能放进容器 /tmp tmpfs（任务 c8320370，10-12 生产部署连挂）
#
# 背景：部署由 Brain 容器内的 deploy webhook 拉起 deploy-local.sh → brain-build.sh，容器 /tmp 是 100M tmpfs
# （docker-compose.us-vps.yml tmpfs: /tmp:size=100M）。brain-build.sh 用 mktemp -t 把整仓 git archive 解到 /tmp，
# 仓库导出已约 91MB、解开后按页计占用超过 100M → "tar: write error: No space left on device"，
# 10-12 01:10 / 01:18 两次部署都死在 [1/7] Building image，main 上已合并的修复全部上不了生产。
# 规则：构建上下文放仓库根下的 .brain-build-tmp/（宿主磁盘），可用 BRAIN_BUILD_TMPDIR 覆盖；绝不依赖 TMPDIR/tmp。
set -uo pipefail

ERRORS=0
PASS=0
pass() { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS + 1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SRC="$REPO_ROOT/scripts/brain-build.sh"
TMPD=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/brain-build-ctx.XXXXXX")" && pwd -P)
trap 'rm -rf "$TMPD"' EXIT

# 最小假 docker：只记录调用；build 时把上下文目录（最后一个参数）与当时是否存在记下来
BIN="$TMPD/bin"; mkdir -p "$BIN"
cat > "$BIN/docker" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$DOCKER_STATE/calls.log"
if [[ "$1" == "build" ]]; then
  ctx="${!#}"
  echo "$ctx" > "$DOCKER_STATE/ctx"
  [[ -f "$ctx/packages/brain/Dockerfile" ]] && echo yes > "$DOCKER_STATE/ctx_populated"
  exit 0
fi
if [[ "$1" == "image" && "$2" == "inspect" ]]; then echo "[]"; exit 1; fi
if [[ "$1" == "images" ]]; then echo "1GB"; exit 0; fi
exit 0
EOF
chmod +x "$BIN/docker"

make_repo() {
  local dir="$1"
  git init -q --bare "$dir.git"; git init -q "$dir"
  mkdir -p "$dir/packages/brain" "$dir/scripts"
  printf '{"name":"x","version":"1.0.0"}\n' > "$dir/packages/brain/package.json"
  printf 'FROM scratch\n' > "$dir/packages/brain/Dockerfile"
  cp "$SRC" "$dir/scripts/brain-build.sh"
  cp "$REPO_ROOT/.gitignore" "$dir/.gitignore"
  git -C "$dir" add -A
  git -C "$dir" -c core.hooksPath=/dev/null -c user.email=t@t -c user.name=t commit -qm init
  git -C "$dir" branch -M main
  git -C "$dir" remote add origin "$dir.git"
  git -C "$dir" -c core.hooksPath=/dev/null push -q origin main
}

# ── T1：TMPDIR 不可写（模拟 /tmp tmpfs 写满）时照样构建，上下文在仓库根 .brain-build-tmp/ 下 ──
R1="$TMPD/r1"; S1="$TMPD/s1"; mkdir -p "$S1"
make_repo "$R1"
if PATH="$BIN:$PATH" DOCKER_STATE="$S1" TMPDIR="$TMPD/no-such-tmp" bash "$R1/scripts/brain-build.sh" > "$S1/out.log" 2>&1; then
  pass "T1 TMPDIR 不可用时构建成功"
else
  fail "T1 构建失败：$(tail -3 "$S1/out.log")"
fi
ctx=$(cat "$S1/ctx" 2>/dev/null)
case "$ctx" in
  "$R1/.brain-build-tmp/"*) pass "T1 构建上下文在仓库根 .brain-build-tmp/ 下" ;;
  *) fail "T1 构建上下文=[$ctx]，期望在 $R1/.brain-build-tmp/ 下" ;;
esac
[[ "$(cat "$S1/ctx_populated" 2>/dev/null)" == yes ]] && pass "T1 构建时上下文已解出 Dockerfile" || fail "T1 构建时上下文缺 Dockerfile"
[[ -n "$ctx" && ! -e "$ctx" ]] && pass "T1 构建结束后临时上下文已清理" || fail "T1 临时上下文残留：$ctx"
[[ -z "$(git -C "$R1" status --porcelain)" ]] && pass "T1 .brain-build-tmp 不污染工作树（已 gitignore）" || fail "T1 工作树出现未忽略文件：$(git -C "$R1" status --porcelain | head -3)"

# ── T2：BRAIN_BUILD_TMPDIR 显式指定时用它 ──
R2="$TMPD/r2"; S2="$TMPD/s2"; mkdir -p "$S2" "$TMPD/custom-build"
make_repo "$R2"
PATH="$BIN:$PATH" DOCKER_STATE="$S2" BRAIN_BUILD_TMPDIR="$TMPD/custom-build" bash "$R2/scripts/brain-build.sh" > "$S2/out.log" 2>&1
ctx=$(cat "$S2/ctx" 2>/dev/null)
case "$ctx" in
  "$TMPD/custom-build/"*) pass "T2 BRAIN_BUILD_TMPDIR 生效" ;;
  *) fail "T2 构建上下文=[$ctx]，期望在 $TMPD/custom-build/ 下" ;;
esac

echo ""
echo "=== brain-deploy-build-context-not-tmpfs: $PASS PASS / $ERRORS FAIL ==="
[[ $ERRORS -eq 0 ]]
