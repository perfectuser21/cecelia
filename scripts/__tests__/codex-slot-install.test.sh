#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="$REPO_ROOT/scripts/install-codex-slot.sh"
PASS=0
FAIL=0
TEST_ROOT=""

pass() {
  PASS=$((PASS + 1))
  printf '  PASS: %s\n' "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  printf '  FAIL: %s — %s\n' "$1" "$2"
}

assert_true() {
  local name="$1"
  shift
  if "$@"; then
    pass "$name"
  else
    fail "$name" "command failed: $*"
  fi
}

assert_eq() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass "$name"
  else
    fail "$name" "expected [$expected], got [$actual]"
  fi
}

assert_contains() {
  local name="$1"
  local needle="$2"
  local haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    pass "$name"
  else
    fail "$name" "missing [$needle]"
  fi
}

assert_not_contains() {
  local name="$1"
  local needle="$2"
  local haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    pass "$name"
  else
    fail "$name" "unexpected [$needle]"
  fi
}

mode_of() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

cleanup() {
  if [[ -n "$TEST_ROOT" && -d "$TEST_ROOT" ]]; then
    rm -rf "$TEST_ROOT"
  fi
}
trap cleanup EXIT

make_mock_bin() {
  local root="$1"
  local mock_bin="$root/mock-bin"
  mkdir -p "$mock_bin"

  cat >"$mock_bin/shasum" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'shasum' >>"$MOCK_COMMAND_LOG"
printf '\t%s' "$@" >>"$MOCK_COMMAND_LOG"
printf '\n' >>"$MOCK_COMMAND_LOG"
if [[ -n "${MOCK_SHASUM_DELAY:-}" ]]; then
  sleep "$MOCK_SHASUM_DELAY"
fi
if [[ "${MOCK_REPLACE_LOCAL_LOCK:-0}" == "1" &&
      "$*" == *"codex-slot.new."* ]]; then
  owner="$HOME/.local/lib/.codex-slot-install.lock/owner.json"
  [[ -f "$owner" ]] || exit 97
  original_token="$(sed -n 's/.*"token":[[:space:]]*"\([^"]*\)".*/\1/p' "$owner")"
  [[ -n "$original_token" ]] || exit 98
  lock="${owner%/owner.json}"
  /bin/rm -f "$owner"
  /bin/rmdir "$lock"
  /bin/mkdir "$lock"
  printf '{"pid":999999,"host":"replacement-host","start":1,"token":"%s"}\n' \
    "$original_token" >"$owner"
  exit 72
fi
exec /usr/bin/shasum "$@"
MOCK

  cat >"$mock_bin/scp" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'scp' >>"$MOCK_COMMAND_LOG"
printf '\t%s' "$@" >>"$MOCK_COMMAND_LOG"
printf '\n' >>"$MOCK_COMMAND_LOG"
if [[ -n "${MOCK_SCP_FAIL_MATCH:-}" && "$*" == *"$MOCK_SCP_FAIL_MATCH"* ]]; then
  exit 71
fi
source_path="${@: -2:1}"
destination="${@: -1}"
remote_host="${destination%%:*}"
remote_path="${destination#*:}"
remote_home="$MOCK_REMOTE_ROOT/$remote_host"
mkdir -p "$remote_home/$(dirname "$remote_path")"
/bin/cp "$source_path" "$remote_home/$remote_path"
MOCK

  cat >"$mock_bin/ssh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'ssh' >>"$MOCK_COMMAND_LOG"
printf '\t%s' "$@" >>"$MOCK_COMMAND_LOG"
printf '\n' >>"$MOCK_COMMAND_LOG"

command_arg="${!#}"
remote_host="${@: -2:1}"
remote_home="$MOCK_REMOTE_ROOT/$remote_host"
remote_shell="${MOCK_REMOTE_LOGIN_SHELL:-/bin/sh}"
mkdir -p "$remote_home"
if [[ "$command_arg" == *"shasum -a 256"* ]]; then
  if [[ "${MOCK_REMOTE_SHA_MODE:-ok}" == "mismatch" ]]; then
    printf '%064d  remote.new\n' 0
    exit 0
  fi
  HOME="$remote_home" "$remote_shell" -c "$command_arg"
  exit $?
fi

if [[ ! -t 0 ]]; then
  stdin_text="$(/bin/cat)"
  if [[ -n "$stdin_text" ]]; then
    printf 'ssh-stdin\t%s\n' "$(printf '%s' "$stdin_text" | tr '\n' '|')" \
      >>"$MOCK_COMMAND_LOG"
  fi
fi
HOME="$remote_home" "$remote_shell" -c "$command_arg"
MOCK

  cat >"$mock_bin/mv" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'mv' >>"$MOCK_COMMAND_LOG"
printf '\t%s' "$@" >>"$MOCK_COMMAND_LOG"
printf '\n' >>"$MOCK_COMMAND_LOG"

source_path="${@: -2:1}"
destination="${@: -1}"
is_remote_final=0
remote_root="${MOCK_REMOTE_ROOT:-/__codex_slot_no_remote__}"
if [[ "$source_path" == "$remote_root/"*"/.local/lib/codex-slot/"*.new.* &&
      "$destination" == "$remote_root/"*"/.local/lib/codex-slot/codex-slot-"*.mjs ]]; then
  is_remote_final=1
  count_file="${MOCK_COMMAND_LOG}.remote-mv-count"
  count=0
  [[ -f "$count_file" ]] && count="$(<"$count_file")"
  count=$((count + 1))
  printf '%s\n' "$count" >"$count_file"

  if [[ -n "${MOCK_CAPTURE_REMOTE_OWNER:-}" ]]; then
    owner="$(dirname "$(dirname "$destination")")/.codex-slot-install.lock/owner.json"
    [[ -f "$owner" ]] || exit 96
    /bin/cp "$owner" "$MOCK_CAPTURE_REMOTE_OWNER"
    printf '%s\n' "$PPID" >"${MOCK_CAPTURE_REMOTE_OWNER}.shell-pid"
  fi

  if [[ "${MOCK_REPLACE_REMOTE_LOCK_AT:-0}" == "$count" ]]; then
    owner="$(dirname "$(dirname "$destination")")/.codex-slot-install.lock/owner.json"
    [[ -f "$owner" ]] || exit 95
    original_token="$(sed -n 's/.*"token":[[:space:]]*"\([^"]*\)".*/\1/p' "$owner")"
    [[ -n "$original_token" ]] || exit 94
    lock="${owner%/owner.json}"
    /bin/rm -f "$owner"
    /bin/rmdir "$lock"
    /bin/mkdir "$lock"
    printf '{"pid":999999,"host":"replacement-host","start":1,"token":"%s"}\n' \
      "$original_token" >"$owner"
    exit 74
  fi

  if [[ "${MOCK_REMOTE_MV_FAIL_AT:-0}" == "$count" ]]; then
    exit 75
  fi

  if [[ "${MOCK_REMOTE_SIGNAL_AT:-0}" == "$count" ]]; then
    /bin/mv "$@"
    /bin/kill "-${MOCK_REMOTE_SIGNAL:-TERM}" "$PPID"
    exit 0
  fi
fi

if [[ -n "${MOCK_MV_FAIL_ONCE_DEST_MATCH:-}" &&
      "$destination" == *"$MOCK_MV_FAIL_ONCE_DEST_MATCH"* ]]; then
  marker="${MOCK_COMMAND_LOG}.mv-failed-once"
  if [[ ! -e "$marker" ]]; then
    : >"$marker"
    exit 76
  fi
fi

exec /bin/mv "$@"
MOCK

  cat >"$mock_bin/chmod" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'chmod' >>"$MOCK_COMMAND_LOG"
printf '\t%s' "$@" >>"$MOCK_COMMAND_LOG"
printf '\n' >>"$MOCK_COMMAND_LOG"

destination="${@: -1}"
remote_root="${MOCK_REMOTE_ROOT:-/__codex_slot_no_remote__}"
if [[ "$*" == 755* &&
      "$destination" == "$remote_root/"*"/.local/lib/codex-slot/codex-slot-"*.mjs ]]; then
  count_file="${MOCK_COMMAND_LOG}.remote-chmod-count"
  count=0
  [[ -f "$count_file" ]] && count="$(<"$count_file")"
  count=$((count + 1))
  printf '%s\n' "$count" >"$count_file"
  if [[ "${MOCK_REMOTE_CHMOD_FAIL_AT:-0}" == "$count" ]]; then
    exit 77
  fi
fi

exec /bin/chmod "$@"
MOCK

  cat >"$mock_bin/rmdir" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf 'rmdir' >>"$MOCK_COMMAND_LOG"
printf '\t%s' "$@" >>"$MOCK_COMMAND_LOG"
printf '\n' >>"$MOCK_COMMAND_LOG"
exec /bin/rmdir "$@"
MOCK

  chmod 755 \
    "$mock_bin/shasum" \
    "$mock_bin/scp" \
    "$mock_bin/ssh" \
    "$mock_bin/mv" \
    "$mock_bin/chmod" \
    "$mock_bin/rmdir"
  printf '%s\n' "$mock_bin"
}

new_case() {
  local label="$1"
  local root="$TEST_ROOT/$label"
  mkdir -p "$root/home with spaces"
  mkdir -p "$root/remotes"
  : >"$root/commands.log"
  make_mock_bin "$root" >/dev/null
  printf '%s\n' "$root"
}

run_install() {
  local root="$1"
  shift
  local home="$root/home with spaces"
  local mock_bin="$root/mock-bin"
  HOME="$home" \
    PATH="$mock_bin:/usr/bin:/bin" \
    MOCK_COMMAND_LOG="$root/commands.log" \
    MOCK_REPO_ROOT="$REPO_ROOT" \
    MOCK_REMOTE_ROOT="$root/remotes" \
    bash "$INSTALLER" "$@"
}

write_lock_owner() {
  local lock="$1"
  local pid="$2"
  local host="$3"
  local start="$4"
  local token="$5"
  mkdir -p "$lock"
  printf '{"pid":%s,"host":"%s","start":%s,"token":"%s"}\n' \
    "$pid" "$host" "$start" "$token" >"$lock/owner.json"
}

seed_old_client() {
  local home="$1"
  mkdir -p \
    "$home/.local/lib/codex-slot" \
    "$home/.local/bin" \
    "$home/.config/codex-slot"
  printf 'old client\n' >"$home/.local/lib/codex-slot/codex-slot-client.mjs"
  printf 'old entry\n' >"$home/.local/lib/codex-slot/codex-slot"
  chmod 750 "$home/.local/lib/codex-slot"
  chmod 711 "$home/.local/lib/codex-slot/codex-slot-client.mjs"
  chmod 744 "$home/.local/lib/codex-slot/codex-slot"
  ln -s "../lib/codex-slot/codex-slot" "$home/.local/bin/codex-slot"
  chmod 750 "$home/.config/codex-slot"
  printf '# old zshrc\n' >"$home/.zshrc"
  chmod 640 "$home/.zshrc"
}

seed_client_observer_files() {
  local home="$1"
  local lib_dir="$home/.local/lib/codex-slot"
  mkdir -p "$lib_dir"
  printf 'broker content: keep exactly\nsecond broker line\n' \
    >"$lib_dir/codex-slot-broker.mjs"
  printf 'store content: keep exactly\nsecond store line\n' \
    >"$lib_dir/codex-slot-store.mjs"
  printf 'unrelated sentinel: keep exactly\n' >"$lib_dir/unrelated-sentinel"
  chmod 641 "$lib_dir/codex-slot-broker.mjs"
  chmod 604 "$lib_dir/codex-slot-store.mjs"
  chmod 400 "$lib_dir/unrelated-sentinel"
}

assert_client_observer_files_preserved() {
  local label="$1"
  local home="$2"
  local lib_dir="$home/.local/lib/codex-slot"
  assert_eq "$label 保留 broker 精确内容" \
    $'broker content: keep exactly\nsecond broker line' \
    "$(cat "$lib_dir/codex-slot-broker.mjs")"
  assert_eq "$label 保留 store 精确内容" \
    $'store content: keep exactly\nsecond store line' \
    "$(cat "$lib_dir/codex-slot-store.mjs")"
  assert_eq "$label 保留无关 sentinel 精确内容" \
    "unrelated sentinel: keep exactly" \
    "$(tr -d '\n' <"$lib_dir/unrelated-sentinel")"
  assert_eq "$label 保留 broker mode" "641" \
    "$(mode_of "$lib_dir/codex-slot-broker.mjs")"
  assert_eq "$label 保留 store mode" "604" \
    "$(mode_of "$lib_dir/codex-slot-store.mjs")"
  assert_eq "$label 保留无关 sentinel mode" "400" \
    "$(mode_of "$lib_dir/unrelated-sentinel")"
}

assert_old_client_restored() {
  local label="$1"
  local home="$2"
  assert_eq "$label 恢复旧 client 内容" "old client" \
    "$(tr -d '\n' <"$home/.local/lib/codex-slot/codex-slot-client.mjs")"
  assert_eq "$label 恢复旧 entry 内容" "old entry" \
    "$(tr -d '\n' <"$home/.local/lib/codex-slot/codex-slot")"
  assert_eq "$label 恢复旧 lib mode" "750" \
    "$(mode_of "$home/.local/lib/codex-slot")"
  assert_eq "$label 恢复旧 client mode" "711" \
    "$(mode_of "$home/.local/lib/codex-slot/codex-slot-client.mjs")"
  assert_eq "$label 恢复旧 entry mode" "744" \
    "$(mode_of "$home/.local/lib/codex-slot/codex-slot")"
  assert_eq "$label 恢复旧 link" "../lib/codex-slot/codex-slot" \
    "$(readlink "$home/.local/bin/codex-slot")"
  assert_eq "$label 恢复旧 zshrc 内容" "# old zshrc" \
    "$(tr -d '\n' <"$home/.zshrc")"
  assert_eq "$label 恢复旧 zshrc mode" "640" \
    "$(mode_of "$home/.zshrc")"
  assert_eq "$label 恢复旧 config 目录 mode" "750" \
    "$(mode_of "$home/.config/codex-slot")"
  assert_client_observer_files_preserved "$label 回滚" "$home"
}

seed_remote_pair() {
  local root="$1"
  local host="$2"
  local first="$3"
  local second="$4"
  local base="$root/remotes/$host/.local/lib/codex-slot"
  mkdir -p "$base"
  printf 'old first\n' >"$base/$first"
  printf 'old second\n' >"$base/$second"
  chmod 711 "$base/$first"
  chmod 640 "$base/$second"
}

assert_remote_pair_restored() {
  local label="$1"
  local root="$2"
  local host="$3"
  local first="$4"
  local second="$5"
  local base="$root/remotes/$host/.local/lib/codex-slot"
  assert_eq "$label 恢复第一文件内容" "old first" \
    "$(tr -d '\n' <"$base/$first")"
  assert_eq "$label 恢复第二文件内容" "old second" \
    "$(tr -d '\n' <"$base/$second")"
  assert_eq "$label 恢复第一文件 mode" "711" "$(mode_of "$base/$first")"
  assert_eq "$label 恢复第二文件 mode" "640" "$(mode_of "$base/$second")"
}

test_client_install_and_idempotency() {
  local root
  root="$(new_case client)"
  local home="$root/home with spaces"
  printf '# user sentinel\n' >"$home/.zshrc"

  if ! run_install "$root" --client-only >"$root/first.out" 2>&1; then
    fail "client-only 首次安装成功" "$(cat "$root/first.out")"
    return
  fi
  pass "client-only 首次安装成功"

  assert_true "client 入口是可执行软链" test -x "$home/.local/bin/codex-slot"
  assert_true "client 入口指向 lib 内脚本" test -L "$home/.local/bin/codex-slot"
  assert_true "client ESM 安装到固定 lib" \
    cmp -s "$REPO_ROOT/scripts/codex-slot-client.mjs" \
      "$home/.local/lib/codex-slot/codex-slot-client.mjs"
  assert_true "client Bash 入口安装到固定 lib" \
    cmp -s "$REPO_ROOT/scripts/codex-slot" \
      "$home/.local/lib/codex-slot/codex-slot"
  assert_eq "client lib 目录 mode 700" "700" \
    "$(mode_of "$home/.local/lib/codex-slot")"
  assert_eq "client 入口脚本 mode 755" "755" \
    "$(mode_of "$home/.local/lib/codex-slot/codex-slot")"
  assert_eq "client ESM mode 755" "755" \
    "$(mode_of "$home/.local/lib/codex-slot/codex-slot-client.mjs")"
  assert_true "默认 config 已安装" \
    cmp -s "$REPO_ROOT/config/codex-slot/hosts.example.json" \
      "$home/.config/codex-slot/config.json"
  assert_eq "PATH begin 标记首次只出现一次" "1" \
    "$(grep -cF '# codex-slot-path-begin' "$home/.zshrc" || true)"
  assert_eq "PATH end 标记首次只出现一次" "1" \
    "$(grep -cF '# codex-slot-path-end' "$home/.zshrc" || true)"
  assert_contains "PATH block 指向 ~/.local/bin" \
    'export PATH="$HOME/.local/bin:$PATH"' "$(cat "$home/.zshrc")"
  assert_contains "PATH 安装保留原 zshrc" '# user sentinel' "$(cat "$home/.zshrc")"

  local first_zshrc
  local first_client_sha
  first_zshrc="$(cat "$home/.zshrc")"
  first_client_sha="$(/usr/bin/shasum -a 256 \
    "$home/.local/lib/codex-slot/codex-slot-client.mjs" | awk '{print $1}')"
  printf '{"broker":"keep-me","hosts":["keep-host"]}\n' \
    >"$home/.config/codex-slot/config.json"

  if ! run_install "$root" --client-only >"$root/second.out" 2>&1; then
    fail "client-only 第二次安装成功" "$(cat "$root/second.out")"
    return
  fi
  pass "client-only 第二次安装成功"
  assert_eq "双跑 PATH 内容完全幂等" "$first_zshrc" "$(cat "$home/.zshrc")"
  assert_eq "双跑 client 内容不漂移" "$first_client_sha" \
    "$(/usr/bin/shasum -a 256 \
      "$home/.local/lib/codex-slot/codex-slot-client.mjs" | awk '{print $1}')"
  assert_contains "已存在 config 不覆盖" '"keep-me"' \
    "$(cat "$home/.config/codex-slot/config.json")"
  assert_true "client 原子安装不遗留 .new" \
    sh -c '! find "$1/.local/lib" -name "*.new.*" -print -quit | grep -q .' sh "$home"
}

test_client_install_preserves_shared_home_role_and_observer_files() {
  local root
  root="$(new_case client-shared-home)"
  local home="$root/home with spaces"
  seed_client_observer_files "$home"
  chmod 750 "$home/.local/lib/codex-slot"

  local status=0
  run_install "$root" --client-only >"$root/out" 2>&1 || status=$?
  assert_eq "共 HOME client-only 安装成功" "0" "$status"
  assert_true "共 HOME client-only 更新 client ESM" \
    cmp -s "$REPO_ROOT/scripts/codex-slot-client.mjs" \
      "$home/.local/lib/codex-slot/codex-slot-client.mjs"
  assert_true "共 HOME client-only 更新 Bash entry" \
    cmp -s "$REPO_ROOT/scripts/codex-slot" \
      "$home/.local/lib/codex-slot/codex-slot"
  assert_eq "共 HOME client-only 保持 lib 目录 mode 700" "700" \
    "$(mode_of "$home/.local/lib/codex-slot")"
  assert_client_observer_files_preserved "共 HOME client-only 成功" "$home"
}

test_installed_client_entry_runs_real_esm() {
  local root
  root="$(new_case client-real-entry)"
  local home="$root/home with spaces"
  if ! run_install "$root" --client-only >"$root/install.out" 2>&1; then
    fail "真实临时 HOME client 安装成功" "$(cat "$root/install.out")"
    return
  fi
  pass "真实临时 HOME client 安装成功"

  local status=0
  HOME="$home" "$home/.local/bin/codex-slot" >"$root/run.out" 2>&1 || status=$?
  assert_eq "真实软链入口加载 ESM 后由 CLI 返回缺少命令" "1" "$status"
  assert_contains "真实软链入口运行到 client 参数校验" "缺少命令" \
    "$(cat "$root/run.out")"
  assert_not_contains "真实软链入口不再 MODULE_NOT_FOUND" "MODULE_NOT_FOUND" \
    "$(cat "$root/run.out")"
  assert_eq "client 入口软链直指 lib 可执行 ESM" \
    "../lib/codex-slot/codex-slot-client.mjs" \
    "$(readlink "$home/.local/bin/codex-slot")"
}

test_client_final_transaction_failures_restore_everything() {
  local config_root
  config_root="$(new_case client-config-failure)"
  local config_home="$config_root/home with spaces"
  seed_old_client "$config_home"
  seed_client_observer_files "$config_home"

  local config_status=0
  MOCK_MV_FAIL_ONCE_DEST_MATCH=".config/codex-slot/config.json" \
    run_install "$config_root" --client-only >"$config_root/out" 2>&1 ||
    config_status=$?
  if [[ "$config_status" -ne 0 ]]; then
    pass "config 最终落盘失败使 client 事务失败"
  else
    fail "config 最终落盘失败使 client 事务失败" "installer unexpectedly succeeded"
  fi
  assert_old_client_restored "config 失败" "$config_home"
  assert_true "config 失败恢复原先无 config 文件" \
    test ! -e "$config_home/.config/codex-slot/config.json"

  local path_root
  path_root="$(new_case client-path-failure)"
  local path_home="$path_root/home with spaces"
  seed_old_client "$path_home"
  seed_client_observer_files "$path_home"
  printf '{"broker":"keep-me"}\n' >"$path_home/.config/codex-slot/config.json"
  chmod 640 "$path_home/.config/codex-slot/config.json"

  local path_status=0
  MOCK_MV_FAIL_ONCE_DEST_MATCH="/.zshrc" \
    run_install "$path_root" --client-only >"$path_root/out" 2>&1 ||
    path_status=$?
  if [[ "$path_status" -ne 0 ]]; then
    pass "PATH 最终落盘失败使 client 事务失败"
  else
    fail "PATH 最终落盘失败使 client 事务失败" "installer unexpectedly succeeded"
  fi
  assert_old_client_restored "PATH 失败" "$path_home"
  assert_eq "PATH 失败不覆盖既有 config 内容" '{"broker":"keep-me"}' \
    "$(tr -d '\n' <"$path_home/.config/codex-slot/config.json")"
  assert_eq "PATH 失败保持既有 config mode" "640" \
    "$(mode_of "$path_home/.config/codex-slot/config.json")"
}

test_broker_install_preserves_client_in_same_home() {
  local root
  root="$(new_case broker-shared-home)"
  local home="$root/home with spaces"
  local base="$home/.local/lib/codex-slot"

  if ! run_install "$root" --client-only >"$root/client.out" 2>&1; then
    fail "反向共 HOME 先安装 client 成功" "$(cat "$root/client.out")"
    return
  fi
  pass "反向共 HOME 先安装 client 成功"
  printf 'reverse unrelated sentinel\n' >"$base/reverse-sentinel"
  chmod 440 "$base/reverse-sentinel"

  local client_content
  local entry_content
  local client_mode
  local entry_mode
  client_content="$(cat "$base/codex-slot-client.mjs")"
  entry_content="$(cat "$base/codex-slot")"
  client_mode="$(mode_of "$base/codex-slot-client.mjs")"
  entry_mode="$(mode_of "$base/codex-slot")"

  ln -s "$home" "$root/remotes/mmv"
  local status=0
  run_install "$root" --broker-host mmv >"$root/broker.out" 2>&1 || status=$?
  assert_eq "反向共 HOME broker 安装成功" "0" "$status"
  assert_eq "反向 broker 保留 client 精确内容" "$client_content" \
    "$(cat "$base/codex-slot-client.mjs")"
  assert_eq "反向 broker 保留 Bash entry 精确内容" "$entry_content" \
    "$(cat "$base/codex-slot")"
  assert_eq "反向 broker 保留 client mode" "$client_mode" \
    "$(mode_of "$base/codex-slot-client.mjs")"
  assert_eq "反向 broker 保留 Bash entry mode" "$entry_mode" \
    "$(mode_of "$base/codex-slot")"
  assert_eq "反向 broker 保留无关 sentinel 精确内容" \
    "reverse unrelated sentinel" "$(tr -d '\n' <"$base/reverse-sentinel")"
  assert_eq "反向 broker 保留无关 sentinel mode" "440" \
    "$(mode_of "$base/reverse-sentinel")"
  assert_true "反向共 HOME broker 文件已安装" \
    cmp -s "$REPO_ROOT/scripts/codex-slot-broker.mjs" \
      "$base/codex-slot-broker.mjs"
  assert_true "反向共 HOME store 文件已安装" \
    cmp -s "$REPO_ROOT/scripts/codex-slot-store.mjs" \
      "$base/codex-slot-store.mjs"
}

test_path_component_detection() {
  local exact_root
  exact_root="$(new_case path-exact)"
  local exact_home="$exact_root/home with spaces"
  HOME="$exact_home" \
    PATH="$exact_home/.local/bin:$exact_root/mock-bin:/usr/bin:/bin" \
    MOCK_COMMAND_LOG="$exact_root/commands.log" \
    MOCK_REPO_ROOT="$REPO_ROOT" \
    bash "$INSTALLER" --client-only >"$exact_root/out" 2>&1
  local exact_count=0
  if [[ -f "$exact_home/.zshrc" ]]; then
    exact_count="$(grep -cF '# codex-slot-path-begin' "$exact_home/.zshrc" || true)"
  fi
  assert_eq "PATH 已含准确 ~/.local/bin 时不追加" "0" "$exact_count"

  local prefix_root
  prefix_root="$(new_case path-prefix)"
  local prefix_home="$prefix_root/home with spaces"
  HOME="$prefix_home" \
    PATH="$prefix_home/.local/bin-extra:$prefix_root/mock-bin:/usr/bin:/bin" \
    MOCK_COMMAND_LOG="$prefix_root/commands.log" \
    MOCK_REPO_ROOT="$REPO_ROOT" \
    bash "$INSTALLER" --client-only >"$prefix_root/out" 2>&1
  assert_eq "相似 PATH 组件不误判为 ~/.local/bin" "1" \
    "$(grep -cF '# codex-slot-path-begin' "$prefix_home/.zshrc" || true)"
}

assert_transport_options() {
  local log="$1"
  local bad=0
  while IFS= read -r line; do
    case "$line" in
      ssh$'\t'*|scp$'\t'*)
        if [[ "$line" != *$'\t-o\tBatchMode=yes'* ||
              "$line" != *$'\t-o\tConnectTimeout='* ]]; then
          bad=$((bad + 1))
        fi
        ;;
    esac
  done <"$log"
  assert_eq "全部 SSH/SCP 使用 BatchMode 与 ConnectTimeout" "0" "$bad"
}

test_role_isolation_and_all_defaults() {
  local broker_root
  broker_root="$(new_case broker)"
  if ! run_install "$broker_root" --broker-host mmv \
      >"$broker_root/out" 2>&1; then
    fail "broker-host 安装成功" "$(cat "$broker_root/out")"
    return
  fi
  pass "broker-host 安装成功"
  local broker_log
  broker_log="$(cat "$broker_root/commands.log")"
  assert_contains "broker 上传 broker" "mmv:.local/lib/codex-slot/codex-slot-broker.mjs.new." \
    "$broker_log"
  assert_contains "broker 上传 store" "mmv:.local/lib/codex-slot/codex-slot-store.mjs.new." \
    "$broker_log"
  assert_contains "broker 上传主机路径表" \
    "mmv:.local/lib/codex-slot/broker-hosts.json.new." "$broker_log"
  assert_not_contains "broker 不上传 agent" "codex-slot-agent.mjs" "$broker_log"
  assert_not_contains "broker 不上传 client" "codex-slot-client.mjs" "$broker_log"
  assert_contains "broker 创建 registry 根并设 700" \
    'mkdir -p "$HOME/.codex-slot"' "$broker_log"
  assert_contains "broker 备份目录符合约定" \
    '.codex-script-backups/' "$broker_log"
  assert_contains "broker 使用原子 mv" "ATOMIC_MV" "$broker_log"
  assert_eq "broker registry 根实际 mode 700" "700" \
    "$(mode_of "$broker_root/remotes/mmv/.codex-slot")"
  assert_eq "broker 文件实际 mode 755" "755" \
    "$(mode_of "$broker_root/remotes/mmv/.local/lib/codex-slot/codex-slot-broker.mjs")"
  assert_true "broker 主机路径表内容与版本库一致" \
    cmp -s "$REPO_ROOT/config/codex-slot/broker-hosts.json" \
      "$broker_root/remotes/mmv/.local/lib/codex-slot/broker-hosts.json"
  if ! run_install "$broker_root" --broker-host mmv \
      >"$broker_root/second.out" 2>&1; then
    fail "broker-host 第二次覆盖成功" "$(cat "$broker_root/second.out")"
    return
  fi
  pass "broker-host 第二次覆盖成功"
  assert_true "broker 第二次覆盖实际备份 broker" \
    sh -c 'find "$1" -type f -name codex-slot-broker.mjs -print -quit | grep -q .' \
      sh "$broker_root/remotes/mmv/.codex-script-backups"
  assert_true "broker 第二次覆盖实际备份 store" \
    sh -c 'find "$1" -type f -name codex-slot-store.mjs -print -quit | grep -q .' \
      sh "$broker_root/remotes/mmv/.codex-script-backups"
  assert_transport_options "$broker_root/commands.log"

  local agent_root
  agent_root="$(new_case agent)"
  if ! run_install "$agent_root" --agent-host xian-m4 \
      >"$agent_root/out" 2>&1; then
    fail "agent-host 安装成功" "$(cat "$agent_root/out")"
    return
  fi
  pass "agent-host 安装成功"
  local agent_log
  agent_log="$(cat "$agent_root/commands.log")"
  assert_contains "agent 同事务上传 agent 文件" \
    "xian-m4:.local/lib/codex-slot/codex-slot-agent.mjs.new." "$agent_log"
  assert_contains "agent 同事务上传 store 依赖" \
    "xian-m4:.local/lib/codex-slot/codex-slot-store.mjs.new." "$agent_log"
  assert_not_contains "agent 不上传 broker" "codex-slot-broker.mjs" "$agent_log"
  assert_not_contains "agent 不上传 client" "codex-slot-client.mjs" "$agent_log"
  assert_contains "agent 创建 slot 根并设 700" \
    'mkdir -p "$HOME/.codex-slots"' "$agent_log"
  assert_contains "agent 最终事务明确交给 /bin/sh -c" \
    "/bin/sh -c " "$agent_log"
  assert_contains "agent 部署导出 CODEX_SLOT_EXIT_NODE" \
    'CODEX_SLOT_EXIT_NODE="$exit_node"' "$agent_log"
  assert_contains "agent 文件设 755" "chmod 755" "$agent_log"
  assert_eq "agent slot 根实际 mode 700" "700" \
    "$(mode_of "$agent_root/remotes/xian-m4/.codex-slots")"
  assert_eq "agent 文件实际 mode 755" "755" \
    "$(mode_of "$agent_root/remotes/xian-m4/.local/lib/codex-slot/codex-slot-agent.mjs")"
  assert_eq "agent store 依赖实际 mode 755" "755" \
    "$(mode_of "$agent_root/remotes/xian-m4/.local/lib/codex-slot/codex-slot-store.mjs")"
  local health_status=0
  HOME="$agent_root/remotes/xian-m4" \
    node "$agent_root/remotes/xian-m4/.local/lib/codex-slot/codex-slot-agent.mjs" health \
    >"$agent_root/health.out" 2>&1 || health_status=$?
  assert_eq "部署后的 agent 真实 node health 可加载依赖" "0" "$health_status"
  assert_not_contains "agent 真实 health 不再 ERR_MODULE_NOT_FOUND" \
    "ERR_MODULE_NOT_FOUND" "$(cat "$agent_root/health.out")"
  assert_true "agent 真实 health 输出 JSON" \
    node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' \
      "$agent_root/health.out"
  assert_transport_options "$agent_root/commands.log"

  local all_root
  all_root="$(new_case all)"
  if ! run_install "$all_root" --all >"$all_root/out" 2>&1; then
    fail "all 默认拓扑安装成功" "$(cat "$all_root/out")"
    return
  fi
  pass "all 默认拓扑安装成功"
  local all_log
  all_log="$(cat "$all_root/commands.log")"
  assert_contains "all 默认 broker=mmv" \
    "mmv:.local/lib/codex-slot/codex-slot-broker.mjs.new." "$all_log"
  assert_contains "all 默认 agent 含 xian-m4" \
    "xian-m4:.local/lib/codex-slot/codex-slot-agent.mjs.new." "$all_log"
  assert_contains "all 默认 agent 含 xian-m1" \
    "xian-m1:.local/lib/codex-slot/codex-slot-agent.mjs.new." "$all_log"
}

test_remote_zsh_executes_multi_file_transactions() {
  local root
  root="$(new_case "remote-zsh-'special")"
  assert_true "真实 /bin/zsh 可用于远端默认 shell 回归" test -x /bin/zsh

  local status=0
  MOCK_REMOTE_LOGIN_SHELL=/bin/zsh \
    run_install "$root" --all >"$root/out" 2>&1 || status=$?
  assert_eq "远端默认 zsh 时 all 安装成功" "0" "$status"

  local host
  local role
  for host in mmv xian-m4 xian-m1; do
    if [[ "$host" == "mmv" ]]; then
      role="broker"
    else
      role="agent"
    fi
    local base="$root/remotes/$host/.local/lib/codex-slot"
    assert_true "$host zsh 事务安装独立 $role 文件" \
      test -f "$base/codex-slot-$role.mjs"
    assert_true "$host zsh 事务安装独立 store 文件" \
      test -f "$base/codex-slot-store.mjs"
    assert_true "$host zsh 事务不生成错误合并文件名" \
      test ! -e "$base/codex-slot-$role.mjs codex-slot-store.mjs"
    assert_true "$host zsh 事务不遗留 store staging" \
      sh -c '! find "$1" -maxdepth 1 -name "codex-slot-store.mjs.new.*" -print -quit | grep -q .' \
        sh "$base"
  done
}

test_remote_replacement_values_cannot_escape_final_command() {
  local root
  root="$(new_case "remote-quote-guard")"
  local escaped="$root/escaped"
  local status=0
  CODEX_SLOT_EXIT_NODE="mmv'; touch '$escaped'; \$(touch '$escaped')" \
    run_install "$root" --agent-host xian-m4 >"$root/out" 2>&1 || status=$?

  if [[ "$status" -ne 0 ]]; then
    pass "带单引号和特殊文本的替换值在最终事务前拒绝"
  else
    fail "带单引号和特殊文本的替换值在最终事务前拒绝" \
      "installer unexpectedly succeeded"
  fi
  assert_true "特殊替换文本不能创建逃逸文件" test ! -e "$escaped"
  assert_eq "非法 exit-node 不触发 SSH/SCP" "0" \
    "$(grep -Ec '^(ssh|scp)' "$root/commands.log" || true)"
}

test_sha_mismatch_and_transfer_failure_do_not_move() {
  local mismatch_root
  mismatch_root="$(new_case mismatch)"
  if HOME="$mismatch_root/home with spaces" \
      PATH="$mismatch_root/mock-bin:/usr/bin:/bin" \
      MOCK_COMMAND_LOG="$mismatch_root/commands.log" \
      MOCK_REPO_ROOT="$REPO_ROOT" \
      MOCK_REMOTE_ROOT="$mismatch_root/remotes" \
      MOCK_REMOTE_SHA_MODE=mismatch \
      bash "$INSTALLER" --broker-host mmv \
      >"$mismatch_root/out" 2>&1; then
    fail "SHA mismatch 返回失败" "installer unexpectedly succeeded"
  else
    pass "SHA mismatch 返回失败"
  fi
  local mismatch_log
  mismatch_log="$(cat "$mismatch_root/commands.log")"
  assert_contains "SHA mismatch 确实执行远端校验" "shasum -a 256" "$mismatch_log"
  assert_not_contains "SHA mismatch 拒绝 mv" "ATOMIC_MV" "$mismatch_log"
  assert_not_contains "SHA mismatch 不创建备份" ".codex-script-backups/" "$mismatch_log"

  local failure_root
  failure_root="$(new_case scp-failure)"
  if HOME="$failure_root/home with spaces" \
      PATH="$failure_root/mock-bin:/usr/bin:/bin" \
      MOCK_COMMAND_LOG="$failure_root/commands.log" \
      MOCK_REPO_ROOT="$REPO_ROOT" \
      MOCK_REMOTE_ROOT="$failure_root/remotes" \
      MOCK_SCP_FAIL_MATCH=codex-slot-store.mjs \
      bash "$INSTALLER" --broker-host mmv \
      >"$failure_root/out" 2>&1; then
    fail "中途 SCP 失败返回失败" "installer unexpectedly succeeded"
  else
    pass "中途 SCP 失败返回失败"
  fi
  local failure_log
  failure_log="$(cat "$failure_root/commands.log")"
  assert_not_contains "中途 SCP 失败不做原子替换" "ATOMIC_MV" "$failure_log"
  assert_not_contains "中途 SCP 失败不创建备份" ".codex-script-backups/" "$failure_log"
}

test_unique_staging_names() {
  local root
  root="$(new_case unique)"
  run_install "$root" --agent-host xian-m4 >"$root/one.out" 2>&1
  run_install "$root" --agent-host xian-m4 >"$root/two.out" 2>&1
  local names
  names="$(grep -o \
    'xian-m4:.local/lib/codex-slot/codex-slot-agent.mjs.new.[^[:space:]]*' \
    "$root/commands.log" | sort -u)"
  assert_eq "重复远端部署使用唯一 .new 名" "2" \
      "$(printf '%s\n' "$names" | sed '/^$/d' | wc -l | tr -d ' ')"
}

test_remote_second_file_failures_restore_content_and_mode() {
  local failure_kind
  for failure_kind in mv chmod; do
    local root
    root="$(new_case "remote-second-$failure_kind")"
    seed_remote_pair "$root" mmv codex-slot-broker.mjs codex-slot-store.mjs
    local status=0
    if [[ "$failure_kind" == "mv" ]]; then
      MOCK_REMOTE_MV_FAIL_AT=2 \
        run_install "$root" --broker-host mmv >"$root/out" 2>&1 || status=$?
    else
      MOCK_REMOTE_CHMOD_FAIL_AT=2 \
        run_install "$root" --broker-host mmv >"$root/out" 2>&1 || status=$?
    fi
    if [[ "$status" -ne 0 ]]; then
      pass "远端第二文件 $failure_kind 失败使事务失败"
    else
      fail "远端第二文件 $failure_kind 失败使事务失败" \
        "installer unexpectedly succeeded"
    fi
    assert_remote_pair_restored \
      "远端第二文件 $failure_kind 失败" \
      "$root" mmv codex-slot-broker.mjs codex-slot-store.mjs
    assert_true "远端第二文件 $failure_kind 失败清除事务锁" \
      test ! -e "$root/remotes/mmv/.local/lib/.codex-slot-install.lock"
  done
}

test_remote_signal_handlers_exit_once_and_stop_transaction() {
  local signal
  local expected
  for signal in HUP INT TERM; do
    case "$signal" in
      HUP) expected=129 ;;
      INT) expected=130 ;;
      TERM) expected=143 ;;
    esac
    local root
    root="$(new_case "remote-signal-$signal")"
    seed_remote_pair "$root" mmv codex-slot-broker.mjs codex-slot-store.mjs
    local status=0
    MOCK_REMOTE_SIGNAL_AT=1 MOCK_REMOTE_SIGNAL="$signal" \
      run_install "$root" --broker-host mmv >"$root/out" 2>&1 || status=$?
    assert_eq "远端 $signal 明确对应非零退出" "$expected" "$status"
    assert_remote_pair_restored \
      "远端 $signal" "$root" mmv codex-slot-broker.mjs codex-slot-store.mjs
    assert_eq "远端 $signal 后不继续第二文件替换" "1" \
      "$(<"${root}/commands.log.remote-mv-count")"
    assert_eq "远端 $signal cleanup 只执行一次" "1" \
      "$(grep -c $'^rmdir\t.*\\.codex-slot-install\\.lock$' \
        "$root/commands.log" || true)"
  done
}

