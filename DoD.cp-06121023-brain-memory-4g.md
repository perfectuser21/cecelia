# DoD: Brain 容器内存上限 1G → 4G

## Artifacts

- [x] [ARTIFACT] `docker-compose.yml` brain 服务 `deploy.resources.limits.memory` 为 4G
  - Test: `manual:node -e "const c=require('fs').readFileSync('docker-compose.yml','utf8');if(!/memory:\s*4G/.test(c))process.exit(1)"`

## Behaviors

- [x] [BEHAVIOR] brain 服务 standalone 生效的 `mem_limit` 为 4g 且配比注释存在
  - Test: `manual:node -e "const c=require('fs').readFileSync('docker-compose.yml','utf8');if(!/mem_limit:\s*4g/.test(c))process.exit(1);if(!c.includes('max-old-space-size=3072'))process.exit(1)"`

- [x] [BEHAVIOR] staging brain（同镜像同 3072 堆）内存 cap 已对齐到 4G
  - Test: `manual:node -e "const c=require('fs').readFileSync('docker-compose.staging.yml','utf8');if(!/memory:\s*4G/.test(c))process.exit(1)"`
