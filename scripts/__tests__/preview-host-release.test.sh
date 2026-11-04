#!/usr/bin/env bash
# preview-host-release.test.sh — 预览主机发布脚本自测（任务 6f937566 ①）
#
# 背景：MMV 上 preview-agent（launchd plist）与 preview-reaper（crontab）一直钉在
# cecelia-preview-releases/fleet-65ab15f4d6（9c5663d39，10-02 手工建的快照），之后 main 上的
# 预览修复（#6155 闲置回收、#6320 台账库）一个都没上到预览主机。没有可重复的发布流程。
#
# 全程不碰真实环境：git 用临时仓库，launchctl/crontab/npm 用 mock，"代理"是一个本地假 HTTP
# 服务（按 plist 的 WorkingDirectory 回报 .release-sha，按凭据文件校验 Bearer）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE="${SRC_SCRIPTS}/preview-host-release.sh"
PASS=0; FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }
SECRET="tok_$(printf 'd%.0s' $(seq 1 60))"
SERVER_PID=""

setup() {
  TMP=$(mktemp -d)
  export HOME="$TMP/home"; mkdir -p "$HOME"
  BIN="$TMP/bin"; mkdir -p "$BIN"
  export PREVIEW_RELEASES_DIR="$TMP/releases"
  export PREVIEW_BASE_DIR="$TMP/previews"
  export PREVIEW_AGENT_PLIST="$TMP/LaunchAgents/com.cecelia.preview-agent.plist"
  export DEPLOY_TOKEN_FILE="$TMP/cred/cecelia-deploy-token.env"
  export PREVIEW_RELEASE_VERIFY_TIMEOUT=8
  export PREVIEW_RELEASE_POLL_INTERVAL=1
  unset DEPLOY_TOKEN || true
  mkdir -p "$TMP/cred" "$PREVIEW_RELEASES_DIR" "$PREVIEW_BASE_DIR" "$(dirname "$PREVIEW_AGENT_PLIST")"
  printf 'DEPLOY_TOKEN=%s\n' "$SECRET" > "$DEPLOY_TOKEN_FILE"; chmod 600 "$DEPLOY_TOKEN_FILE"

  # 源仓库：origin（bare）+ 本地 clone，main 上有发布需要的脚本
  git init -q --bare "$TMP/origin.git"
  git init -q -b main "$TMP/seed"
  mkdir -p "$TMP/seed/scripts/preview-agent" "$TMP/seed/scripts/lib" "$TMP/seed/packages/brain"
  for f in preview-agent-install.sh preview-agent.mjs preview-reaper.sh preview-agent/deploy-token.mjs lib/launchd-reload.sh lib/preview-agent-owner.sh; do
    [ -f "$SRC_SCRIPTS/$f" ] && cp "$SRC_SCRIPTS/$f" "$TMP/seed/scripts/$f"
  done
  echo '{"name":"seed","private":true}' > "$TMP/seed/package.json"
  echo '{"lockfileVersion":3}' > "$TMP/seed/package-lock.json"
  git -C "$TMP/seed" -c user.email=t@t -c user.name=t add -A
  git -C "$TMP/seed" -c user.email=t@t -c user.name=t commit -qm seed
  git -C "$TMP/seed" remote add origin "$TMP/origin.git"
  git -C "$TMP/seed" push -q origin main
  git clone -q "$TMP/origin.git" "$TMP/src"
  export PREVIEW_RELEASE_SOURCE_REPO="$TMP/src"
  TARGET_SHA=$(git -C "$TMP/origin.git" rev-parse main)

  # 旧发布目录 + 旧 plist（含明文令牌键，复刻 MMV 现场）+ 旧 crontab
  OLD="$PREVIEW_RELEASES_DIR/fleet-old"
  mkdir -p "$OLD/scripts"
  export TEST_ORPHAN_ROOT="$OLD"
  printf '%040d\n' 1 > "$OLD/.release-sha"
  cat > "$PREVIEW_AGENT_PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>DEPLOY_TOKEN</key>
		<string>${SECRET}</string>
		<key>REPO_ROOT</key>
		<string>${OLD}</string>
	</dict>
	<key>Label</key>
	<string>com.cecelia.preview-agent</string>
	<key>ProgramArguments</key><array><string>$(node -p 'process.execPath')</string><string>${OLD}/scripts/preview-agent.mjs</string></array>
	<key>WorkingDirectory</key>
	<string>${OLD}</string>
</dict>
</plist>
PL
  cp "$PREVIEW_AGENT_PLIST" "$TMP/plist.orig"
  cat > "$TMP/crontab.txt" <<CR
0 * * * * echo unrelated-job
# Preview 环境对账回收 - 每小时
20 * * * * cd ${OLD} && REPO_ROOT=${OLD} bash scripts/preview-reaper.sh >> /tmp/preview-reaper-cron.log 2>&1
CR
  cp "$TMP/crontab.txt" "$TMP/crontab.orig"

  # mock：crontab（文件后端）
  cat > "$BIN/crontab" <<SH
#!/bin/bash
if [ "\$1" = "-l" ]; then
  if [ -e "$TMP/cron-read-denied" ]; then echo "Operation not permitted" >&2; exit 1; fi
  if [ -e "$TMP/cron-read-io" ]; then echo "Input/output error" >&2; exit 1; fi
  if [ -f "$TMP/crontab.txt" ]; then cat "$TMP/crontab.txt"; exit 0; fi
  echo "crontab: no crontab for \$(id -un)" >&2; exit 1
fi
if [ -e "$TMP/cron-reject-writes" ]; then echo "crontab-denied" >> "$TMP/calls.log"; echo "Operation not permitted" >&2; exit 1; fi
if [ "\$1" = "-" ]; then cat > "$TMP/crontab.txt"; else cp "\$1" "$TMP/crontab.txt"; fi
echo "crontab-write" >> "$TMP/calls.log"
SH
  # mock：launchctl（有状态，复刻真实 launchd 的异步卸载）
  #   bootout 立即返回，但之后 print 仍能看到服务 $LC_GHOST_PRINTS 次（"卸载中"）；
  #   服务仍在（已装载或卸载中）时 bootstrap 返回 5: Input/output error；
  #   $LC_FAIL_FIRST_BOOTSTRAP 存在时第一次 bootstrap 无条件返回 5。
  #   bootstrap/kickstart 成功时按 plist 的 WorkingDirectory 生成磁盘样本，模拟代理起来后采样
  LC_STATE="$TMP/launchd"; mkdir -p "$LC_STATE"; touch "$LC_STATE/loaded"   # 发布前旧代理在跑
  export LC_GHOST_PRINTS=0
  export LC_FAIL_FIRST_BOOTSTRAP="$TMP/lc-fail-first-bootstrap"
  export PREVIEW_LAUNCHD_POLL_INTERVAL=0.05
  export PREVIEW_LAUNCHD_RETRY_SLEEP=0.05
  cat > "$BIN/launchctl" <<SH
#!/bin/bash
echo "launchctl \$*" >> "$TMP/calls.log"
S="$LC_STATE"
ghost=\$(cat "\$S/ghost" 2>/dev/null || echo 0)
wd=\$(awk '/<key>WorkingDirectory<\/key>/{f=1} f&&/<string>/{gsub(/.*<string>|<\/string>.*/,"");print;exit}' "$PREVIEW_AGENT_PLIST")
case "\$1" in
  bootout)
    if [ -e "\$S/loaded" ]; then rm -f "\$S/loaded"; echo "\${LC_GHOST_PRINTS:-0}" > "\$S/ghost"; exit 0; fi
    echo "Boot-out failed: 3: No such process" >&2; exit 3 ;;
  print)
    [ -e "\$S/loaded" ] && { if [ -e "$TMP/bad-owner" ] || { [ -e "$TMP/bad-owner-after" ] && [[ "\$wd" == */rel-* ]]; }; then echo "pid = 9999"; else echo "pid = 4242"; fi; exit 0; }
    if [ "\$ghost" -gt 0 ]; then echo \$((ghost - 1)) > "\$S/ghost"; exit 0; fi
    echo "Could not find service" >&2; exit 113 ;;
  bootstrap)
    if [ -e "\$LC_FAIL_FIRST_BOOTSTRAP" ] && [ ! -e "\$S/failed-once" ]; then touch "\$S/failed-once"; echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; fi
    if [ -e "\$S/loaded" ] || [ "\$ghost" -gt 0 ]; then echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; fi
    touch "\$S/loaded"; mkdir -p "\$wd/.runtime" && touch "\$wd/.runtime/host-disk.json"; exit 0 ;;
  kickstart)
    [ -e "\$S/loaded" ] || { echo "Could not find service" >&2; exit 113; }
    mkdir -p "\$wd/.runtime" && touch "\$wd/.runtime/host-disk.json"; exit 0 ;;