test_local_lock_owner_recovery_and_replacement_safety() {
  local host
  host="$(hostname)"
  local now
  now="$(date +%s)"

  local dead_root
  dead_root="$(new_case local-dead-lock)"
  write_lock_owner \
    "$dead_root/home with spaces/.local/lib/.codex-slot-install.lock" \
    999999 "$host" "$now" dead-token
  if CODEX_SLOT_INSTALL_LOCK_TTL_SECONDS=600 \
      run_install "$dead_root" --client-only >"$dead_root/out" 2>&1; then
    pass "本地同 host 死锁未过期也可安全接管"
  else
    fail "本地同 host 死锁未过期也可安全接管" "$(cat "$dead_root/out")"
  fi

  local empty_root
  empty_root="$(new_case local-empty-lock)"
  local empty_lock="$empty_root/home with spaces/.local/lib/.codex-slot-install.lock"
  mkdir -p "$empty_lock"
  touch -t 200001010000 "$empty_lock"
  if CODEX_SLOT_INSTALL_LOCK_TTL_SECONDS=1 \
      run_install "$empty_root" --client-only >"$empty_root/out" 2>&1; then
    pass "本地空旧锁按 mtime TTL 回收"
  else
    fail "本地空旧锁按 mtime TTL 回收" "$(cat "$empty_root/out")"
  fi

  local live_root
  live_root="$(new_case local-live-lock)"
  sleep 20 &
  local live_pid=$!
  write_lock_owner \
    "$live_root/home with spaces/.local/lib/.codex-slot-install.lock" \
    "$live_pid" "$host" 1 live-token
  local live_status=0
  CODEX_SLOT_INSTALL_LOCK_TTL_SECONDS=1 \
    run_install "$live_root" --client-only >"$live_root/out" 2>&1 ||
    live_status=$?
  /bin/kill "$live_pid" 2>/dev/null || true
  wait "$live_pid" 2>/dev/null || true
  if [[ "$live_status" -ne 0 ]]; then
    pass "本地同 host 活锁即使过期仍拒绝"
  else
    fail "本地同 host 活锁即使过期仍拒绝" "installer unexpectedly succeeded"
  fi
  assert_true "本地活锁拒绝时 owner 保持" \
    test -f "$live_root/home with spaces/.local/lib/.codex-slot-install.lock/owner.json"

  local killed_root
  killed_root="$(new_case local-sigkill-lock)"
  local killed_home="$killed_root/home with spaces"
  HOME="$killed_home" \
    PATH="$killed_root/mock-bin:/usr/bin:/bin" \
    MOCK_COMMAND_LOG="$killed_root/commands.log" \
    MOCK_REPO_ROOT="$REPO_ROOT" \
    MOCK_REMOTE_ROOT="$killed_root/remotes" \
    MOCK_SHASUM_DELAY=2 \
    bash "$INSTALLER" --client-only >"$killed_root/first.out" 2>&1 &
  local install_job=$!
  local owner="$killed_home/.local/lib/.codex-slot-install.lock/owner.json"
  local attempts=0
  while [[ ! -f "$owner" && "$attempts" -lt 100 ]]; do
    sleep 0.02
    attempts=$((attempts + 1))
  done
  assert_true "本地安装锁在进入事务时写入 owner metadata" test -f "$owner"
  local owner_pid=""
  if [[ -f "$owner" ]]; then
    owner_pid="$(node -e \
      'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pid))' \
      "$owner")"
  fi
  if [[ -n "$owner_pid" ]]; then
    /bin/kill -KILL "$owner_pid" 2>/dev/null || true
  fi
  wait "$install_job" 2>/dev/null || true
  if run_install "$killed_root" --client-only >"$killed_root/second.out" 2>&1; then
    pass "本地 SIGKILL 遗留 owner 死锁可恢复"
  else
    fail "本地 SIGKILL 遗留 owner 死锁可恢复" "$(cat "$killed_root/second.out")"
  fi

  local replaced_root
  replaced_root="$(new_case local-replaced-lock)"
  local replaced_status=0
  MOCK_REPLACE_LOCAL_LOCK=1 \
    run_install "$replaced_root" --client-only >"$replaced_root/out" 2>&1 ||
    replaced_status=$?
  if [[ "$replaced_status" -ne 0 ]]; then
    pass "本地 owner 替换后安装失败"
  else
    fail "本地 owner 替换后安装失败" "installer unexpectedly succeeded"
  fi
  local replaced_owner="$replaced_root/home with spaces/.local/lib/.codex-slot-install.lock/owner.json"
  assert_true "本地 cleanup 绝不误删替换锁" test -f "$replaced_owner"
  if [[ -f "$replaced_owner" ]]; then
    assert_contains "本地同 token 替换锁 owner 保持" '"host":"replacement-host"' \
      "$(cat "$replaced_owner")"
  fi
}

