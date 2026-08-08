#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
VERIFIER="$REPO_ROOT/docker/verify-digest-pin.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

[[ -f "$VERIFIER" ]] || fail "missing docker/verify-digest-pin.sh"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

PIN='sha256:1111111111111111111111111111111111111111111111111111111111111111'
OTHER='sha256:2222222222222222222222222222222222222222222222222222222222222222'

# 假 node-profile.js（runner_image_digest 行形态与真文件一致即可被解析）
cat > "$test_root/node-profile.js" << EOF
const CANONICAL_BASELINE = Object.freeze({
  runner_image_digest: '$PIN',
});
EOF

# mock docker：docker image inspect --format {{.Id}} <ref> → 输出预设 digest
make_docker() {
  local digest="$1"
  cat > "$test_root/docker" << EOF
#!/usr/bin/env bash
if [[ "\$1" == image && "\$2" == inspect ]]; then
  printf '%s\n' '$digest'
  exit 0
fi
exit 64
EOF
  chmod +x "$test_root/docker"
}

# case 1: digest 与 pin 一致 → exit 0
make_docker "$PIN"
VERIFY_PIN_DOCKER="$test_root/docker" \
  VERIFY_PIN_NODE_PROFILE="$test_root/node-profile.js" \
  bash "$VERIFIER" cecelia/runner:test >/dev/null 2>&1 \
  || fail "match case should exit 0"

# case 2: 漂移 → exit 3 且 stderr 含实际 digest + pin 文件清单
make_docker "$OTHER"
set +e
stderr_out="$(VERIFY_PIN_DOCKER="$test_root/docker" \
  VERIFY_PIN_NODE_PROFILE="$test_root/node-profile.js" \
  bash "$VERIFIER" cecelia/runner:test 2>&1 >/dev/null)"
status=$?
set -e
[[ "$status" -eq 3 ]] || fail "drift case should exit 3, got $status"
printf '%s' "$stderr_out" | grep -q "$OTHER" || fail "drift stderr should show actual digest"
printf '%s' "$stderr_out" | grep -q 'node-profile.js' || fail "drift stderr should list pin files"

# case 3: 镜像不存在（docker inspect 失败）→ exit 1
cat > "$test_root/docker" << 'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$test_root/docker"
set +e
VERIFY_PIN_DOCKER="$test_root/docker" \
  VERIFY_PIN_NODE_PROFILE="$test_root/node-profile.js" \
  bash "$VERIFIER" cecelia/runner:test >/dev/null 2>&1
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "missing image should exit 1, got $status"

echo "PASS: verify-digest-pin.test.sh"
