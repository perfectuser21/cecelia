# DoD — cp-0426202412-cicd-b-real-env-smoke

## Goal

CI 加 `real-env-smoke` job — 起真 cecelia-brain docker container + 真 postgres，
跑 `packages/brain/scripts/smoke/*.sh` 全部。补 docker-infra-smoke 不验真 HTTP 的盲区。
本 PR 加 1 个示范 smoke 让 CI 跑通验证机制。

## Artifact

- [x] [ARTIFACT] ci.yml 含 real-env-smoke job
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('real-env-smoke:'))process.exit(1);if(!/cecelia-brain:ci/.test(c))process.exit(1)"

- [x] [ARTIFACT] real-env-smoke 在 ci-passed needs 列表
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const m=c.match(/ci-passed:[\s\S]*?needs:\s*\[([^\]]+)\]/);if(!m||!m[1].includes('real-env-smoke'))process.exit(1)"

- [x] [ARTIFACT] 示范 smoke.sh 存在且可执行
      Test: manual:node -e "const fs=require('fs');fs.accessSync('packages/brain/scripts/smoke/example-health-check.sh',fs.constants.X_OK)"

## Behavior

- [x] [BEHAVIOR] real-env-smoke job 真起 cecelia-brain image（docker run + --network host）
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/docker run -d --name cecelia-brain-smoke[\s\S]*?--network host/.test(c))process.exit(1)"

- [x] [BEHAVIOR] real-env-smoke job 等 brain healthy 后才跑 smoke（curl tick/status 90s 超时）
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/curl -sf http:\/\/localhost:5221\/api\/brain\/tick\/status/.test(c))process.exit(1);if(!/seq 1 90/.test(c))process.exit(1)"

- [x] [BEHAVIOR] real-env-smoke job 跑 packages/brain/scripts/smoke/*.sh 全部，任一失败 → job fail
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('packages/brain/scripts/smoke'))process.exit(1);if(!/FAILED=[$][(][(]FAILED [+] 1[)][)]/.test(c))process.exit(1)"

- [x] [BEHAVIOR] real-env-smoke job 在 smoke 目录为空时 fail（强制必须有脚本）
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/必须有至少 1 个 smoke 脚本/.test(c))process.exit(1)"

- [x] [BEHAVIOR] 示范 smoke 校验 tick/status HTTP 200 + 响应含 interval_minutes / loop_interval_ms / startup_ok
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/example-health-check.sh','utf8');if(!c.includes('interval_minutes'))process.exit(1);if(!c.includes('loop_interval_ms'))process.exit(1);if(!c.includes('startup_ok'))process.exit(1);if(!c.includes('HTTP_CODE'))process.exit(1)"

## Constraints

- 与 task A（cicd-A 改 /dev SKILL + lint job）不冲突：A 改 SKILL 文件 + lint job，B 改 ci.yml 主 job + 加 smoke 目录
- 不动 brain 业务代码（仅加 ci.yml job + 1 个 smoke 脚本）
- timeout 20 min（smoke 慢但准）
