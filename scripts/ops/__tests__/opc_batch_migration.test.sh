#!/usr/bin/env bash
set -euo pipefail
OPS_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec python3 "$OPS_TEST_ROOT/tests/ops/test_opc_migration.py"
