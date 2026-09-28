#!/usr/bin/env bash
# openclaw_process_guard.test.sh — MMV OpenClaw 进程守卫
#
# 背景（2026-09-22 实测）：MCP 运行时不回收，网关重启后 18 小时堆了 474 个进程、
# 9.43GB，wired 7.4GB、swap 8.0G/9.2G，系统开始因内存压力杀后台任务。
# 根因是 `mcp.sessionIdleTtlMs` 未设 —— OpenClaw schema 原文
# 「Unset or 0 keeps runtimes alive until Gateway shutdown」。
# 设成 900000 后 90 秒回收 408 进程 / 6.8GB。
#
# 本守卫盯四件事，顺序即优先级：
#   ① 配置漂移：那条 TTL 被改回未设/0 → 泄漏静默复发。**这是根治项，排第一**
#   ② 孤儿回收：所属网关已不在的进程链才收（网关都没了，不可能在用）
#   ③ 阈值告警：链上进程数越线出声（健康工作集实测 ~68，泄漏态 474）
#   ④ **绝不碰活网关的子进程** —— janitor 的教训：它把活着的网关当孤儿杀，
#      导致迁移后 18 条业务 cron 成功率 0（PR #5447/#5448 案卷）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GUARD="$ROOT/scripts/ops/openclaw-process-guard.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ✅ %s\n' "${1}"; }
bad()  { FAIL=$((FAIL+1)); printf '  ❌ %s\n' "${1}"; }
# 断言辅助：全角括号是多字节，裸写进变量名后面会被 set -u 吞掉首字节（0921 踩过）
assert_contains() {
  local haystack="${1}" needle="${2}" desc="${3}"
  if printf '%s' "${haystack}" | grep -qF -- "${needle}"; then ok "${desc}"
  else bad "${desc} — 输出里找不到 '${needle}'"; fi
}
assert_not_contains() {
  local haystack="${1}" needle="${2}" desc="${3}"
  if printf '%s' "${haystack}" | grep -qF -- "${needle}"; then bad "${desc} — 不该出现 '${needle}' 却出现了"
  else ok "${desc}"; fi
}

WORK="$(mktemp -d)"
trap 'chmod -R u+w "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT

# ── 测试替身 ─────────────────────────────────────────────────────────────
# 进程清单注入：每行 "pid ppid 命令"，模拟 ps 输出
# 配置注入：TTL 的值
# 杀进程注入：把被杀的 pid 记到文件里，而不是真杀
mk_env() {
  : > "$WORK/killed.txt"
  export OPG_PS_SNAPSHOT="$WORK/ps.txt"
  export OPG_KILL_LOG="$WORK/killed.txt"
  export OPG_STATE_DIR="$WORK"
  export OPG_DRY_RUN=0
  # ⑤ 默认隔离：不许碰真实 ~/.openclaw/tmp、不许让真实磁盘水位左右别的用例
  mkdir -p "$WORK/nocap"
  export OPG_CAPTURE_ROOT="$WORK/nocap" OPG_INUSE_PATHS=/dev/null OPG_DISK_AVAIL_GB=50
}

echo "▶️  openclaw-process-guard 守卫测试"

# ── ① 配置漂移闸（根治项）─────────────────────────────────────────────
mk_env
cat > "$WORK/ps.txt" <<'PS'
27020 1 /opt/homebrew/opt/node/bin/node openclaw/dist/index.js gateway --port 18789
PS
OUT=$(OPG_TTL_VALUE="" bash "$GUARD" 2>&1); RC=$?
assert_contains "$OUT" "sessionIdleTtlMs" "TTL 未设 → 报出配置漂移"
[ "$RC" -ne 0 ] && ok "TTL 未设 → 退出码非 0" || bad "TTL 未设却退出码 0（守卫等于没有）"

OUT=$(OPG_TTL_VALUE="0" bash "$GUARD" 2>&1); RC=$?
assert_contains "$OUT" "sessionIdleTtlMs" "TTL=0 与未设同义 → 同样报漂移"
[ "$RC" -ne 0 ] && ok "TTL=0 → 退出码非 0" || bad "TTL=0 却判通过（0 的语义就是永不回收）"