esac
exit 0
SH
  # 原生归属探针替身：PID/端口/目录/命令分别可反例注入。
  cat > "$BIN/lsof" <<SH
#!/bin/bash
wd=\$(awk '/<key>WorkingDirectory<\/key>/{f=1} f&&/<string>/{gsub(/.*<string>|<\/string>.*/,"");print;exit}' "$PREVIEW_AGENT_PLIST")
if [[ " \$* " == *" -d cwd "* ]]; then
  if [ -e "$TMP/bad-cwd" ]; then echo n/other/release; else echo "n\$wd"; fi
else echo 4242; fi
SH
  cat > "$BIN/ps" <<SH
#!/bin/bash
wd=\$(awk '/<key>WorkingDirectory<\/key>/{f=1} f&&/<string>/{gsub(/.*<string>|<\/string>.*/,"");print;exit}' "$PREVIEW_AGENT_PLIST")
echo "node \$wd/scripts/preview-agent.mjs"
SH
  printf '#!/bin/bash\ncat >/dev/null\nexit 0\n' > "$BIN/python3"
  # mock：npm（只建目录、记账）
  cat > "$BIN/npm" <<SH
#!/bin/bash
echo "npm \$* @ \$PWD" >> "$TMP/calls.log"
mkdir -p node_modules packages/brain/node_modules
SH
  chmod +x "$BIN"/*
  export PATH="$BIN:$PATH"

  # 假代理：health 回报 plist 当前 WorkingDirectory 的 .release-sha；stop/0 校验 Bearer
  cat > "$TMP/fake-agent.mjs" <<'JS'
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
const plist = process.env.PREVIEW_AGENT_PLIST;
const token = readFileSync(process.env.DEPLOY_TOKEN_FILE, 'utf8').match(/DEPLOY_TOKEN=(.*)/)[1].trim();
const wd = () => { try { return (readFileSync(plist, 'utf8').match(/<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/) || [])[1]; } catch { return process.env.TEST_ORPHAN_ROOT; } };
const srv = http.createServer((req, res) => {
  if (req.url === '/api/brain/health') {
    let sha = null;
    try { sha = readFileSync(`${wd()}/.release-sha`, 'utf8').trim(); } catch {}
    if (existsSync(process.env.FORCE_BAD_SHA_FILE)) sha = 'f'.repeat(40);
    res.end(JSON.stringify({ status: 'healthy', role: 'preview-agent', git_sha: sha }));
  } else if (req.method === 'POST' && req.url === '/api/brain/preview/stop/0') {
    const ok = (req.headers.authorization || '') === `Bearer ${token}`;
    res.statusCode = ok ? 200 : 401;
    res.end(ok ? '{"stopped":true,"note":"no active preview found"}' : '{"error":"Unauthorized"}');
  } else { res.statusCode = 404; res.end('{}'); }
});
srv.listen(0, '127.0.0.1', () => { process.stdout.write(String(srv.address().port) + '\n'); });
JS
  export FORCE_BAD_SHA_FILE="$TMP/force-bad-sha"
  node "$TMP/fake-agent.mjs" > "$TMP/port" 2>/dev/null &
  SERVER_PID=$!
  for _ in $(seq 1 50); do [ -s "$TMP/port" ] && break; sleep 0.1; done
  export PREVIEW_AGENT_URL="http://127.0.0.1:$(cat "$TMP/port")"
}

teardown() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true; SERVER_PID=""; rm -rf "$TMP"; }
trap 'teardown' EXIT

reaper_lines() { grep -c 'scripts/preview-reaper.sh' "$TMP/crontab.txt" || true; }

# ── T1 默认 dry-run：只打印计划，什么都不改 ─────────────────────────────────
echo "── T1 默认 dry-run 零副作用 ──"
setup
set +e; OUT=$(bash "$RELEASE" 2>&1); RC=$?; set -e
[ "$RC" = 0 ] && pass "dry-run 退出 0" || fail "dry-run 退出 0" "rc=$RC out=$OUT"
echo "$OUT" | grep -q "$TARGET_SHA" && pass "计划含目标 sha" || fail "计划含目标 sha" "$OUT"
echo "$OUT" | grep -q "DB_NAME=cecelia_staging" && pass "计划含新 reaper 行（带 DB_NAME）" || fail "计划含新 reaper 行" "$OUT"
cmp -s "$TMP/crontab.txt" "$TMP/crontab.orig" && pass "crontab 未改" || fail "crontab 未改" "$(cat "$TMP/crontab.txt")"
cmp -s "$PREVIEW_AGENT_PLIST" "$TMP/plist.orig" && pass "plist 未改" || fail "plist 未改" ""
[ ! -e "$TMP/calls.log" ] && pass "未调用 launchctl/crontab 写/npm" || fail "未调用 launchctl/crontab 写/npm" "$(cat "$TMP/calls.log")"
[ "$(find "$PREVIEW_RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" = 1 ] && pass "未新建发布目录" || fail "未新建发布目录" "$(ls "$PREVIEW_RELEASES_DIR")"
echo "$OUT" | grep -qF "$SECRET" && fail "输出不含令牌" "泄露" || pass "输出不含令牌"
teardown

# ── T2 --apply 成功：新目录 + plist 无令牌 + crontab 只换 reaper 行 + 验活通过 ──────
echo "── T2 --apply 成功路径 ──"
setup
set +e; OUT=$(bash "$RELEASE" --apply 2>&1); RC=$?; set -e
NEW="$PREVIEW_RELEASES_DIR/rel-${TARGET_SHA:0:12}"
[ "$RC" = 0 ] && pass "--apply 退出 0" || fail "--apply 退出 0" "rc=$RC out=$OUT"
[ "$(cat "$NEW/.release-sha" 2>/dev/null)" = "$TARGET_SHA" ] && pass "新目录写入 .release-sha" || fail "新目录写入 .release-sha" "$(ls -a "$NEW" 2>&1)"
[ "$(git -C "$NEW" rev-parse HEAD 2>/dev/null)" = "$TARGET_SHA" ] && pass "新目录检出目标 sha" || fail "新目录检出目标 sha" ""
[ "$(git -C "$NEW" remote get-url origin 2>/dev/null)" = "$TMP/origin.git" ] && pass "新目录 origin 指向源仓库的 origin" || fail "origin 指向" "$(git -C "$NEW" remote get-url origin 2>&1)"
grep -q "npm ci" "$TMP/calls.log" && pass "装了依赖（npm ci）" || fail "装了依赖" "$(cat "$TMP/calls.log")"
if grep -q '<key>DEPLOY_TOKEN</key>' "$PREVIEW_AGENT_PLIST" || grep -qF "$SECRET" "$PREVIEW_AGENT_PLIST"; then fail "plist 不再含令牌" "仍有"; else pass "plist 不再含令牌"; fi
grep -qF "<string>${NEW}</string>" "$PREVIEW_AGENT_PLIST" && pass "plist 指向新目录" || fail "plist 指向新目录" "$(cat "$PREVIEW_AGENT_PLIST")"
[ "$(reaper_lines)" = 1 ] && pass "crontab 只有一条 reaper 行" || fail "crontab 只有一条 reaper 行" "$(cat "$TMP/crontab.txt")"
grep 'scripts/preview-reaper.sh' "$TMP/crontab.txt" | grep -qF "cd ${NEW} " && pass "reaper 行指向新目录" || fail "reaper 行指向新目录" "$(cat "$TMP/crontab.txt")"
grep 'scripts/preview-reaper.sh' "$TMP/crontab.txt" | grep -q "DB_NAME=cecelia_staging" && pass "reaper 行带 DB_NAME=cecelia_staging" || fail "reaper 行带 DB_NAME" "$(cat "$TMP/crontab.txt")"
grep -q "unrelated-job" "$TMP/crontab.txt" && pass "无关 crontab 行保留" || fail "无关 crontab 行保留" "$(cat "$TMP/crontab.txt")"
grep -q "launchctl bootstrap" "$TMP/calls.log" && pass "重新 bootstrap 代理" || fail "重新 bootstrap 代理" "$(cat "$TMP/calls.log")"
[ "$(cat "$PREVIEW_RELEASES_DIR/.current" 2>/dev/null)" = "$NEW" ] && pass "记录当前发布" || fail "记录当前发布" ""
[ -d "$OLD" ] && pass "上一版目录保留（回滚用）" || fail "上一版目录保留" ""
echo "$OUT" | grep -qF "$SECRET" && fail "输出不含令牌" "泄露" || pass "输出不含令牌"
ls "$PREVIEW_RELEASES_DIR"/.backup-*/ >/dev/null 2>&1 && pass "备份了旧 plist/crontab" || fail "备份了旧 plist/crontab" "$(ls -a "$PREVIEW_RELEASES_DIR")"
teardown

