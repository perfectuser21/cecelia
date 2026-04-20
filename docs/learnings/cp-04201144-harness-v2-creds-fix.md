# Harness v2 凭据注入 fix
### 根本原因
harness-initiative-runner 调 Docker 时 env 对象没传 CECELIA_CREDENTIALS。Docker executor 依据这个字段挂 ~/.claude-accountN 凭据目录，没值就不挂，Claude CLI 容器内启动失败。
### 下次预防
- [ ] Docker executor 调用方必须传 CECELIA_CREDENTIALS（或已挂 CLAUDE_CONFIG_DIR）
- [ ] 加 integration test 验证 runner 调 Docker 时凭据字段齐全
