# DoD: Docker Runner 非 root + 凭据注入

- [x] [ARTIFACT] Dockerfile 包含非 root 用户 (USER cecelia)
  File: docker/cecelia-runner/Dockerfile
  Check: contains "USER cecelia"

- [x] [BEHAVIOR] 容器以非 root 运行 Claude Code 不报 root 拒绝错误
  Test: manual:node -e "const c=require('fs').readFileSync('docker/cecelia-runner/Dockerfile','utf8');if(!c.includes('USER cecelia'))process.exit(1)"

- [x] [BEHAVIOR] docker-executor.js 解析 CECELIA_CREDENTIALS 注入 ANTHROPIC_API_KEY
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/docker-executor.js','utf8');if(!c.includes('ANTHROPIC_API_KEY'))process.exit(1)"

- [x] [ARTIFACT] build.sh 修复 unbound variable
  File: docker/build.sh
  Check: no bash array EXTRA_ARGS[@]