test_remote_lock_owner_recovery_and_replacement_safety() {
  local host
  host="$(hostname)"
  local now
  now="$(date +%s)"

  local capture_root
  capture_root="$(new_case remote-owner)"
  local capture="$capture_root/remote-owner.json"
  if MOCK_CAPTURE_REMOTE_OWNER="$capture" \
      run_install "$capture_root" --broker-host mmv >"$capture_root/out" 2>&1; then
    pass "远端事务锁写入 owner metadata"
  else
    fail "远端事务锁写入 owner metadata" "$(cat "$capture_root/out")"
  fi
  if [[ -f "$capture" ]]; then
    assert_true "远端 owner 含 pid/host/start/token" \
      node -e '
        const owner = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) process.exit(1);
        if (typeof owner.host !== "string" || owner.host.length === 0) process.exit(2);
        if (!Number.isInteger(owner.start) || owner.start <= 0) process.exit(3);
        if (typeof owner.token !== "string" || owner.token.length === 0) process.exit(4);
      ' "$capture"
    assert_eq "远端 owner pid 是同一安装 transaction shell" \
      "$(<"${capture}.shell-pid")" \
      "$(node -e \
        'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pid))' \
        "$capture")"
  fi

  local dead_root
  dead_root="$(new_case remote-dead-lock)"
  write_lock_owner \
    "$dead_root/remotes/mmv/.local/lib/.codex-slot-install.lock" \
    999999 "$host" "$now" dead-token
  if CODEX_SLOT_INSTALL_LOCK_TTL_SECONDS=600 \
      run_install "$dead_root" --broker-host mmv >"$dead_root/out" 2>&1; then
    pass "远端同 host 死锁未过期也可安全接管"
  else
    fail "远端同 host 死锁未过期也可安全接管" "$(cat "$dead_root/out")"
  fi

  local empty_root
  empty_root="$(new_case remote-empty-lock)"
  local empty_lock="$empty_root/remotes/mmv/.local/lib/.codex-slot-install.lock"
  mkdir -p "$empty_lock"
  touch -t 200001010000 "$empty_lock"
  if CODEX_SLOT_INSTALL_LOCK_TTL_SECONDS=1 \
      run_install "$empty_root" --broker-host mmv >"$empty_root/out" 2>&1; then
    pass "远端空旧锁按 mtime TTL 回收"
  else
    fail "远端空旧锁按 mtime TTL 回收" "$(cat "$empty_root/out")"
  fi

  local live_root
  live_root="$(new_case remote-live-lock)"
  sleep 20 &
  local live_pid=$!
  write_lock_owner \
    "$live_root/remotes/mmv/.local/lib/.codex-slot-install.lock" \
    "$live_pid" "$host" 1 live-token
  local live_status=0
  CODEX_SLOT_INSTALL_LOCK_TTL_SECONDS=1 \
    run_install "$live_root" --broker-host mmv >"$live_root/out" 2>&1 ||
    live_status=$?
  /bin/kill "$live_pid" 2>/dev/null || true
  wait "$live_pid" 2>/dev/null || true
  if [[ "$live_status" -ne 0 ]]; then
    pass "远端同 host 活锁即使过期仍拒绝"
  else
    fail "远端同 host 活锁即使过期仍拒绝" "installer unexpectedly succeeded"
  fi

  local replaced_root
  replaced_root="$(new_case remote-replaced-lock)"
  seed_remote_pair \
    "$replaced_root" mmv codex-slot-broker.mjs codex-slot-store.mjs
  local replaced_status=0
  MOCK_REPLACE_REMOTE_LOCK_AT=1 \
    run_install "$replaced_root" --broker-host mmv >"$replaced_root/out" 2>&1 ||
    replaced_status=$?
  if [[ "$replaced_status" -ne 0 ]]; then
    pass "远端 owner 替换后安装失败"
  else
    fail "远端 owner 替换后安装失败" "installer unexpectedly succeeded"
  fi
  assert_remote_pair_restored \
    "远端替换锁失败" \
    "$replaced_root" mmv codex-slot-broker.mjs codex-slot-store.mjs
  local replaced_owner="$replaced_root/remotes/mmv/.local/lib/.codex-slot-install.lock/owner.json"
  assert_true "远端 cleanup 绝不误删替换锁" test -f "$replaced_owner"
  if [[ -f "$replaced_owner" ]]; then
    assert_contains "远端同 token 替换锁 owner 保持" '"host":"replacement-host"' \
      "$(cat "$replaced_owner")"
  fi
}