# ── T3 验活失败（health 的 git_sha 不对）→ 回滚 plist 与 crontab，非零退出 ──────
echo "── T3 验活失败自动回滚 ──"
setup
touch "$FORCE_BAD_SHA_FILE"
set +e; OUT=$(bash "$RELEASE" --apply 2>&1); RC=$?; set -e
[ "$RC" != 0 ] && pass "验活失败非零退出" || fail "验活失败非零退出" "$OUT"
cmp -s "$PREVIEW_AGENT_PLIST" "$TMP/plist.orig" && pass "plist 回滚为原文件" || fail "plist 回滚为原文件" "$(cat "$PREVIEW_AGENT_PLIST")"
cmp -s "$TMP/crontab.txt" "$TMP/crontab.orig" && pass "crontab 回滚为原内容" || fail "crontab 回滚" "$(cat "$TMP/crontab.txt")"
[ ! -e "$PREVIEW_RELEASES_DIR/.current" ] && pass "未记录为当前发布" || fail "未记录为当前发布" "$(cat "$PREVIEW_RELEASES_DIR/.current")"
echo "$OUT" | grep -q "回滚" && pass "输出说明已回滚" || fail "输出说明已回滚" "$OUT"
teardown

# ── T4 凭据文件缺失 → 发布前就拒绝，什么都不改 ─────────────────────────────
echo "── T4 凭据文件缺失拒绝发布 ──"
setup
rm -f "$DEPLOY_TOKEN_FILE"
set +e; OUT=$(bash "$RELEASE" --apply 2>&1); RC=$?; set -e
[ "$RC" != 0 ] && pass "缺凭据文件拒绝" || fail "缺凭据文件拒绝" "$OUT"
cmp -s "$PREVIEW_AGENT_PLIST" "$TMP/plist.orig" && cmp -s "$TMP/crontab.txt" "$TMP/crontab.orig" && pass "未改 plist/crontab" || fail "未改 plist/crontab" ""
teardown

