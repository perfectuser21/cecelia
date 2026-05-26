#!/bin/bash
# Engine entry point for Route B end-to-end verification.
# Delegates to the sprint verification script.
set -euo pipefail
exec "$(git rev-parse --show-toplevel)/sprints/ws2-route-b-verify/verify-route-b.sh" "$@"
