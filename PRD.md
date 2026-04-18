# PRD: Docker Runner 非 root + 凭据注入

## 背景
Docker executor (PR #2384) 容器以 root 运行，Claude Code 拒绝 root + `--dangerously-skip-permissions` 组合，导致所有 Docker 任务立即退出 (exit 1, 440ms)。同时容器内无 API key，即使解决 root 问题也会 401。

## 成功标准

- Docker 容器以非 root 用户运行 Claude Code
- API key 通过 -e 或 CLAUDE_CONFIG_DIR 注入容器
- build.sh 在 `set -u` 下正常工作
