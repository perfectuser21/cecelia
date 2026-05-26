# Brain Keepalive 自动重启 DoD

## 成功标准

- Brain 挂掉后 60s 内自动拉起（launchd 60s + 15s wait ≤ 75s）
- 重启失败才发 P0 飞书告警
- state file 防止每 60s 重复重启

## DoD 条目

- [x] [ARTIFACT] `scripts/ops/brain-keepalive-check.sh` 含 auto-restart 逻辑
  Test: `manual:node -e "const c=require('fs').readFileSync('scripts/ops/brain-keepalive-check.sh','utf8');if(!c.includes('docker compose') || !c.includes('up -d node-brain'))process.exit(1)"`

- [x] [BEHAVIOR] REPO_ROOT + COMPOSE_FILE 变量存在，正确定位 docker-compose.yml
  Test: `manual:node -e "const c=require('fs').readFileSync('scripts/ops/brain-keepalive-check.sh','utf8');if(!c.includes('REPO_ROOT') || !c.includes('COMPOSE_FILE'))process.exit(1)"`

- [x] [BEHAVIOR] 脚本语法无误
  Test: `manual:bash -n scripts/ops/brain-keepalive-check.sh`

- [x] [BEHAVIOR] Docker daemon 预检存在（daemon 不可用时立即告警退出）
  Test: `manual:node -e "const c=require('fs').readFileSync('scripts/ops/brain-keepalive-check.sh','utf8');if(!c.includes('docker info'))process.exit(1)"`
