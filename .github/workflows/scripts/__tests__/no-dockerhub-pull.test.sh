#!/usr/bin/env bash
# no-dockerhub-pull.test.sh — CI 不直接从 Docker Hub 拉镜像
#
# 2026-10-10 05:00 起 GitHub 共享 runner 未登录拉 Docker Hub（pgvector/pgvector:pg15、node:20-alpine）
# 连续 toomanyrequests，real-env-smoke / Smoke Glob Runner 等 job 全红、所有 PR 卡死（Brain 任务 7294cf3a）。
# 仓库没有 Docker Hub 凭据；改为走 mirror.gcr.io（Docker Hub 的 Google 拉取缓存，同一份镜像）。
# 守卫两条：
#   1. workflow 的 image:（service / container）必须带允许的镜像源前缀，裸名（隐含 docker.io）或 docker.io 一律拒
#   2. 跑在 GitHub 托管 ubuntu runner、且有 docker build / compose 的 job，必须先 uses ./.github/actions/dockerhub-mirror
#      （Dockerfile 里的 FROM node:20-alpine 由 dockerd registry-mirrors 改走镜像源）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

node - "$ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const dir = path.join(root, '.github/workflows');
const ALLOWED = /^(mirror\.gcr\.io|ghcr\.io|public\.ecr\.aws|gcr\.io)\//;
// 真正触发拉镜像的调用（docker build / docker compose ... / docker-compose up|build|run / build-push-action / 构建脚本）；
// 文件名里出现 docker-compose.yml（如路径过滤）不算
const BUILD = /\bdocker (build|buildx|compose)\b|\bdocker-compose\s+(-f|up|build|run|pull)\b|build-push-action|brain-(docker-up|build)\.sh/;
const fails = [];

for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  text.split('\n').forEach((line, i) => {
    const m = /^\s*-?\s*image:\s*(\S+)/.exec(line);
    if (!m) return;
    const ref = m[1].replace(/^['"]|['"]$/g, '');
    if (ref.startsWith('${{') || ref === 'scratch') return;
    if (!ALLOWED.test(ref)) fails.push(`${name}:${i + 1} image 直连 Docker Hub：${ref}（改成 mirror.gcr.io/<原路径>，官方镜像用 mirror.gcr.io/library/<名>）`);
  });
  const jobsAt = text.indexOf('\njobs:\n');
  if (jobsAt === -1) continue;
  const blocks = text.slice(jobsAt + 7).split(/\n(?=  [A-Za-z0-9_-]+:\s*\n)/);
  for (const block of blocks) {
    const job = block.split(':')[0].trim();
    const runsOn = /\n\s+runs-on:\s*(.+)/.exec(block)?.[1]?.trim() ?? '';
    const steps = block.split(/\n\s+steps:\s*\n/)[1] ?? '';
    if (!/ubuntu-/.test(runsOn) || !BUILD.test(steps)) continue;
    if (!steps.includes('./.github/actions/dockerhub-mirror')) {
      fails.push(`${name} job ${job}：有 docker build/compose 却没先 uses ./.github/actions/dockerhub-mirror`);
    }
  }
}

if (fails.length > 0) {
  for (const f of fails) console.log(`FAIL: ${f}`);
  console.log(`Results: FAIL=${fails.length}`);
  process.exit(1);
}
console.log('PASS: CI 镜像全部走允许的镜像源（不直连 Docker Hub）');
NODE
