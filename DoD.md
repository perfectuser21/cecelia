# DoD: bluegreen 金丝雀探活/smoke 容器视角 localhost 假红——CANARY_HOST 修复

- [x] [BEHAVIOR] bluegreen.sh 探活与 smoke 目标主机可配置：容器内(/.dockerenv)默认 host.docker.internal，宿主默认 localhost，CANARY_HOST 可覆盖
      Test: manual:bash scripts/__tests__/bluegreen-canary-host.test.sh
- [x] [BEHAVIOR] 不再存在写死 http://localhost:${port} 的金丝雀地址
      Test: manual:bash -c "! grep -n 'http://localhost:\${port}' scripts/lib/bluegreen.sh"
- [x] bluegreen.sh 语法有效
      Test: manual:bash -n scripts/lib/bluegreen.sh