OUT=$(OPG_TTL_VALUE="900000" bash "$GUARD" 2>&1); RC=$?
assert_not_contains "$OUT" "配置漂移" "TTL 已设 → 不报漂移"

# ── ② 只收孤儿 ───────────────────────────────────────────────────────
# 网关 27020 活着，它的子链不许碰；另一条链的爹 99999 不在清单里 = 孤儿
mk_env
cat > "$WORK/ps.txt" <<'PS'
27020 1 /opt/homebrew/opt/node/bin/node openclaw/dist/index.js gateway --port 18789
30001 27020 node openclaw/dist/process/supervisor/service-child-group-anchor
30002 30001 node openclaw/dist/process/supervisor/service-child-relay.js
30003 30002 npm exec @notionhq/notion-mcp-server
40001 99999 node openclaw/dist/process/supervisor/service-child-group-anchor
40002 40001 node openclaw/dist/process/supervisor/service-child-relay.js
PS
OUT=$(OPG_TTL_VALUE="900000" bash "$GUARD" 2>&1)
KILLED="$(cat "$WORK/killed.txt")"
assert_contains "$KILLED" "40001" "孤儿链（爹已不在）被回收"
assert_not_contains "$KILLED" "30001" "活网关的子进程不许碰（janitor 教训）"
assert_not_contains "$KILLED" "30002" "活网关的孙进程同样不许碰"
assert_not_contains "$KILLED" "27020" "**绝不能杀网关本体**"

# ── ②b 爹是活的非网关进程（codex 会话）→ 绝不能当孤儿收 ────────────────
# 2026-09-22 真实数据打脸：守卫第一版把 24 个 MCP 判成孤儿要杀，
# 而它们的爹是 pid 70740 —— 活着的 codex app-server。
# MCP 运行时完全可以合法挂在 codex/npm 等**非网关**的活进程底下。
# 原判据写成了「祖先里必须有网关，否则算孤儿」，等于把整类合法拓扑判死 ——
# 与 janitor 把活网关当孤儿杀是同一个错，只是换了件衣服。
#
# 正确判据只有一条：**爹是不是真没了**（不在进程表 / 被 launchd 收养）。
# 爹活着就不关我事，不管那个爹是谁。
mk_env
cat > "$WORK/ps.txt" <<'PS'
27020 1 /opt/homebrew/opt/node/bin/node openclaw/dist/index.js gateway --port 18789
70740 70738 /opt/homebrew/lib/node_modules/@openai/codex/bin/codex app-server --listen stdio://
21413 70740 npm exec @notionhq/notion-mcp-server
65765 21413 node /Users/administrator/.npm/_npx/x/node_modules/.bin/notion-mcp-server
PS
OUT=$(OPG_TTL_VALUE="900000" bash "$GUARD" 2>&1)
KILLED="$(cat "$WORK/killed.txt")"
assert_not_contains "$KILLED" "21413" "爹是活 codex 的 MCP 不许当孤儿杀（真实拓扑回归）"
assert_not_contains "$KILLED" "65765" "它底下的 mcp-server 同样不许杀"

# ── ②c 爹真没了才算孤儿 ──────────────────────────────────────────────
mk_env
cat > "$WORK/ps.txt" <<'PS'
27020 1 /opt/homebrew/opt/node/bin/node openclaw/dist/index.js gateway --port 18789
70740 70738 /opt/homebrew/lib/node_modules/@openai/codex/bin/codex app-server --listen stdio://
80001 1 npm exec @notionhq/notion-mcp-server
80002 77777 node /Users/administrator/.npm/_npx/x/node_modules/.bin/notion-mcp-server
PS
OUT=$(OPG_TTL_VALUE="900000" bash "$GUARD" 2>&1)
KILLED="$(cat "$WORK/killed.txt")"
assert_contains "$KILLED" "80001" "被 launchd 收养（ppid=1）→ 真孤儿，收"
assert_contains "$KILLED" "80002" "爹 77777 不在进程表 → 真孤儿，收"
assert_not_contains "$KILLED" "70740" "codex 本体不是链成员，碰都不该碰"

