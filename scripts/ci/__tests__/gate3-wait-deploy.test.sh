#!/usr/bin/env bash
# 回归测试：gate3-wait-deploy.sh —— Gate3「等待 Deploy 完成」按 git_sha 判定成功
#
# 守护 bug（2026-09-28/29 两次实证，#5635 / #5654）：
#   合并触发 webhook 时上一次部署仍在跑，本次请求没有真正执行；旧逻辑轮询到
#   status=idle（>30s）即「可能无变更，视为成功」exit 0，生产 git_sha 仍是旧提交，
#   只能人工 gh run rerun 补部署。
# 修法：终态（idle/success/succeeded）时比对 deploy/status.git_sha 与本次提交：
#   部署 sha == 本次 或 是其后代 → 成功；否则重触发 webhook（≤2 次），耗尽 exit 1。
#   running 且 sha 旧 → 只等待，不算成功。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SUT="$REPO_ROOT/scripts/ci/gate3-wait-deploy.sh"
FAIL=0
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# ── 造一个假 git 仓库：P(旧) → A(本次) → B(后续合并)；S 为 P 的旁支（不含 A）──
G="$TMP/repo"
gc() { git -C "$G" -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.email=t@t -c user.name=t commit -q --allow-empty -m "$1"; }
git init -q "$G"  # 夹具提交禁用全局 hook（开发机 pre-commit 会拦 main 分支）
gc P; P=$(git -C "$G" rev-parse HEAD)
gc A; A=$(git -C "$G" rev-parse HEAD)
gc B; B=$(git -C "$G" rev-parse HEAD)
git -C "$G" checkout -q -b side "$P"
gc S; S=$(git -C "$G" rev-parse HEAD)

# ── 假 deploy/status 源：每次调用从 queue 弹出一行写入 current.json（队列空则保持）──
cat > "$TMP/fake-status" <<'SH'
ST="$FAKE_STATE"
if [ -s "$ST/queue" ]; then
  head -n1 "$ST/queue" > "$ST/current.json"
  tail -n +2 "$ST/queue" > "$ST/queue.tmp"; mv "$ST/queue.tmp" "$ST/queue"
fi
cat "$ST/current.json"
SH
# ── 假触发器：计数 +1；若存在 on_trigger_<n> 则追加进队列；输出 HTTP 码 ──
cat > "$TMP/fake-trigger" <<'SH'
ST="$FAKE_STATE"
n=$(( $(cat "$ST/triggers" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$ST/triggers"
[ -f "$ST/on_trigger_$n" ] && cat "$ST/on_trigger_$n" >> "$ST/queue"
echo "${FAKE_TRIGGER_CODE:-202}"
SH

js() { printf '{"status":"%s","git_sha":"%s"}\n' "$1" "$2"; }

# new_state <初始 JSON>：重置假状态目录
new_state() {
  ST="$TMP/state-$RANDOM$RANDOM"; mkdir -p "$ST"
  echo "$1" > "$ST/current.json"; : > "$ST/queue"; echo 0 > "$ST/triggers"
}

# run_sut <名称> <期望exit> <期望输出片段> <期望重触发次数>
run_sut() {
  local name="$1" want_exit="$2" want_out="$3" want_trig="$4"
  local out code trig
  out=$(FAKE_STATE="$ST" REPO_DIR="$G" \
        STATUS_CMD="bash $TMP/fake-status" TRIGGER_CMD="bash $TMP/fake-trigger" \
        POLL_INTERVAL_S=0 MAX_POLLS="${MAX_POLLS:-30}" \
        bash "$SUT" "http://x" "$A" 2>&1)
  code=$?
  trig=$(cat "$ST/triggers")
  if [ "$code" -eq "$want_exit" ] && echo "$out" | grep -q -- "$want_out" && [ "$trig" -eq "$want_trig" ]; then
    echo "  ✅ $name (exit $code, 重触发 $trig 次)"
  else
    echo "  ❌ ${name}：期望 exit${want_exit}/含[$want_out]/重触发${want_trig}，实得 exit=$code 重触发=$trig"
    echo "$out" | sed 's/^/      | /'
    FAIL=1
  fi
}

echo "== gate3-wait-deploy：按部署 git_sha 判定 =="

# T1 idle + 部署 sha == 本次 → 成功，不重触发
new_state "$(js idle "$A")"
run_sut "idle+本次sha→成功" 0 "包含本次提交" 0

# T2 success + 部署 sha 是本次的后代（后续合并一起上了）→ 成功
new_state "$(js success "$B")"
run_sut "success+后代sha→成功" 0 "包含本次提交" 0

# T3 idle + 旧 sha → 重触发 1 次 → running(旧) → idle(本次) → 成功
new_state "$(js idle "$P")"
{ js running "$P"; js running "$P"; js idle "$A"; } > "$ST/on_trigger_1"
run_sut "idle+旧sha→重触发后成功" 0 "包含本次提交" 1

# T4 running + 旧 sha（前一次部署在跑）→ 只等待，不算成功；结束后 idle(本次) → 成功，不重触发
new_state "$(js running "$P")"
{ js running "$P"; js running "$P"; js running "$P"; js idle "$A"; } > "$ST/queue"
run_sut "running+旧sha→等待" 0 "前一次部署仍在进行" 0

# T5 running(旧) 结束后仍是旧 sha（本次请求被吞）→ 重触发 → 成功
new_state "$(js running "$P")"
{ js running "$P"; js idle "$P"; } > "$ST/queue"
{ js running "$P"; js success "$B"; } > "$ST/on_trigger_1"
run_sut "running旧→idle旧→重触发" 0 "包含本次提交" 1

# T6 idle 旁支 sha（不含本次）→ 视为不含 → 重触发耗尽 → 失败
new_state "$(js idle "$S")"
run_sut "旁支sha→重触发耗尽失败" 1 "::error::" 2

# T7 idle 旧 sha 永远不变 → 重触发 2 次后 exit 1 且 ::error::
new_state "$(js idle "$P")"
run_sut "重触发耗尽→失败" 1 "::error::" 2

# T8 status=failed → exit 1（保留原有失败语义）
new_state '{"status":"failed","git_sha":"'"$P"'","error":"deploy-local.sh exited code=1"}'
run_sut "failed→失败" 1 "::error::Deploy 失败" 0

# T9 一直 running → 轮询预算耗尽 → exit 1
new_state "$(js running "$P")"
MAX_POLLS=5 run_sut "running永不结束→超时失败" 1 "::error::" 0

# T10 状态不可达（空响应）后恢复 idle(本次) → 成功
new_state ''
{ echo ''; js idle "$A"; } > "$ST/queue"
run_sut "不可达→恢复后成功" 0 "包含本次提交" 0

# T11 running 但部署 sha 已是本次后代（更新的部署在跑，本次代码已在线）→ 成功，不白等
new_state "$(js running "$B")"
run_sut "running+后代sha→成功" 0 "包含本次提交" 0

echo ""
if [ "$FAIL" -eq 0 ]; then echo "✅ gate3-wait-deploy 全部通过"; else echo "❌ gate3-wait-deploy 有失败"; exit 1; fi