test_concurrent_client_never_leaves_partial_install() {
  local root
  root="$(new_case concurrent)"
  local home="$root/home with spaces"
  (
    MOCK_SHASUM_DELAY=0.1 run_install "$root" --client-only >"$root/one.out" 2>&1
  ) &
  local first_pid=$!
  (
    MOCK_SHASUM_DELAY=0.1 run_install "$root" --client-only >"$root/two.out" 2>&1
  ) &
  local second_pid=$!
  local first_status=0
  local second_status=0
  wait "$first_pid" || first_status=$?
  wait "$second_pid" || second_status=$?

  if [[ "$first_status" -eq 0 && "$second_status" -ne 0 ]] ||
      [[ "$first_status" -ne 0 && "$second_status" -eq 0 ]]; then
    pass "强制重叠安装恰有一个持锁者成功"
  else
    fail "强制重叠安装恰有一个持锁者成功" \
      "statuses were $first_status and $second_status"
  fi
  assert_true "并发后 client ESM 完整" \
    cmp -s "$REPO_ROOT/scripts/codex-slot-client.mjs" \
      "$home/.local/lib/codex-slot/codex-slot-client.mjs"
  assert_true "并发后 client 入口完整" \
    cmp -s "$REPO_ROOT/scripts/codex-slot" \
      "$home/.local/lib/codex-slot/codex-slot"
  assert_true "并发后无本地 staging 残留" \
    sh -c '! find "$1/.local/lib" -name "*.new.*" -print -quit | grep -q .' sh "$home"
  assert_true "并发后安装锁已由持有者清理" \
    test ! -e "$home/.local/lib/.codex-slot-install.lock"
}

