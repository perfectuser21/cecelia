#!/usr/bin/env bash
# 把 workflow-guard 部署到 Commander 账本所在主机（hk-vps）。
#
# 为什么必须部署在那台：授权要读 state/workflow-runs/<run>__<attempt>.json。
# worker（XIAN-M4-PHONE 等）跨机器读不到账本，这正是 2026-09-07 final6 挂掉的原因
# ——它被要求本地执行一个在它那侧根本不存在的 guard 脚本，四次重试全挂在
# "guard path was unavailable in the worker environment"，而视频其实已经找到了。
#
# 幂等：重复执行只覆盖代码并重启服务。
set -euo pipefail
HOST="${GUARD_HOST_SSH:-root@100.86.118.99}"
REMOTE_DIR="${GUARD_REMOTE_DIR:-/opt/workflow-guard}"
BIND_IP="${GUARD_BIND_IP:-100.86.118.99}"
SRC="$(cd "$(dirname "$0")/../.." && pwd)/services/workflow-guard"

[ -d "$SRC/src" ] || { echo "找不到源目录 $SRC/src" >&2; exit 1; }

echo "[1/4] 同步代码 → $HOST:$REMOTE_DIR"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "mkdir -p $REMOTE_DIR/src"
scp -q -o BatchMode=yes -o ConnectTimeout=10 "$SRC"/src/*.js "$SRC"/src/*.mjs "$HOST:$REMOTE_DIR/src/"

echo "[2/4] 安装 systemd 单元"
scp -q -o BatchMode=yes -o ConnectTimeout=10 "$SRC/workflow-guard.service" "$HOST:/etc/systemd/system/"

echo "[3/4] 重载并启动"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" \
  "systemctl daemon-reload && systemctl enable --now workflow-guard && systemctl restart workflow-guard"

echo "[4/4] 部署后自检"
sleep 3
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "
  set -e
  systemctl is-active --quiet workflow-guard || { echo '服务未运行'; journalctl -u workflow-guard -n 20 --no-pager; exit 1; }
  curl -sf -m 5 http://$BIND_IP:8477/health >/dev/null || { echo 'health 探测失败'; exit 1; }
  echo '  OK 服务健康'
  # 暴露面自检：这个接口能签发写入令牌，绝不能挂在公网上
  PUB=\$(curl -s -m 3 ifconfig.me 2>/dev/null || true)
  if [ -n \"\$PUB\" ] && timeout 4 curl -s -m 3 http://\$PUB:8477/health >/dev/null 2>&1; then
    echo '  警告：公网可达，立即检查 GUARD_HOST 绑定'; exit 1
  fi
  echo '  OK 公网不可达（仅 tailnet）'
"
echo "workflow-guard 部署完成：http://$BIND_IP:8477"
