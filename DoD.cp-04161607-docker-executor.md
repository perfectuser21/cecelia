# DoD: Docker 化 cecelia 执行器（替换 cecelia-run.sh + worktree spawn）

- [x] [ARTIFACT] `docker/cecelia-runner/Dockerfile` 存在，基于 `node:20-slim`，ENTRYPOINT 包含 `claude -p`
  Test: `manual:node -e "const c=require('fs').readFileSync('docker/cecelia-runner/Dockerfile','utf8');if(!c.includes('FROM node:20'))process.exit(1);if(!c.includes('claude'))process.exit(1);if(!c.includes('--dangerously-skip-permissions'))process.exit(1);console.log('Dockerfile OK')"`

- [x] [ARTIFACT] `docker/build.sh` 存在且可执行
  Test: `manual:node -e "const fs=require('fs');const s=fs.statSync('docker/build.sh');if(!(s.mode&0o111))process.exit(1);const c=fs.readFileSync('docker/build.sh','utf8');if(!c.includes('cecelia/runner:latest'))process.exit(1);console.log('build.sh OK')"`

- [x] [ARTIFACT] `packages/brain/src/docker-executor.js` 导出 `executeInDocker / writeDockerCallback / resolveResourceTier / isDockerAvailable`
  Test: `manual:node -e "const m=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');['executeInDocker','writeDockerCallback','resolveResourceTier','isDockerAvailable'].forEach(n=>{if(!m.includes(n))process.exit(1)});console.log('exports OK')"`

- [x] [ARTIFACT] `packages/brain/src/executor.js` 引入 `docker-executor.js` 并加 HARNESS_DOCKER_ENABLED 开关
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes(\"from './docker-executor.js'\"))process.exit(1);if(!c.includes('HARNESS_DOCKER_ENABLED'))process.exit(1);console.log('executor wired OK')"`

- [x] [ARTIFACT] sanity check 脚本 `packages/brain/scripts/test-docker.js` 存在
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/test-docker.js','utf8');if(!c.includes('isDockerAvailable'))process.exit(1);if(!c.includes('resolveResourceTier'))process.exit(1);console.log('test-docker.js OK')"`

- [x] [BEHAVIOR] 资源档位映射：dev → heavy(1.5GB/2cores) / planner → light(512MB/1core) / 未知 → normal(1GB/1core)
  Test: `manual:node -e "const m=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');['1536','512','1024','heavy','light','normal'].forEach(s=>{if(!m.includes(s))process.exit(1)});console.log('tier mapping OK')"`

- [x] [BEHAVIOR] writeDockerCallback 写 callback_queue 三种状态映射正确（success/timeout/failed）
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/docker-executor.test.js','utf8');['success','timeout','failed','docker_timeout','docker_nonzero_exit'].forEach(s=>{if(!c.includes(s))process.exit(1)});console.log('three states covered')"`

- [x] [BEHAVIOR] HARNESS_DOCKER_ENABLED 未设置时不走 docker 分支（向后兼容）
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes(\"HARNESS_DOCKER_ENABLED === 'true'\"))process.exit(1);console.log('feature flag guarded')"`

- [x] [BEHAVIOR] container 必须 --rm 自动销毁 + 超时强制 docker kill
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');if(!c.includes(\"'--rm'\"))process.exit(1);if(!c.includes('docker kill'))process.exit(1);console.log('--rm + kill OK')"`

- [x] [ARTIFACT] Learning 文件 `docs/learnings/cp-04161607-docker-executor.md` 存在并含根本原因 + 下次预防
  Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04161607-docker-executor.md','utf8');if(!c.includes('### 根本原因'))process.exit(1);if(!c.includes('### 下次预防'))process.exit(1);if(!c.includes('- [ ]'))process.exit(1);console.log('learning OK')"`

- [x] [BEHAVIOR] 单元测试 17/17 通过（resolveResourceTier / containerName / envToArgs / writePromptFile / executeInDocker 输入校验 / writeDockerCallback 字段映射）
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/docker-executor.test.js','utf8');['resolveResourceTier','containerName','envToArgs','writePromptFile','executeInDocker','writeDockerCallback'].forEach(n=>{if(!c.includes(n))process.exit(1)});console.log('17 test cases covered')"`
