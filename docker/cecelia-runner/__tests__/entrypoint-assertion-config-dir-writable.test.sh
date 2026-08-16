#!/usr/bin/env bash
# 回归（第 15 类死法，2026-08-16 生产 run a4fec681 attempt 8cc57feb）：
# 可信断言工作区被 chmod -R a-w 冻结后，vite 5 加载 ESM vitest 配置必须在配置文件旁写
# `vitest.config.js.timestamp-*.mjs` 临时文件（loadConfigFromBundledFile）→ EACCES →
# "failed to load config" → required assertion 必败。entrypoint 必须在冻结之后、跑断言之前，
# 只给断言所在包根目录（含 vitest 配置的那一层目录）补 a+w+t（sticky：能建临时文件，
# 不能删/改 root 拥有的受跟踪文件），其余树仍全部只读。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"
TEST_ROOT="$(mktemp -d)"
trap 'chmod -R u+w "$TEST_ROOT" 2>/dev/null || true; rm -rf "$TEST_ROOT"' EXIT

helper_block="$(sed -n '/^# assertion-config-dir-writable:start$/,/^# assertion-config-dir-writable:end$/p' "$ENTRYPOINT")"
[[ -n "$helper_block" ]] || { echo "missing grant_assertion_config_dir_write helper in entrypoint" >&2; exit 1; }
eval "$helper_block"

WS="$TEST_ROOT/ws"
mkdir -p "$WS/packages/app/src" "$WS/tests"
printf '{"name":"root"}\n' > "$WS/package.json"
printf 'export default {}\n' > "$WS/vitest.config.js"
printf '{"name":"app"}\n' > "$WS/packages/app/package.json"
printf 'export default {}\n' > "$WS/packages/app/vitest.config.js"
printf 'it()\n' > "$WS/packages/app/src/a.test.js"
printf 'it()\n' > "$WS/tests/root.test.js"
chmod -R a-w,go+rX "$WS"

# 1) 包内断言 → 只有 packages/app 目录拿到 o+w+t；其它目录仍不可写
grant_assertion_config_dir_write "$WS" "packages/app/src/a.test.js"
mode="$(stat -f "%Lp" "$WS/packages/app" 2>/dev/null || stat -c "%a" "$WS/packages/app")"
[[ "$mode" == 1777 || "$mode" == 777 || "$mode" == *7 ]] || { echo "package dir not writable+sticky: mode=$mode" >&2; exit 1; }
sticky="$(stat -f '%Sp' "$WS/packages/app" 2>/dev/null || stat -c '%A' "$WS/packages/app")"
[[ "$sticky" == *t || "$sticky" == *T ]] || { echo "package dir missing sticky bit: $sticky" >&2; exit 1; }
touch "$WS/packages/app/vitest.config.js.timestamp-1-abc.mjs" || { echo "cannot create vite temp config next to package config" >&2; exit 1; }
if touch "$WS/packages/app/src/new.js" 2>/dev/null; then echo "src dir became writable — grant leaked below package root" >&2; exit 1; fi
if touch "$WS/tests/new.js" 2>/dev/null; then echo "unrelated dir became writable" >&2; exit 1; fi
if ( : > "$WS/packages/app/package.json" ) 2>/dev/null; then echo "tracked file became writable" >&2; exit 1; fi

# 2) 根级断言（无更近的 package.json）→ 工作区根目录拿到 o+w+t
grant_assertion_config_dir_write "$WS" "tests/root.test.js"
touch "$WS/vitest.config.js.timestamp-2-def.mjs" || { echo "cannot create vite temp config at workspace root" >&2; exit 1; }

# 3) 越界路径必须拒绝
if grant_assertion_config_dir_write "$WS" "../etc/passwd" 2>/dev/null; then echo "helper accepted an escaping path" >&2; exit 1; fi

echo "entrypoint-assertion-config-dir-writable: PASS"
