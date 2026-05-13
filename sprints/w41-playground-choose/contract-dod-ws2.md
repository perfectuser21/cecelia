---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 单测（describe GET /choose）+ README 更新

**范围**: `playground/tests/server.test.js` 新增完整 describe('GET /choose') 块；`playground/README.md` 补 /choose 端点文档
**大小**: M(100-300行)
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含 `describe('GET /choose'` 块
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/tests/server.test.js','utf8');if(!c.includes(\"describe('GET /choose'\"))process.exit(1)"

- [ ] [ARTIFACT] `playground/tests/server.test.js` 含 k=0 oracle 的显式断言（choose(5,0)===1 / choose(0,0)===1 / choose(20,0)===1）
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/tests/server.test.js','utf8');const has50=c.includes('n=5')&&c.includes('k=0');const has00=c.includes('n=0')&&c.includes('k=0');const has200=c.includes('n=20')&&c.includes('k=0');if(!has50||!has00||!has200)process.exit(1)"

- [ ] [ARTIFACT] `playground/README.md` 包含 `/choose` 端点文档
  Test: node -e "const c=require('fs').readFileSync('/workspace/playground/README.md','utf8');if(!c.includes('/choose'))process.exit(1)"

## BEHAVIOR 条目（W41 核心 oracle，内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] W41 核心 oracle：GET /choose?n=5&k=0 返 {"choose": 1}（C(5,0)=1，依赖 0!=1，round 1 generator 极易在此失败）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3021 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3021/choose?n=5&k=0"); R=$(echo "$RESP" | jq -e ".choose == 1" && echo OK); kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] W41 核心 oracle：GET /choose?n=0&k=0 返 {"choose": 1}（C(0,0)=1，0! 基底最小边界）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3022 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3022/choose?n=0&k=0"); R=$(echo "$RESP" | jq -e ".choose == 1" && echo OK); kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] W41 核心 oracle：GET /choose?n=20&k=0 返 {"choose": 1}（C(20,0)=1，0! 基底上界验证）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3023 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3023/choose?n=20&k=0"); R=$(echo "$RESP" | jq -e ".choose == 1" && echo OK); kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] k=n 对称 oracle：GET /choose?n=5&k=5 返 {"choose": 1}（分母含 0!，与 k=0 对称）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3024 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3024/choose?n=5&k=5"); R=$(echo "$RESP" | jq -e ".choose == 1" && echo OK); kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 精度上界 oracle：GET /choose?n=20&k=10 返 {"choose": 184756}（C(20,10)，结果远低于 MAX_SAFE_INTEGER）
  Test: manual:bash -c 'cd /workspace/playground && PLAYGROUND_PORT=3025 node server.js & SPID=$!; sleep 2; RESP=$(curl -fs "localhost:3025/choose?n=20&k=10"); R=$(echo "$RESP" | jq -e ".choose == 184756" && echo OK); kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; [ "$R" = "OK" ]'
  期望: exit 0