# ── ③ 阈值告警 ───────────────────────────────────────────────────────
mk_env
{
  echo "27020 1 /opt/homebrew/opt/node/bin/node openclaw/dist/index.js gateway --port 18789"
  for i in $(seq 1 250); do
    echo "$((50000+i)) 27020 node openclaw/dist/process/supervisor/service-child-relay.js"
  done
} > "$WORK/ps.txt"
OUT=$(OPG_TTL_VALUE="900000" OPG_CHAIN_WARN_THRESHOLD=200 bash "$GUARD" 2>&1); RC=$?
assert_contains "$OUT" "250" "链上进程数越线 → 报出真实数量"
[ "$RC" -ne 0 ] && ok "越线 → 退出码非 0（能被 launchd/监控看见）" || bad "越线却退出码 0"
# 越线也不许乱杀活网关的子进程
assert_not_contains "$(cat "$WORK/killed.txt")" "50001" "越线告警不等于授权杀活进程"

mk_env
{
  echo "27020 1 /opt/homebrew/opt/node/bin/node openclaw/dist/index.js gateway --port 18789"
  for i in $(seq 1 60); do
    echo "$((50000+i)) 27020 node openclaw/dist/process/supervisor/service-child-relay.js"
  done
} > "$WORK/ps.txt"
OUT=$(OPG_TTL_VALUE="900000" OPG_CHAIN_WARN_THRESHOLD=200 bash "$GUARD" 2>&1); RC=$?
[ "$RC" -eq 0 ] && ok "健康工作集（60 < 200）→ 通过" || bad "健康状态被误判（实测工作集约 68）"

# ── ④ 网关不在时不得误判成"全是孤儿"把整片收掉 ──────────────────────
# 网关没起来（清单里没有 gateway 行）时，子进程的爹确实不在，但这时该出声、
# 不该闷头收割 —— 网关可能正在重启中，收割会把刚起的链一起带走。
mk_env
cat > "$WORK/ps.txt" <<'PS'
30001 1 node openclaw/dist/process/supervisor/service-child-group-anchor
30002 30001 node openclaw/dist/process/supervisor/service-child-relay.js
PS
OUT=$(OPG_TTL_VALUE="900000" bash "$GUARD" 2>&1); RC=$?
assert_contains "$OUT" "网关" "网关不在 → 出声说明"
[ "$RC" -ne 0 ] && ok "网关不在 → 退出码非 0" || bad "网关不在却报一切正常"
# 光「出声 + 退出码非 0」不够：变异测试证明把提前退出删掉，这两条断言照样全绿，
# 而行为已经变成「照样收割」。真正的要求是**一个都不收**，必须直接断言这一条。
KILLED="$(cat "$WORK/killed.txt")"
[ -z "$KILLED" ] && ok "网关不在 → 一个都不收（网关可能正在重启）" \
                 || bad "网关不在却收割了：$KILLED —— 会把刚起来的链一起带走"

# ── ⑤ 孤儿插件捕获目录回收 + 磁盘水位闸 ─────────────────────────────
# 2026-09-28 22:59 事故：网关每代模型目录都把 codex 插件（~294MB，含 codex 二进制）
# 拷进 ~/.openclaw/tmp/openclaw-model-catalog-* / openclaw-plugin-build-*。
# 旧网关实例被杀后这些 legacy 根目录无人认领（新版运行时不回收，doctor --fix 还要求先停网关），
# 5 天攒到 14GB 把盘写满 → codex 插件加载 ENOSPC → 网关运行时异常退出。
mk_env
CAP="$WORK/octmp"; mkdir -p "$CAP"
mkdir -p "$CAP/openclaw-model-catalog-OLD1/openclaw-plugin-build-x" "$CAP/openclaw-plugin-build-OLD2" \
         "$CAP/openclaw-plugin-build-BUSY" "$CAP/openclaw-model-catalog-FRESH" "$CAP/plugin-captures/uuid-1" \
         "$CAP/agent-cli"
