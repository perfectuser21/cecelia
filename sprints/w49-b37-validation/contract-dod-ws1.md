---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: 创建 verify-b37.sh 验证脚本

**范围**: 在 `sprints/w49-b37-validation/` 创建 `verify-b37.sh`，含 ≥4 断言，脚本运行 exit 0 输出 "B37 验证全部通过"
**大小**: S(<100行)
**依赖**: 无（sprint-prd.md 由 Planner 提前创建，sprint-contract.md 由 Proposer 提前创建）

## ARTIFACT 条目（预条件 + Generator 产出物）

- [ ] [ARTIFACT] `sprints/w49-b37-validation/sprint-prd.md` 存在（planner 产出，验证起点预条件）
  Test: node -e "require('fs').accessSync('sprints/w49-b37-validation/sprint-prd.md');console.log('OK')"

- [ ] [ARTIFACT] `sprints/w49-b37-validation/sprint-contract.md` 存在（proposer 产出，parsePrdNode B37 fix 生效的直接证明）
  Test: node -e "require('fs').accessSync('sprints/w49-b37-validation/sprint-contract.md');console.log('OK')"

- [ ] [ARTIFACT] `sprints/w49-b37-validation/verify-b37.sh` 存在且含 ≥4 条 `✅ PASS` 标记（generator 产出）
  Test: node -e "const c=require('fs').readFileSync('sprints/w49-b37-validation/verify-b37.sh','utf8');const n=(c.match(/✅ PASS/g)||[]).length;if(n<4){console.error('PASS 标记不足:',n);process.exit(1)}console.log('OK')"

## BEHAVIOR 条目（内嵌可独立执行的 manual:bash 命令，evaluator 直接执行，禁止只索引 vitest）

- [ ] [BEHAVIOR] `git diff --name-only origin/main HEAD -- sprints/` 输出含 `sprints/w49-b37-validation/` 路径（B37 git diff 逻辑运行时验证）
  Test: manual:bash -c 'DIFF_OUT=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null); echo "$DIFF_OUT" | grep -q "sprints/w49-b37-validation/" && echo OK || { echo "FAIL: git diff 未找到目标路径，输出: $DIFF_OUT"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] `bash verify-b37.sh` exit 0 且 stdout 含 "B37 验证全部通过"（全链路运行时验证）
  Test: manual:bash -c 'OUTPUT=$(bash sprints/w49-b37-validation/verify-b37.sh 2>&1); echo "$OUTPUT" | grep -q "B37 验证全部通过" && echo OK || { echo "FAIL: 输出未含预期字符串"; echo "$OUTPUT"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] `bash verify-b37.sh` 输出 ≥4 条 `✅ PASS` 断言（脚本覆盖全部关键检查点）
  Test: manual:bash -c 'COUNT=$(bash sprints/w49-b37-validation/verify-b37.sh 2>&1 | grep -c "✅ PASS" || echo 0); [ "${COUNT}" -ge 4 ] && echo OK || { echo "FAIL: PASS 断言不足 4 条，实际 $COUNT"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] Brain Docker 日志（动态查找容器名）无 ENOENT 关联 w49-b37-validation（全程无目录查找失败）
  Test: manual:bash -c 'BRAIN_CTR=$(docker ps --filter name=brain --format "{{.Names}}" | head -1); if [ -z "$BRAIN_CTR" ]; then echo "SKIP: brain 容器未运行"; exit 0; fi; COUNT=$(docker logs "$BRAIN_CTR" 2>&1 | grep -c "ENOENT.*w49-b37-validation\|w49-b37-validation.*ENOENT" || echo 0); [ "${COUNT:-0}" -eq 0 ] && echo OK || { echo "FAIL: $COUNT 条 ENOENT"; exit 1; }'
  期望: OK（或 SKIP 若容器未运行）
