#!/usr/bin/env bash
set -euo pipefail
OPC_TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec node --test "$OPC_TEST_ROOT/scripts/ops/__tests__/opc-objects-config.test.mjs"
