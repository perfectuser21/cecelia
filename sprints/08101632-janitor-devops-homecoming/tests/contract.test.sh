#!/usr/bin/env bash
# contract.test.sh — 合同测试套件入口（judge 机械闸识别格式 *.test.sh）
set -euo pipefail
DIR="$(dirname "$0")"
exec bash "$DIR/run-all.sh" "$@"
