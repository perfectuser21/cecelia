#!/usr/bin/env bash
# Cecelia 内部写接口的共享 token 合同。
# token 只存于 gitignored env 文件；本 helper 从不打印 token。

_cecelia_internal_token_from_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 1

  local count=0 value="" line
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      CECELIA_INTERNAL_TOKEN=*)
        count=$((count + 1))
        value=${line#CECELIA_INTERNAL_TOKEN=}
        ;;
    esac
  done < "$env_file"
  [[ "$count" -eq 1 ]] || return 1
  [[ "$value" =~ ^[A-Za-z0-9_-]{32,128}$ ]] || return 1
  printf '%s' "$value"
}

load_cecelia_internal_token() {
  local env_file="$1"
  local value
  value=$(_cecelia_internal_token_from_file "$env_file") || return 1
  CECELIA_INTERNAL_TOKEN="$value"
  export CECELIA_INTERNAL_TOKEN
}

ensure_cecelia_internal_token() {
  local env_file="$1"
  local existing=""

  if existing=$(_cecelia_internal_token_from_file "$env_file"); then
    local current_mode
    current_mode=$(stat -f '%Lp' "$env_file" 2>/dev/null || stat -c '%a' "$env_file" 2>/dev/null || true)
    [[ "$current_mode" == "600" ]] || chmod 600 "$env_file"
    CECELIA_INTERNAL_TOKEN="$existing"
    export CECELIA_INTERNAL_TOKEN
    return 0
  fi

  if [[ ! -e "$env_file" ]]; then
    umask 077
    : > "$env_file" || {
      echo "ERROR: 无法创建内部鉴权 env 文件: $env_file" >&2
      return 1
    }
  elif [[ ! -f "$env_file" ]]; then
    echo "ERROR: 内部鉴权 env 路径不是普通文件: $env_file" >&2
    return 1
  fi
  if grep -q '^CECELIA_INTERNAL_TOKEN=[^[:space:]]' "$env_file" 2>/dev/null; then
    echo "ERROR: CECELIA_INTERNAL_TOKEN 格式非法，拒绝覆盖现有凭据" >&2
    return 1
  fi
  command -v openssl >/dev/null 2>&1 || {
    echo "ERROR: 缺少 openssl，无法生成内部鉴权 token" >&2
    return 1
  }

  local generated tmp_file
  generated=$(openssl rand -hex 32) || return 1
  [[ "$generated" =~ ^[0-9a-f]{64}$ ]] || return 1
  umask 077
  tmp_file=$(mktemp "${env_file}.internal-auth.XXXXXX") || return 1
  if ! awk -v token="$generated" '
    BEGIN { written = 0 }
    /^CECELIA_INTERNAL_TOKEN=/ {
      if (!written) print "CECELIA_INTERNAL_TOKEN=" token
      written = 1
      next
    }
    { print }
    END { if (!written) print "CECELIA_INTERNAL_TOKEN=" token }
  ' "$env_file" > "$tmp_file"; then
    rm -f "$tmp_file"
    return 1
  fi
  chmod 600 "$tmp_file"
  mv "$tmp_file" "$env_file"
  CECELIA_INTERNAL_TOKEN="$generated"
  export CECELIA_INTERNAL_TOKEN
}
