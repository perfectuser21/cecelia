#!/usr/bin/env bash
# brain-deploy-build-same-version.test.sh — 同版本号不同 SHA 重建时旧镜像丢 tag（任务 B4 / e2fc7076 / a80485b3）
#
# 背景：auto-version bump 之前的那个合并提交和上一次 bump 提交版本号相同（09167e2 与 86b5389 同为 1.417.0）。
# brain-build.sh 无条件把 cecelia-brain:${VERSION} 与 latest 打到新镜像上，旧镜像丢光 tag：
#   - 部署中途死亡时容器仍跑旧镜像，旧镜像却已没有版本 tag，recovered 结算只能人工把 tag 挪回去（决策 a9add058）；
#   - 旧容器一换掉，旧镜像就是 dangling，被构建末尾的 prune 删掉，回滚目标丢失。
# 方案 A（已定）：同版本不同 SHA 时新镜像额外打 ${VERSION}-${sha12}，旧镜像补 prev-${VERSION}-${oldsha12} 保活。
# 另外：janitor 只能按 id 删除单 tag 镜像（同仓库多 tag 时 docker 拒删 "referenced in multiple repositories"），
# 所以被顶替的镜像最终必须只剩一个 tag，否则保活/别名 tag 会让镜像永久泄漏。
#
# 用假 docker（文件模拟 tag→镜像 映射）+ 真 git（本地 bare 仓库当 origin）驱动真实 brain-build.sh。
set -uo pipefail