# ── T5 清理旧发布：保留 KEEP 个 + 上一版 + 仍被预览 worktree 引用的目录 ──────────
echo "── T5 旧发布清理不误删在用目录 ──"
setup
mkdir -p "$PREVIEW_RELEASES_DIR/rel-aaaaaaaaaaaa" "$PREVIEW_RELEASES_DIR/rel-bbbbbbbbbbbb/.git/worktrees/preview-6117" "$PREVIEW_RELEASES_DIR/rel-cccccccccccc"
touch -t 202601010000 "$PREVIEW_RELEASES_DIR/rel-aaaaaaaaaaaa"
touch -t 202601020000 "$PREVIEW_RELEASES_DIR/rel-bbbbbbbbbbbb"
touch -t 202601030000 "$PREVIEW_RELEASES_DIR/rel-cccccccccccc"
set +e; OUT=$(PREVIEW_RELEASE_KEEP=3 bash "$RELEASE" --apply 2>&1); RC=$?; set -e
[ "$RC" = 0 ] && pass "--apply 退出 0" || fail "--apply 退出 0" "$OUT"
[ ! -e "$PREVIEW_RELEASES_DIR/rel-aaaaaaaaaaaa" ] && pass "最旧的闲置发布被清理" || fail "最旧的闲置发布被清理" "$(ls "$PREVIEW_RELEASES_DIR")"
[ -d "$PREVIEW_RELEASES_DIR/rel-bbbbbbbbbbbb" ] && pass "仍有预览 worktree 的发布保留" || fail "在用发布保留" ""
[ -d "$PREVIEW_RELEASES_DIR/rel-cccccccccccc" ] && pass "KEEP 范围内的发布保留" || fail "KEEP 范围内保留" ""
[ -d "$PREVIEW_RELEASES_DIR/fleet-old" ] && pass "上一版保留" || fail "上一版保留" ""
teardown

