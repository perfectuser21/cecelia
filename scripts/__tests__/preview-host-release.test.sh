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
  mkdir -p "$TMP/seed/scripts/preview-agent" "$TMP/seed/packages/brain"
  for f in preview-agent-install.sh preview-agent.mjs preview-reaper.sh preview-agent/deploy-token.mjs; do
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
if [ "\$1" = "-l" ]; then [ -f "$TMP/crontab.txt" ] && cat "$TMP/crontab.txt" && exit 0; echo "no crontab" >&2; exit 1; fi
if [ "\$1" = "-" ]; then cat > "$TMP/crontab.txt"; else cp "\$1" "$TMP/crontab.txt"; fi
echo "crontab-write" >> "$TMP/calls.log"
SH
  # mock：launchctl（bootstrap/kickstart 时按 plist 的 WorkingDirectory 生成磁盘样本，模拟代理起来后采样）
  cat > "$BIN/launchctl" <<SH
#!/bin/bash
echo "launchctl \$*" >> "$TMP/calls.log"
wd=\$(awk '/<key>WorkingDirectory<\/key>/{f=1} f&&/<string>/{gsub(/.*<string>|<\/string>.*/,"");print;exit}' "$PREVIEW_AGENT_PLIST")
if [ "\$1" = "bootstrap" ] || [ "\$1" = "kickstart" ]; then mkdir -p "\$wd/.runtime" && touch "\$wd/.runtime/host-disk.json"; fi
exit 0
SH
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
const wd = () => (readFileSync(plist, 'utf8').match(/<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/) || [])[1];
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

echo ""
echo "preview-host-release.test.sh: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
