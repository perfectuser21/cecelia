#!/usr/bin/env bash
set -euo pipefail
# 本地真实 Git、原 ZIP、子进程与 API 夹具合同；不连接 PG 或线上服务。
unset NODE_OPTIONS NODE_PATH
NODE_BIN="$(command -v node)"
if [[ "$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')" != 22 ]]; then
  echo 'CI_ADMISSION_SMOKE_NODE22_REQUIRED' >&2
  exit 2
fi
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SMOKE_HOME="$(mktemp -d "${TMPDIR:-/tmp}/ci-admission-smoke.XXXXXX")"
trap 'rm -rf "$SMOKE_HOME"' EXIT
mkdir "$SMOKE_HOME/tmp"
cd "$REPO_ROOT"
# 不继承调用者 token、数据库密码、真实 HOME 或 Node 注入参数。
env -i PATH="$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin" \
  HOME="$SMOKE_HOME" TMPDIR="$SMOKE_HOME/tmp" CI=true NODE_ENV=test \
  DB_HOST=127.0.0.1 DB_PORT=1 DB_NAME=cecelia_scratch DB_USER=ci DB_PASSWORD=isolated-smoke \
  node --test \
  scripts/ci/__tests__/basic-ci-admission-archive.test.mjs \
  scripts/ci/__tests__/basic-ci-admission-artifact.test.mjs \
  scripts/ci/__tests__/basic-ci-admission-authority.test.mjs \
  scripts/ci/__tests__/basic-ci-admission-envelope.test.mjs \
  scripts/ci/__tests__/basic-ci-admission-inputs.test.mjs \
  scripts/ci/__tests__/basic-ci-admission-publisher.test.mjs \
  scripts/ci/__tests__/basic-ci-admission-skill-cache.test.mjs \
  scripts/ci/__tests__/basic-ci-admission-worker.test.mjs
