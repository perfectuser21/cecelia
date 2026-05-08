---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: 故障注入 A — Docker SIGKILL 自愈

**范围**: 实现 `sprints/harness-acceptance-v3/scripts/03-inject-docker-sigkill.sh` + `sprints/harness-acceptance-v3/lib/inject-docker-sigkill.mjs`，在 LLM_RETRY 节点跑中时 docker kill 容器，验证 W6 reject + W2 重试 + 子任务 PASS。
**大小**: M
**依赖**: Workstream 2

## ARTIFACT 条目

- [ ] [ARTIFACT] 注入脚本存在且可执行
  Test: test -x sprints/harness-acceptance-v3/scripts/03-inject-docker-sigkill.sh

- [ ] [ARTIFACT] 注入库存在且导出 `pickKillTarget` / `recordInjectionEvent` / `pollHealing`
  Test: node -e "const m=require('./sprints/harness-acceptance-v3/lib/inject-docker-sigkill.mjs');for(const k of ['pickKillTarget','recordInjectionEvent','pollHealing']){if(typeof m[k]!=='function')process.exit(1)}"

- [ ] [ARTIFACT] 脚本头含 `set -euo pipefail`
  Test: head -5 sprints/harness-acceptance-v3/scripts/03-inject-docker-sigkill.sh | grep -q 'set -euo pipefail'

- [ ] [ARTIFACT] 脚本只 kill 带 cecelia 标签的容器（防误杀 brain/postgres）
  Test: grep -E 'docker ps.*--filter.*label=cecelia' sprints/harness-acceptance-v3/scripts/03-inject-docker-sigkill.sh

- [ ] [ARTIFACT] 不允许出现裸 `docker rm -f` 或 `docker kill brain`（黑名单）
  Test: ! grep -E 'docker (rm -f|kill (brain|postgres|cecelia-brain))' sprints/harness-acceptance-v3/scripts/03-inject-docker-sigkill.sh sprints/harness-acceptance-v3/lib/inject-docker-sigkill.mjs

- [ ] [ARTIFACT] 注入事件 payload 含 `injection`、`container_id`、`node_name` 字段
  Test: grep -E "injection.*container_id.*node_name|node_name.*container_id.*injection" sprints/harness-acceptance-v3/lib/inject-docker-sigkill.mjs

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `sprints/w8-langgraph-v3/tests/ws3/inject-docker-sigkill.test.ts`，覆盖：
- `pickKillTarget(containers)` 输入空数组时抛错；输入合法 LLM_RETRY 容器时返回首个
- `pickKillTarget(containers)` 拒绝 brain/postgres/cecelia-brain 等基础设施容器（白名单 only）
- `recordInjectionEvent({taskId, containerId, nodeName})` 写入 payload schema 严格匹配 spec
- `pollHealing({taskId, sinceEpoch, maxRetries:3})` 在 retry_count 超过 3 时返回 `{ok:false, reason:'retry_exhausted'}`
