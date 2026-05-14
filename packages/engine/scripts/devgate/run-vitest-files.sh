#!/usr/bin/env bash
# Run vitest on a newline-or-space-separated list of test files.
# Handles GitHub Actions multiline output correctly by converting newlines to spaces.
# Usage: bash run-vitest-files.sh "<newline-separated-files>"
set -euo pipefail
FILES=$(printf '%s' "$1" | tr '\n' ' ')
npx vitest run ${FILES} --reporter=verbose