# ── T6 launchctl 竞态：bootout 后服务还在卸载中 + 首次 bootstrap 返回 5 → 等卸载完并重试，发布成功不回滚 ──
# 现场（MMV 10-12）：bootout 是异步的，紧接着 bootstrap 报 "Bootstrap failed: 5: Input/output error" → 整次发布回滚
echo "── T6 launchctl bootout 异步 + bootstrap 5 重试 ──"
setup
export LC_GHOST_PRINTS=4
touch "$LC_FAIL_FIRST_BOOTSTRAP"
set +e; OUT=$(bash "$RELEASE" --apply 2>&1); RC=$?; set -e
NEW="$PREVIEW_RELEASES_DIR/rel-${TARGET_SHA:0:12}"
[ "$RC" = 0 ] && pass "竞态下 --apply 仍退出 0" || fail "竞态下 --apply 退出 0" "rc=$RC out=$OUT"
echo "$OUT" | grep -q "回滚到发布前" && fail "未触发回滚" "$OUT" || pass "未触发回滚"
grep -q "launchctl print" "$TMP/calls.log" && pass "bootout 后轮询 print 等服务卸载" || fail "bootout 后轮询 print" "$(cat "$TMP/calls.log")"
[ "$(grep -c 'launchctl bootstrap' "$TMP/calls.log")" -ge 2 ] && pass "bootstrap 失败后重试" || fail "bootstrap 失败后重试" "$(cat "$TMP/calls.log")"
[ "$(cat "$PREVIEW_RELEASES_DIR/.current" 2>/dev/null)" = "$NEW" ] && pass "记录为当前发布" || fail "记录为当前发布" "$OUT"
grep -qF "<string>${NEW}</string>" "$PREVIEW_AGENT_PLIST" && pass "plist 指向新目录（未被回滚）" || fail "plist 指向新目录" "$(cat "$PREVIEW_AGENT_PLIST")"
export LC_GHOST_PRINTS=0
teardown