chmod 555 "$CAP/openclaw-model-catalog-OLD1/openclaw-plugin-build-x"   # 模拟包里的只读目录
touch -t 202609230000 "$CAP/openclaw-model-catalog-OLD1" "$CAP/openclaw-plugin-build-OLD2" \
      "$CAP/openclaw-plugin-build-BUSY" "$CAP/plugin-captures" "$CAP/agent-cli"
echo "$CAP/openclaw-plugin-build-BUSY/package-2/node_modules/x.node" > "$WORK/inuse.txt"
cat > "$WORK/ps.txt" <<'PS'
27020 1 /opt/homebrew/opt/node/bin/node openclaw/dist/index.js gateway --port 18789
PS
OUT=$(OPG_TTL_VALUE="900000" OPG_CAPTURE_ROOT="$CAP" OPG_INUSE_PATHS="$WORK/inuse.txt" \
      OPG_DISK_AVAIL_GB=50 bash "$GUARD" 2>&1); RC=$?
[ ! -e "$CAP/openclaw-model-catalog-OLD1" ] && ok "超龄无主的 model-catalog 根目录被回收（含只读子目录）" \
                                            || bad "超龄无主的 model-catalog 根目录没被回收 —— 盘会再被写满"
[ ! -e "$CAP/openclaw-plugin-build-OLD2" ] && ok "超龄无主的 plugin-build 根目录被回收" \
                                           || bad "超龄无主的 plugin-build 根目录没被回收"
[ -e "$CAP/openclaw-plugin-build-BUSY" ] && ok "仍有进程打开其中文件的目录不许删" \
                                         || bad "删了进程正在用的捕获目录 —— 会把在跑的插件拉崩"
[ -e "$CAP/openclaw-model-catalog-FRESH" ] && ok "未超龄的目录不许删（可能是刚起的网关正在写）" \
                                           || bad "删了刚创建的捕获目录"
[ -e "$CAP/plugin-captures/uuid-1" ] && ok "新版带令牌的 plugin-captures 归网关自己管，不碰" \
                                     || bad "越权删了新版 plugin-captures"
[ -e "$CAP/agent-cli" ] && ok "非捕获目录不碰" || bad "误删了非捕获目录 agent-cli"
assert_contains "$OUT" "回收孤儿捕获目录 2 个" "回收数量写进日志"
[ "$RC" -eq 0 ] && ok "回收成功 + 水位正常 → 通过" || bad "回收成功却退出码非 0"

# 磁盘水位闸：可用 < 10GB 必须出声（22:59 那次 ENOSPC 前毫无告警）
mk_env
cat > "$WORK/ps.txt" <<'PS'
27020 1 /opt/homebrew/opt/node/bin/node openclaw/dist/index.js gateway --port 18789
PS
mkdir -p "$WORK/emptycap"
OUT=$(OPG_TTL_VALUE="900000" OPG_CAPTURE_ROOT="$WORK/emptycap" OPG_INUSE_PATHS=/dev/null \
      OPG_DISK_AVAIL_GB=6 bash "$GUARD" 2>&1); RC=$?
assert_contains "$OUT" "磁盘可用 6GB" "磁盘低水位 → 报出真实可用量"
[ "$RC" -ne 0 ] && ok "磁盘低水位 → 退出码非 0" || bad "磁盘只剩 6GB 却判通过（22:59 就是这么死的）"

# 网关不在（多半正是被写满的盘拖死）时也要回收 —— 否则它永远起不来
mk_env
: > "$WORK/ps.txt"
mkdir -p "$WORK/cap2/openclaw-plugin-build-DEAD"; touch -t 202609230000 "$WORK/cap2/openclaw-plugin-build-DEAD"
OUT=$(OPG_TTL_VALUE="900000" OPG_CAPTURE_ROOT="$WORK/cap2" OPG_INUSE_PATHS=/dev/null \
      OPG_DISK_AVAIL_GB=50 bash "$GUARD" 2>&1)
[ ! -e "$WORK/cap2/openclaw-plugin-build-DEAD" ] && ok "网关不在时照样回收无主捕获目录（腾盘让它能起来）" \
                                                 || bad "网关被写满的盘拖死后守卫不腾盘 —— 死循环"

printf '\n结果: PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
