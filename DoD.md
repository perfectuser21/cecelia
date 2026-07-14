# DoD: pre-swap 核心 smoke 容器内 jq 缺失致 4 连假红——四脚本 node 兜底 shim

- [x] [BEHAVIOR] 四条核心 smoke 在无 jq 环境全绿（node shim 兜底）
      Test: manual:bash -c "mkdir -p /tmp/nojq-bin && for b in bash curl node grep cat printf dirname date; do ln -sf \$(command -v \$b) /tmp/nojq-bin/ 2>/dev/null; done; env PATH=/tmp/nojq-bin BRAIN_URL=http://localhost:5221 bash packages/brain/scripts/smoke/harness-ping-smoke.sh"
- [x] [BEHAVIOR] 有 jq 环境行为不变（shim 仅在 jq 缺失时定义）
      Test: manual:node -e "const s=require('fs').readFileSync('packages/brain/scripts/smoke/healthz-smoke.sh','utf8');if(!s.includes('command -v jq'))process.exit(1)"
- [x] 四脚本 bash -n 语法绿
      Test: manual:bash -c "for f in healthz-smoke version-endpoint-smoke harness-ping-smoke harness-echo-smoke; do bash -n packages/brain/scripts/smoke/\$f.sh || exit 1; done"
