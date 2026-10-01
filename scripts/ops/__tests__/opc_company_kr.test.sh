#!/usr/bin/env bash
# 公司 KR Python 读方与 Brain 入账回归，由既有 Ops CI glob 执行。
set -euo pipefail
OPS_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec python3 "$OPS_TEST_ROOT/tests/ops/test_opc_company_kr.py"