# 活着的 HTTP owner 不属于 launchd 时，不能用只会恢复 plist 的发布事务接管。
echo "── T7 孤儿 owner 缺 plist：切换前拒绝 ──"
setup
rm "$PREVIEW_AGENT_PLIST"
set +e; OUT=$(bash "$RELEASE" --apply 2>&1); RC=$?; set -e
[ "$RC" != 0 ] && pass "孤儿 owner 拒绝发布" || fail "孤儿 owner 拒绝发布" "$OUT"
[ ! -e "$PREVIEW_AGENT_PLIST" ] && pass "未创建新 plist" || fail "未创建新 plist" "$OUT"
cmp -s "$TMP/crontab.txt" "$TMP/crontab.orig" && pass "孤儿 owner crontab 不变" || fail "孤儿 owner crontab 不变" "$OUT"
[ ! -e "$TMP/calls.log" ] && pass "无 fetch 后安装或 launchd 变更" || fail "无 fetch 后安装或 launchd 变更" "$(cat "$TMP/calls.log")"
teardown

echo "── T8 活 endpoint 的 plist 无 loaded owner：切换前拒绝 ──"
setup
rm "$LC_STATE/loaded"
set +e; OUT=$(bash "$RELEASE" --apply 2>&1); RC=$?; set -e
[ "$RC" != 0 ] && pass "未托管 owner 拒绝发布" || fail "未托管 owner 拒绝发布" "$OUT"
cmp -s "$PREVIEW_AGENT_PLIST" "$TMP/plist.orig" && cmp -s "$TMP/crontab.txt" "$TMP/crontab.orig" && pass "未托管 owner 原配置不变" || fail "未托管 owner 原配置不变" "$OUT"
if grep -E 'launchctl (bootout|bootstrap|kickstart)|npm |crontab-write' "$TMP/calls.log" >/dev/null 2>&1; then fail "只读 owner 检测" "$(cat "$TMP/calls.log")"; else pass "只读 owner 检测"; fi
teardown

echo "── T9 loaded 但PID不属于端口：发布前拒绝 ──"
setup
touch "$TMP/bad-owner"
set +e; OUT=$(bash "$RELEASE" --apply 2>&1); RC=$?; set -e
[ "$RC" != 0 ] && pass "loaded不是owner" || fail "loaded不是owner" "$OUT"
cmp -s "$PREVIEW_AGENT_PLIST" "$TMP/plist.orig" && cmp -s "$TMP/crontab.txt" "$TMP/crontab.orig" && pass "坏owner原配置保持" || fail "坏owner原配置保持" "$OUT"
teardown

