#!/usr/bin/env bash
# 回归测试：蓝绿 sidecar 的 cancel_drain_after_up() 失败路径必须落持久化日志（任务 40f798ac）。
#
# 根因：sidecar 是 `docker run -d --rm` 起的一次性容器，healthz 轮询超时/drain-cancel 5次
# 全失败时原先只 `echo` 到 stdout——容器退出即被 --rm 清空，完全没有可观测性。0930 生产
# 实测复现：draining 卡了 10+ 分钟，人工手动 POST drain-cancel 立即生效（证明 app 层逻辑
# 本身没问题），但排查时找不到任何 sidecar 侧的失败记录，只能靠猜。
#
# 本测试用 grep 做结构检查（不真跑 sidecar 脚本——cancel_drain_after_up() 失败路径要
# 90×2s+5×5s≈3.4分钟才会走完两条重试，真跑会拖垮 CI，2026-08-06 已有同类事故教训）。
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SIDECAR_SH="$REPO_ROOT/scripts/lib/bluegreen-sidecar.sh"
FAIL=0

# 1. healthz 轮询超时分支必须调用 _sidecar_log
if ! awk '/HEALTHZ_OK.*!=.*1/,/^  fi$/' "$SIDECAR_SH" | grep -q "_sidecar_log"; then
  echo "❌ healthz 轮询超时分支未调用 _sidecar_log，失败信息会随 --rm 容器丢失"; FAIL=1
fi

# 2. drain-cancel 5 次全失败分支必须调用 _sidecar_log
if ! awk '/DRAIN_CANCEL_OK.*!=.*1/,/^  fi$/' "$SIDECAR_SH" | grep -q "_sidecar_log"; then
  echo "❌ drain-cancel 5 次全失败分支未调用 _sidecar_log，失败信息会随 --rm 容器丢失"; FAIL=1
fi

# 3. _sidecar_log 必须在 cancel_drain_after_up 之前定义（bash 函数调用顺序）
log_def_line=$(grep -n "^_sidecar_log()" "$SIDECAR_SH" | head -1 | cut -d: -f1)
fn_def_line=$(grep -n "^cancel_drain_after_up()" "$SIDECAR_SH" | head -1 | cut -d: -f1)
if [[ -z "$log_def_line" || -z "$fn_def_line" || "$log_def_line" -ge "$fn_def_line" ]]; then
  echo "❌ _sidecar_log 未在 cancel_drain_after_up 之前定义"; FAIL=1
fi

# 4. 语法有效
bash -n "$SIDECAR_SH" || { echo "❌ bluegreen-sidecar.sh 语法错误"; FAIL=1; }

if [ "$FAIL" -ne 0 ]; then exit 1; fi
echo "✅ bluegreen-sidecar-drain-log regression 全过"