ERRORS=0
PASS=0
pass() { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS + 1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SRC="$REPO_ROOT/scripts/brain-build.sh"
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/brain-build-same-version.XXXXXX")
trap 'rm -rf "$TMPD"' EXIT

hex() { printf "%${2}s" '' | tr ' ' "$1"; }
OLD_SHA=$(hex 1 40)
OLD_ID="sha256:$(hex a 64)"
PRIOR_ID="sha256:$(hex c 64)"
key() { printf '%s' "$1" | tr '/:' '__'; }

# ── 假 docker：$DOCKER_STATE/tags/<key> 存镜像 id（<key>.name 存原 tag 名），$DOCKER_STATE/env/<key(id)> 存 Config.Env ──
BIN="$TMPD/bin"
mkdir -p "$BIN"
cat > "$BIN/docker" <<'EOF'
#!/usr/bin/env bash
S="$DOCKER_STATE"
echo "$*" >> "$S/calls.log"
key() { printf '%s' "$1" | tr '/:' '__'; }
resolve() {
  if [[ -f "$S/tags/$(key "$1")" ]]; then cat "$S/tags/$(key "$1")"; return 0; fi
  if [[ -f "$S/env/$(key "$1")" ]]; then echo "$1"; return 0; fi
  return 1
}
tags_of() {
  local f
  for f in "$S"/tags/*; do
    [[ -f "$f" && "$f" != *.name ]] || continue
    [[ "$(cat "$f")" == "$1" ]] && cat "$f.name"
  done
  return 0
}
settag() { printf '%s' "$2" > "$S/tags/$(key "$1")"; printf '%s\n' "$1" > "$S/tags/$(key "$1").name"; }
if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  shift 2; fmt=""
  if [[ "$1" == "--format" ]]; then fmt="$2"; shift 2; fi
  id=$(resolve "$1") || { echo "Error: No such image: $1" >&2; echo "[]"; exit 1; }
  case "$fmt" in
    '{{.Id}}') echo "$id" ;;
    *Config.Env*) cat "$S/env/$(key "$id")" ;;
    *RepoTags*) tags_of "$id" ;;
    *) echo "unsupported format: $fmt" >&2; exit 2 ;;
  esac
  exit 0
fi
if [[ "$1" == "tag" ]]; then
  id=$(resolve "$2") || { echo "Error: No such image: $2" >&2; exit 1; }
  settag "$3" "$id"; exit 0
fi
if [[ "$1" == "build" ]]; then
  shift; new_tags=(); sha=unknown
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -t) new_tags+=("$2"); shift 2 ;;
      --build-arg) [[ "$2" == GIT_SHA=* ]] && sha="${2#GIT_SHA=}"; shift 2 ;;
      -f) shift 2 ;;
      *) shift ;;
    esac
  done
  id="sha256:$(printf '%64s' '' | tr ' ' b)"
  printf 'PATH=/usr/bin\nGIT_SHA=%s\n' "$sha" > "$S/env/$(key "$id")"
  for t in "${new_tags[@]}"; do settag "$t" "$id"; done
  echo "$id" > "$S/built_id"
  exit 0
fi
if [[ "$1" == "image" && "$2" == "rm" ]]; then
  for ref in "${@:3}"; do
    if [[ -f "$S/tags/$(key "$ref")" ]]; then rm -f "$S/tags/$(key "$ref")" "$S/tags/$(key "$ref").name"; echo "Untagged: $ref"
    else echo "Error: No such image: $ref" >&2; exit 1; fi
  done
  exit 0
fi
if [[ "$1" == "image" && "$2" == "prune" ]]; then
  # 模拟 dangling prune：删掉没有任何 tag 的镜像
  for e in "$S"/env/*; do
    [[ -f "$e" ]] || continue
    has=0
    for f in "$S"/tags/*; do
      [[ -f "$f" && "$f" != *.name ]] || continue
      [[ "$(key "$(cat "$f")")" == "$(basename "$e")" ]] && has=1
    done
    [[ $has -eq 0 ]] && rm -f "$e"
  done
  exit 0
fi
if [[ "$1" == "images" ]]; then echo "1GB"; exit 0; fi
echo "unexpected docker call: $*" >&2
exit 0
EOF
chmod +x "$BIN/docker"

# ── 造最小仓库（本地 bare 仓库作 origin），把被测 brain-build.sh 拷进去跑 ──
make_repo() {
  local version="$1" dir="$2"
  git init -q --bare "$dir.git"
  git init -q "$dir"
  mkdir -p "$dir/packages/brain" "$dir/scripts"
  printf '{"name":"x","version":"%s"}\n' "$version" > "$dir/packages/brain/package.json"
  printf 'FROM scratch\n' > "$dir/packages/brain/Dockerfile"
  cp "$SRC" "$dir/scripts/brain-build.sh"
  git -C "$dir" add -A
  git -C "$dir" -c core.hooksPath=/dev/null -c user.email=t@t -c user.name=t commit -qm init
  git -C "$dir" branch -M main
  git -C "$dir" remote add origin "$dir.git"
  git -C "$dir" -c core.hooksPath=/dev/null push -q origin main
  git -C "$dir" fetch -q origin main
}
# 场景种子：$1=状态目录；其余参数 "tag=id" 或 "env:id=sha"
seed() {
  local s="$1" kv k v; shift
  mkdir -p "$s/tags" "$s/env"; : > "$s/calls.log"
  for kv in "$@"; do
    case "$kv" in
      env:*) kv="${kv#env:}"; printf 'PATH=/usr/bin\nGIT_SHA=%s\n' "${kv#*=}" > "$s/env/$(key "${kv%%=*}")" ;;
      *) k="${kv%%=*}"; v="${kv#*=}"; printf '%s' "$v" > "$s/tags/$(key "$k")"; printf '%s\n' "$k" > "$s/tags/$(key "$k").name" ;;
    esac
  done
}
tags_of() { # $1=state $2=id → 排序后的 tag（空格分隔）
  local f out=""
  for f in "$1"/tags/*; do
    [[ -f "$f" && "$f" != *.name ]] || continue
    [[ "$(cat "$f")" == "$2" ]] && out+="$(cat "$f.name")"$'\n'
  done
  printf '%s' "$out" | sort | tr '\n' ' ' | sed 's/ $//'
}
run_build() { PATH="$BIN:$PATH" DOCKER_STATE="$2" bash "$1/scripts/brain-build.sh" > "$2/out.log" 2>&1; }

# ── T1：同版本号、不同 SHA 重建 ──
R1="$TMPD/r1"; S1="$TMPD/s1"
make_repo 1.0.0 "$R1"
NEW12=$(git -C "$R1" rev-parse FETCH_HEAD | cut -c1-12)
seed "$S1" "cecelia-brain:1.0.0=$OLD_ID" "cecelia-brain:latest=$OLD_ID" "env:$OLD_ID=$OLD_SHA"
if run_build "$R1" "$S1"; then pass "T1 构建成功"; else fail "T1 构建失败：$(tail -5 "$S1/out.log")"; fi
NEW_ID=$(cat "$S1/built_id" 2>/dev/null)
got=$(tags_of "$S1" "$NEW_ID"); want="cecelia-brain:1.0.0 cecelia-brain:1.0.0-$NEW12 cecelia-brain:latest"
[[ "$got" == "$want" ]] && pass "T1 新镜像额外带 \${VERSION}-\${sha12}" || fail "T1 新镜像 tags=[$got]，期望 [$want]"
got=$(tags_of "$S1" "$OLD_ID"); want="cecelia-brain:prev-1.0.0-${OLD_SHA:0:12}"
[[ "$got" == "$want" ]] && pass "T1 旧镜像只保留 prev-\${VERSION}-\${oldsha12} 一个 tag" || fail "T1 旧镜像 tags=[$got]，期望 [$want]"
[[ -f "$S1/env/$(key "$OLD_ID")" ]] && pass "T1 旧镜像未被 dangling prune 删掉" || fail "T1 旧镜像被 prune 删掉了"

# ── T2：新版本正常构建；上一版带过 \${VERSION}-\${sha12} 别名要收掉（只留版本 tag，janitor 才能按 id 删）──
R2="$TMPD/r2"; S2="$TMPD/s2"
make_repo 1.0.1 "$R2"
seed "$S2" "cecelia-brain:1.0.0=$PRIOR_ID" "cecelia-brain:1.0.0-cccccccccccc=$PRIOR_ID" "cecelia-brain:latest=$PRIOR_ID" "env:$PRIOR_ID=$(hex c 40)"
if run_build "$R2" "$S2"; then pass "T2 构建成功"; else fail "T2 构建失败：$(tail -5 "$S2/out.log")"; fi
NEW_ID=$(cat "$S2/built_id" 2>/dev/null)
got=$(tags_of "$S2" "$NEW_ID")
[[ "$got" == "cecelia-brain:1.0.1 cecelia-brain:latest" ]] && pass "T2 无版本冲突时不额外打 sha tag" || fail "T2 新镜像 tags=[$got]"
got=$(tags_of "$S2" "$PRIOR_ID")
[[ "$got" == "cecelia-brain:1.0.0" ]] && pass "T2 被顶替的上一版只剩版本 tag" || fail "T2 上一版 tags=[$got]，期望 [cecelia-brain:1.0.0]"
if grep -q 'prev-' "$S2/calls.log"; then fail "T2 不该打 prev tag"; else pass "T2 未打 prev tag"; fi

# ── T3：同版本同 SHA 重建 → 不打 prev / sha tag ──
R3="$TMPD/r3"; S3="$TMPD/s3"
make_repo 1.0.0 "$R3"
seed "$S3" "cecelia-brain:1.0.0=$OLD_ID" "cecelia-brain:latest=$OLD_ID" "env:$OLD_ID=$(git -C "$R3" rev-parse FETCH_HEAD)"
if run_build "$R3" "$S3"; then pass "T3 构建成功"; else fail "T3 构建失败：$(tail -5 "$S3/out.log")"; fi
NEW_ID=$(cat "$S3/built_id" 2>/dev/null)
got=$(tags_of "$S3" "$NEW_ID")
[[ "$got" == "cecelia-brain:1.0.0 cecelia-brain:latest" ]] && pass "T3 同 SHA 重建不额外打 tag" || fail "T3 新镜像 tags=[$got]"
if grep -q 'prev-' "$S3/calls.log"; then fail "T3 同 SHA 不该打 prev tag"; else pass "T3 未打 prev tag"; fi

# ── T4：全新环境（无旧镜像）照常构建 ──
R4="$TMPD/r4"; S4="$TMPD/s4"
make_repo 1.0.0 "$R4"
seed "$S4"
if run_build "$R4" "$S4"; then pass "T4 全新环境构建成功"; else fail "T4 构建失败：$(tail -5 "$S4/out.log")"; fi
NEW_ID=$(cat "$S4/built_id" 2>/dev/null)
got=$(tags_of "$S4" "$NEW_ID")
[[ "$got" == "cecelia-brain:1.0.0 cecelia-brain:latest" ]] && pass "T4 新镜像只带版本与 latest" || fail "T4 新镜像 tags=[$got]"

echo ""
# 固定候选A后main推进到B，构建仍必须读A的源码/版本/镜像戳。
R5="$TMPD/r5"; S5="$TMPD/s5"
make_repo 1.2.0 "$R5"
PINNED_SHA=$(git -C "$R5" rev-parse HEAD)
printf '{"name":"x","version":"1.3.0"}\n' > "$R5/packages/brain/package.json"
git -C "$R5" add packages/brain/package.json
git -C "$R5" -c core.hooksPath=/dev/null -c user.email=t@t -c user.name=t commit -qm newer
git -C "$R5" -c core.hooksPath=/dev/null push -q origin main
seed "$S5"
if EXPECTED_SHA="$PINNED_SHA" run_build "$R5" "$S5"; then pass "T5 固定候选构建成功"; else fail "T5 固定候选构建失败"; fi
NEW_ID=$(cat "$S5/built_id" 2>/dev/null)
got=$(tags_of "$S5" "$NEW_ID")
[[ "$got" == "cecelia-brain:1.2.0 cecelia-brain:latest" ]] && pass "T5 版本取固定源码A" || fail "T5 版本漂移到mainB"
grep -q "GIT_SHA=$PINNED_SHA" "$S5/env/$(key "$NEW_ID")" && pass "T5 镜像戳同固定源码A" || fail "T5 镜像戳不匹配"

echo "=== brain-deploy-build-same-version: $PASS PASS / $ERRORS FAIL ==="
[[ $ERRORS -eq 0 ]]