echo "── T10 cron无写权限：全组件必须在安装前拒绝 ──"
setup
touch "$TMP/cron-reject-writes"
set +e; OUT=$(bash "$RELEASE" --apply 2>&1); RC=$?; set -e
[ "$RC" != 0 ] && pass "cron拒写全组件发布失败" || fail "cron拒写全组件发布失败" "$OUT"
cmp -s "$PREVIEW_AGENT_PLIST" "$TMP/plist.orig" && cmp -s "$TMP/crontab.txt" "$TMP/crontab.orig" && pass "cron失败前未切代理" || fail "cron失败前未切代理" "$OUT"
if grep -E 'launchctl (bootout|bootstrap|kickstart)|npm ' "$TMP/calls.log" >/dev/null 2>&1; then fail "权限探针先于安装" "$OUT"; else pass "权限探针先于安装"; fi
teardown

echo "── T11 显式agent组件：cron拒写仍可发布且旧reaper保留 ──"
setup
mkdir -p "$PREVIEW_RELEASES_DIR/fleet-preserve"
touch "$TMP/cron-reject-writes"
set +e; OUT=$(PREVIEW_RELEASE_KEEP=2 bash "$RELEASE" --apply --component agent 2>&1); RC=$?; set -e
[ "$RC" = 0 ] && pass "agent组件可独立发布" || fail "agent组件可独立发布" "$OUT"
cmp -s "$TMP/crontab.txt" "$TMP/crontab.orig" && pass "agent模式cron字节保全" || fail "agent模式cron字节保全" "$OUT"
if grep -E 'crontab-write|crontab-denied' "$TMP/calls.log" >/dev/null 2>&1; then fail "agent模式不调用cron写接口" "$OUT"; else pass "agent模式不调用cron写接口"; fi
[ "$(cat "$PREVIEW_RELEASES_DIR/.current" 2>/dev/null)" = "$PREVIEW_RELEASES_DIR/rel-${TARGET_SHA:0:12}" ] && pass "agent模式记录实际发布" || fail "agent模式记录实际发布" "$OUT"
[ -d "$OLD" ] && pass "旧reaper依赖锚保留" || fail "旧reaper依赖锚保留" "$OUT"
[ -d "$PREVIEW_RELEASES_DIR/fleet-preserve" ] && pass "agent发布不执行快照清理" || fail "agent发布不执行快照清理" "$OUT"
teardown

echo "── T12 agent模式失败恢复且不碰cron ──"
setup
touch "$TMP/cron-reject-writes" "$FORCE_BAD_SHA_FILE"
set +e; OUT=$(bash "$RELEASE" --apply --component agent 2>&1); RC=$?; set -e
[ "$RC" != 0 ] && echo "$OUT" | grep -q "回滚" && cmp -s "$PREVIEW_AGENT_PLIST" "$TMP/plist.orig" && pass "agent验活失败恢复旧plist" || fail "agent验活失败恢复旧plist" "$OUT"
if grep -E 'crontab-write|crontab-denied' "$TMP/calls.log" >/dev/null 2>&1; then fail "agent回退不调用cron写接口" "$OUT"; else pass "agent回退不调用cron写接口"; fi
teardown

echo "── T13 新实例PID归属错配：不得记录已发布 ──"
setup
touch "$TMP/bad-owner-after"
set +e; OUT=$(bash "$RELEASE" --apply --component agent 2>&1); RC=$?; set -e
[ "$RC" != 0 ] && echo "$OUT" | grep -q "归属失败" && cmp -s "$PREVIEW_AGENT_PLIST" "$TMP/plist.orig" && pass "新owner错误恢复前驱" || fail "新owner错误恢复前驱" "$OUT"
[ ! -e "$PREVIEW_RELEASES_DIR/.current" ] && pass "owner错误不记录已发布" || fail "owner错误不记录已发布" "$OUT"
teardown

echo "── T14 PID匹配但目录错误：发布前保持旧实例 ──"
setup
touch "$TMP/bad-cwd"
set +e; OUT=$(bash "$RELEASE" --apply --component agent 2>&1); RC=$?; set -e
[ "$RC" != 0 ] && cmp -s "$PREVIEW_AGENT_PLIST" "$TMP/plist.orig" && pass "目录错配拒绝且保持原plist" || fail "目录错配拒绝且保持原plist" "$OUT"
if grep -E 'launchctl (bootout|bootstrap|kickstart)|npm |crontab-write' "$TMP/calls.log" >/dev/null 2>&1; then fail "目录错配无切换副作用" "$OUT"; else pass "目录错配无切换副作用"; fi
teardown

