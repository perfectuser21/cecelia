# DoD — cp-0426202430-cicd-c-deploy-smoke

## Goal

`scripts/brain-deploy.sh` healthy check 后跑最近 5 个合并 PR 引入的 smoke.sh，
非 fatal；并写 c8a 范本（PostgresSaver + 5 channel + Brain 重启持久）。

## Artifact

- [x] [ARTIFACT] `scripts/brain-deploy.sh` 含 `run_post_deploy_smoke` 函数定义
      Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.match(/^run_post_deploy_smoke\(\) \{/m))process.exit(1)"

- [x] [ARTIFACT] `packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh` 存在 + chmod +x
      Test: manual:node -e "const fs=require('fs');const s=fs.statSync('packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh');if((s.mode&0o100)===0)process.exit(1)"

## Behavior

- [x] [BEHAVIOR] brain-deploy.sh Phase 11 调 `run_post_deploy_smoke` 且 non-fatal
      Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.includes('[11/11] Post-deploy smoke'))process.exit(1);if(!c.includes('run_post_deploy_smoke || true'))process.exit(1)"

- [x] [BEHAVIOR] `run_post_deploy_smoke` 支持 SKIP_POST_DEPLOY_SMOKE / RECENT_PRS env
      Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-deploy.sh','utf8');if(!c.includes('SKIP_POST_DEPLOY_SMOKE')||!c.includes('RECENT_PRS')||!c.includes('gh pr view'))process.exit(1)"

- [x] [BEHAVIOR] c8a smoke 含 7 步关键验证（PostgresSaver / 5_channels / docker restart / cleanup）
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh','utf8');['PostgresSaver','saver.put','saver.getTuple','5_channels_recovered','docker restart cecelia-node-brain','trap cleanup EXIT','DELETE FROM checkpoints'].forEach(t=>{if(!c.includes(t))process.exit(1)})"

- [x] [BEHAVIOR] c8a smoke 缺前置依赖时优雅 skip exit 0
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh','utf8');['docker 命令不存在','docker daemon 不可达','cecelia-node-brain 容器不存在','psql 不在 PATH'].forEach(t=>{if(!c.includes(t))process.exit(1)})"

- [x] [BEHAVIOR] c8a smoke 验 5 个 LangGraph channel（worktreePath / plannerOutput / taskPlan / ganResult / result）
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/c8a-harness-checkpoint-resume.sh','utf8');['worktreePath','plannerOutput','taskPlan','ganResult','result'].forEach(t=>{if(!c.includes(t))process.exit(1)})"

- [x] [BEHAVIOR] post-deploy-smoke 单元测试覆盖 brain-deploy.sh + smoke 范本
      Test: tests/packages/brain/post-deploy-smoke.test.js

## Constraints

- 不改 CI workflow（task B 已经覆盖 CI 侧 real-env-smoke job）
- 不改 SKILL（task A 覆盖 /dev 强制 smoke.sh）
- 不写 D / E1 observer / tick / content-pipeline 幂等 smoke（task D 覆盖）
- 不动 dispatcher / brain v2 业务代码
- 不 bump engine 版本（仅改 scripts/ + packages/brain/scripts/smoke/，与 engine 无关）
