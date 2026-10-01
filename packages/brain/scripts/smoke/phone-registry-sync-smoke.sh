#!/usr/bin/env bash
# cda0e3e8：隔离文件/手机控制器回归，不请求真实 Brain 或手机。
set -euo pipefail
brain_root="$(cd "$(dirname "$0")/../.." && pwd)"
node --check "$brain_root/src/phone-registry-sync.js"
python3 -c 'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())' "$brain_root/scripts/phone-registry-agent.py"
node --test "$brain_root/scripts/__tests__/phone-registry-agent.node-test.mjs"