echo "── T15 cron读取不可确定：不得用空表探测writer ──"
for component in all agent; do
  for reason in denied io; do
    setup
    touch "$TMP/cron-read-$reason"
    set +e; OUT=$(bash "$RELEASE" --apply --component "$component" 2>&1); RC=$?; set -e
    [ "$RC" != 0 ] && pass "$component/$reason 读取失败拒绝" || fail "$component/$reason 读取失败拒绝" "$OUT"
    cmp -s "$TMP/crontab.txt" "$TMP/crontab.orig" && cmp -s "$PREVIEW_AGENT_PLIST" "$TMP/plist.orig" && pass "$component/$reason 原表与代理原样" || fail "$component/$reason 原表与代理原样" "$OUT"
    if grep -E 'launchctl (bootout|bootstrap|kickstart)|npm |crontab-write' "$TMP/calls.log" >/dev/null 2>&1; then fail "$component/$reason 零写入零安装" "$OUT"; else pass "$component/$reason 零写入零安装"; fi
    teardown
  done
done

echo "── T16 官方明确no-crontab：agent模式保全真正的不存在状态 ──"
setup
rm "$TMP/crontab.txt"
set +e; OUT=$(bash "$RELEASE" --apply --component agent 2>&1); RC=$?; set -e
[ "$RC" = 0 ] && [ ! -e "$TMP/crontab.txt" ] && pass "官方明确不存在可发布agent且不创建cron" || fail "官方明确不存在可发布agent且不创建cron" "$OUT"
if grep -E 'crontab-write|crontab-denied' "$TMP/calls.log" >/dev/null 2>&1; then fail "原无cron的agent模式不写cron" "$OUT"; else pass "原无cron的agent模式不写cron"; fi
teardown

echo "── T17 真实Node入口：目标只作foreign普通参数必须拒绝 ──"
if OWNER_HELPER="$SRC_SCRIPTS/lib/preview-agent-owner.sh" node --input-type=module <<'JS'
import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,rmSync,realpathSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{spawn,spawnSync}from'node:child_process';
const dir=realpathSync(mkdtempSync(join(tmpdir(),'preview-argv-contract-'))),root=join(dir,'release'),bin=join(dir,'bin'),entry=join(root,'scripts/preview-agent.mjs'),foreign=join(dir,'foreign.mjs'),plist=join(dir,'agent.plist');mkdirSync(join(root,'scripts'),{recursive:true});mkdirSync(bin);
const body=`import http from 'node:http';import fs from 'node:fs';const s=http.createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.env.OWNER_REPORT,JSON.stringify({pid:process.pid,port:s.address().port})));`;writeFileSync(entry,body);writeFileSync(foreign,body);let child;
const check=(pid,port)=>{writeFileSync(join(bin,'launchctl'),'#!/bin/sh\necho "pid = '+pid+'"\n');chmodSync(join(bin,'launchctl'),0o755);return spawnSync('bash',['-c','source "$1"; preview_agent_owner fixture "$2" "$3" "$4"','contract',process.env.OWNER_HELPER,root,'http://127.0.0.1:'+port,plist],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH}});};
try{for(const bad of [false,true]){const report=join(dir,bad?'foreign.json':'valid.json');child=spawn(process.execPath,bad?[foreign,entry]:[entry],{cwd:root,env:{...process.env,OWNER_REPORT:report},stdio:'ignore'});let identity;for(let n=0;n<100;n++){try{identity=JSON.parse(readFileSync(report));break;}catch{}await new Promise(r=>setTimeout(r,20));}if(!identity)throw Error('fixture startup');writeFileSync(plist,'<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>fixture</string><key>WorkingDirectory</key><string>'+root+'</string><key>ProgramArguments</key><array><string>'+process.execPath+'</string><string>'+entry+'</string></array></dict></plist>');const result=check(identity.pid,identity.port);console.log(JSON.stringify({case:bad?'foreign-entry-argument':'unique-node-entry',pid:identity.pid,port:identity.port,helper_rc:result.status,node:process.execPath}));if(bad?result.status===0:result.status!==0)throw Error((bad?'foreign entry accepted':'valid entry rejected')+': '+result.stderr);child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));child=null;}}
finally{if(child){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}rmSync(dir,{recursive:true,force:true});}
JS
then pass "真实唯一Node入口通过且foreign尾参数拒绝"; else fail "真实唯一Node入口通过且foreign尾参数拒绝" "kernel argv/executable contract"; fi

echo ""
echo "preview-host-release.test.sh: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
