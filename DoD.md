# DoD: brain-image-docker-compose-plugin

## 概述
PR #2789 log 落盘后看清 webhook deploy 永久失败的真根因：Brain image 内 docker CLI
缺 compose subcommand → brain-deploy.sh 调 `docker compose -f docker-compose.yml up -d`
报 "unknown shorthand flag: 'f' in -f"。修：apk add docker-cli-compose。

## 验收

- [x] [BEHAVIOR] Dockerfile apk add 行含 docker-cli-compose
  Test: manual:bash packages/engine/tests/integration/brain-image-docker-compose.test.sh

- [x] [BEHAVIOR] docker-cli + docker-cli-compose 同一 apk add（共享 layer）
  Test: manual:bash packages/engine/tests/integration/brain-image-docker-compose.test.sh

- [x] [BEHAVIOR] docker-cli-compose 在 runtime stage 不在 deps stage
  Test: manual:bash packages/engine/tests/integration/brain-image-docker-compose.test.sh

- [x] [BEHAVIOR] 真 build image 后 docker compose version 可执行（BUILD_IMAGE=1 本地验证 4/4 pass）
  Test: manual:bash packages/engine/tests/integration/brain-image-docker-compose.test.sh

- [x] [ARTIFACT] Dockerfile 含 docker-cli-compose
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/Dockerfile','utf8'); if (!c.includes('docker-cli-compose')) process.exit(1)"

- [x] [ARTIFACT] 新建 brain-image-docker-compose.test.sh
  Test: manual:node -e "require('fs').accessSync('packages/engine/tests/integration/brain-image-docker-compose.test.sh')"
