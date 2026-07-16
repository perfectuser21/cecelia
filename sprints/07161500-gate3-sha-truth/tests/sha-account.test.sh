#!/usr/bin/env bash
# G1 SHA 对账串链测试入口（sprint stub）
# 毕业版：tests/regression/gate3-sha-truth/sha-account.test.sh
# 此文件保留在 sprint 目录供 judge 机械闸扫描

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec bash "$REPO_ROOT/tests/regression/gate3-sha-truth/sha-account.test.sh" "$@"