test_argument_rejection_before_side_effects() {
  local cases=(
    ""
    "--client-only extra"
    "--client-only --all"
    "--broker-host"
    "--agent-host"
    "--broker-host bad;host"
    "--agent-host ../xian"
    "--unknown"
  )
  local index=0
  local item
  for item in "${cases[@]}"; do
    index=$((index + 1))
    local root
    root="$(new_case "reject-$index")"
    local -a args=()
    if [[ -n "$item" ]]; then
      read -r -a args <<<"$item"
    fi
    local status=0
    if [[ "${#args[@]}" -eq 0 ]]; then
      run_install "$root" >"$root/out" 2>&1 || status=$?
    else
      run_install "$root" "${args[@]}" >"$root/out" 2>&1 || status=$?
    fi
    if [[ "$status" -eq 0 ]]; then
      fail "非法参数拒绝: ${item:-<empty>}" "installer unexpectedly succeeded"
    else
      pass "非法参数拒绝: ${item:-<empty>}"
    fi
    assert_eq "非法参数无 SSH/SCP side effect #$index" "0" \
      "$(grep -Ec '^(ssh|scp)' "$root/commands.log" || true)"
  done
}

test_example_config_has_safe_defaults() {
  local config="$REPO_ROOT/config/codex-slot/hosts.example.json"
  if [[ ! -f "$config" ]]; then
    fail "hosts.example.json 存在" "file missing"
    return
  fi
  pass "hosts.example.json 存在"
  local parsed
  if ! parsed="$(node -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (value.broker !== "mmv") process.exit(2);
    if (JSON.stringify(value.hosts) !== JSON.stringify(["xian-m4", "xian-m1"])) process.exit(3);
    if (value.exitNode !== "mmv") process.exit(4);
    if (value.agentEnvironment?.CODEX_SLOT_EXIT_NODE !== "mmv") process.exit(5);
    process.stdout.write(JSON.stringify(value));
  ' "$config")"; then
    fail "hosts.example 默认 broker/hosts/exitNode 正确" "JSON contract failed"
    return
  fi
  pass "hosts.example 默认 broker/hosts/exitNode 正确"
  assert_not_contains "hosts.example 不含 token 字段" "token" \
    "$(printf '%s' "$parsed" | tr '[:upper:]' '[:lower:]')"
  assert_not_contains "hosts.example 不含 auth 字段" "auth" \
    "$(printf '%s' "$parsed" | tr '[:upper:]' '[:lower:]')"
}

