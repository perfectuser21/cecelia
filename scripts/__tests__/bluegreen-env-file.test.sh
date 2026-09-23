#!/usr/bin/env bash
# 回归测试：blue 容器 env 含空格值时，green canary 的 docker run 参数不能被打散。
#
# 2026-09-23 14:40Z Gate3 全红根因：brain-deploy.sh 用 `{{range .Config.Env}}-e {{.}} {{end}}`
# 把 blue 的 env 拼成一个字符串，经 bluegreen_swap 的 ${GREEN_RUN_ARGS:-} 不加引号展开；
# blue 新增 QIUMI_MODEL_MAP="a b" 这类含空格 env 后，`docker run` 收到零散 token 报
# `docker: invalid reference format`，且 stderr 被 >/dev/null 吞掉，日志只剩"green 起容器失败"。
# 本测试用 fake docker 记录 argv：① 含空格值必须经 --env-file 原样到达；② 起容器失败时
# docker 的 stderr 必须出现在 bluegreen_swap 的输出里。
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BLUEGREEN_SH="$REPO_ROOT/scripts/lib/bluegreen.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0

# ── fake docker：inspect 回放一个含空格 env 的 blue；run -d 把 argv 逐行记录；其余全成功 ──
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "inspect "*)
    fmt=""
    for a in "$@"; do case "$a" in --format=*) fmt="${a#--format=}";; esac; done
    for ((i=1;i<=$#;i++)); do [[ "${!i}" == "--format" ]] && { j=$((i+1)); fmt="${!j}"; }; done
    if [[ "$fmt" == *"Config.Env"* ]]; then
      if [[ "$fmt" == *"-e "* ]]; then
        printf -- '-e PLAIN=1 -e QIUMI_MODEL_MAP=chat:haiku default:sonnet -e DB_PASSWORD=p ';
      else
        printf 'PLAIN=1\nQIUMI_MODEL_MAP=chat:haiku default:sonnet\nDB_PASSWORD=p\n'
      fi
    elif [[ "$fmt" == *"Mounts"* ]]; then
      printf -- '-v /srv/data:/app/data '
    elif [[ "$fmt" == *"Networks"* ]]; then
      printf 'host \n'
    else
      printf 'x\n'
    fi
    exit 0;;
  "run -d")
    printf '%s\n' "$@" > "$FAKE_DOCKER_ARGV"
    if [[ -n "${FAKE_DOCKER_RUN_FAIL:-}" ]]; then
      echo "docker: invalid reference format" >&2; exit 125
    fi
    echo "deadbeef"; exit 0;;
  *) exit 0;;
esac
EOF
chmod +x "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"
export FAKE_DOCKER_ARGV="$TMP/argv.txt"

# shellcheck disable=SC1090
source "$BLUEGREEN_SH"
send_bark() { :; }
bluegreen_guard_blue() { :; }
bluegreen_wait_for_stable_http() { return 1; }   # 只测起容器这一步，health 直接判负

# ── 用例 1：bluegreen_green_run_args 必须存在，并产出 --env-file，值原样落文件 ──
if ! declare -F bluegreen_green_run_args >/dev/null; then
  echo "FAIL: bluegreen.sh 未导出 bluegreen_green_run_args（blue env 仍走不加引号的 -e 拼接）"
  FAIL=1
else
  ENV_FILE="$TMP/green.env"
  ARGS=$(bluegreen_green_run_args blue-test "$ENV_FILE")
  if [[ "$ARGS" != *"--env-file ${ENV_FILE}"* ]]; then
    echo "FAIL: run args 未含 --env-file：$ARGS"; FAIL=1
  fi
  if [[ "$ARGS" == *"-e QIUMI_MODEL_MAP"* ]]; then
    echo "FAIL: run args 仍把含空格 env 拼成 -e：$ARGS"; FAIL=1
  fi
  if ! grep -qx 'QIUMI_MODEL_MAP=chat:haiku default:sonnet' "$ENV_FILE"; then
    echo "FAIL: env-file 未原样保留含空格的值："; cat "$ENV_FILE"; FAIL=1
  fi
  if [[ "$ARGS" != *"-v /srv/data:/app/data"* || "$ARGS" != *"-e CECELIA_INTERNAL_TOKEN"* ]]; then
    echo "FAIL: run args 丢了卷或 CECELIA_INTERNAL_TOKEN 透传：$ARGS"; FAIL=1
  fi

  # ── 用例 2：经 bluegreen_swap 展开后，docker run 的每个 argv 完整（无零散 token）──
  rm -f "$FAKE_DOCKER_ARGV"
  GREEN_RUN_ARGS="$ARGS" TARGET_VERSION=9.9.9 BLUE_NAME=blue-test GREEN_NAME=green-test \
    TEMP_PORT=5233 HEALTH_TIMEOUT=1 bluegreen_swap >/dev/null 2>&1 || true
  if [[ ! -f "$FAKE_DOCKER_ARGV" ]]; then
    echo "FAIL: bluegreen_swap 没有调用 docker run"; FAIL=1
  else
    if grep -qx 'default:sonnet' "$FAKE_DOCKER_ARGV"; then
      echo "FAIL: docker run argv 里出现零散 token default:sonnet（env 值被打散）"; FAIL=1
    fi
    if ! grep -qx -- "--env-file" "$FAKE_DOCKER_ARGV" || ! grep -qx "$ENV_FILE" "$FAKE_DOCKER_ARGV"; then
      echo "FAIL: docker run argv 未含 --env-file $ENV_FILE"; cat "$FAKE_DOCKER_ARGV"; FAIL=1
    fi
    if ! grep -qx 'cecelia-brain:9.9.9' "$FAKE_DOCKER_ARGV"; then
      echo "FAIL: docker run argv 镜像引用不完整"; cat "$FAKE_DOCKER_ARGV"; FAIL=1
    fi
  fi

  # ── 用例 3：起容器失败时，docker 的 stderr 必须出现在输出里（不再 >/dev/null 吞掉）──
  OUT=$(FAKE_DOCKER_RUN_FAIL=1 GREEN_RUN_ARGS="$ARGS" TARGET_VERSION=9.9.9 BLUE_NAME=blue-test \
        GREEN_NAME=green-test TEMP_PORT=5233 HEALTH_TIMEOUT=1 bluegreen_swap 2>&1 || true)
  if [[ "$OUT" != *"invalid reference format"* ]]; then
    echo "FAIL: 起容器失败时未打印 docker stderr，输出为：$OUT"; FAIL=1
  fi
fi

# ── 用例 4：brain-deploy.sh 不得再用 -e 拼接 blue env ──
if grep -qE "range \.Config\.Env\}\}-e " "$REPO_ROOT/scripts/brain-deploy.sh"; then
  echo "FAIL: brain-deploy.sh 仍用 {{range .Config.Env}}-e {{.}} 拼接 blue env"; FAIL=1
fi
if ! grep -q "bluegreen_green_run_args" "$REPO_ROOT/scripts/brain-deploy.sh"; then
  echo "FAIL: brain-deploy.sh 未改用 bluegreen_green_run_args"; FAIL=1
fi

if [ "$FAIL" -eq 1 ]; then
  echo "❌ bluegreen-env-file.test.sh 失败"; exit 1
fi
echo "✅ bluegreen-env-file.test.sh 通过：含空格 env 经 --env-file 原样到达，起容器失败可见 stderr"