test_xian_m4_config_uses_local_agent_and_explicit_broker_identity() {
  local config="$REPO_ROOT/config/codex-slot/xian-m4.example.json"
  if [[ ! -f "$config" ]]; then
    fail "xian-m4.example.json 存在" "file missing"
    return
  fi
  pass "xian-m4.example.json 存在"
  if node -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (value.broker !== "administrator@100.71.151.105") process.exit(2);
    if (JSON.stringify(value.hosts) !== JSON.stringify(["xian-m4"])) process.exit(3);
    if (value.localHost !== "xian-m4") process.exit(4);
    if (value.agentEnvironment?.CODEX_SLOT_EXIT_NODE !== "mmv") process.exit(5);
  ' "$config"; then
    pass "xian-m4 config 固定本地 agent 与美国 M4 broker"
  else
    fail "xian-m4 config 固定本地 agent 与美国 M4 broker" "JSON contract failed"
  fi
}

printf '\n[codex-slot-install.test] idempotent and role-isolated installer\n\n'

if [[ ! -f "$INSTALLER" ]]; then
  fail "scripts/install-codex-slot.sh 存在" "installer missing (expected RED before implementation)"
  printf '\nResult: %d PASS, %d FAIL\n' "$PASS" "$FAIL"
  exit 1
fi

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/codex-slot-install-test.XXXXXX")"

test_client_install_and_idempotency
test_client_install_preserves_shared_home_role_and_observer_files
test_installed_client_entry_runs_real_esm
test_client_final_transaction_failures_restore_everything
test_broker_install_preserves_client_in_same_home
test_path_component_detection
test_role_isolation_and_all_defaults
test_remote_zsh_executes_multi_file_transactions
test_remote_replacement_values_cannot_escape_final_command
test_sha_mismatch_and_transfer_failure_do_not_move
test_unique_staging_names
test_remote_second_file_failures_restore_content_and_mode
test_remote_signal_handlers_exit_once_and_stop_transaction
test_local_lock_owner_recovery_and_replacement_safety
test_remote_lock_owner_recovery_and_replacement_safety
test_concurrent_client_never_leaves_partial_install
test_argument_rejection_before_side_effects
test_example_config_has_safe_defaults
test_xian_m4_config_uses_local_agent_and_explicit_broker_identity

printf '\nResult: %d PASS, %d FAIL\n' "$PASS" "$FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
