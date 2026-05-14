---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: 创建 verify-b37.sh 验证脚本

**范围**: 在 `sprints/w49-b37-validation/` 创建 `verify-b37.sh` 脚本，验证 B37 git diff 逻辑全链路生效
**大小**: S(<100行)
**依赖**: 无

## ARTIFACT 条目（预条件 + Generator 产出物）

- [ ] [ARTIFACT] `sprints/w49-b37-validation/sprint-prd.md` 存在（planner 产出，B37 起点预条件）
  Test: node -e "require('fs').accessSync('sprints/w49-b37-validation/sprint-prd.md');console.log('OK')"

- [ ] [ARTIFACT] git diff --name-only 含 sprints/w49-b37-validation/（parsePrdNode B37 fix 生效预条件）
  Test: bash -c 'DIFF_OUT=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null); echo "$DIFF_OUT" | grep -q "sprints/w49-b37-validation/" && echo OK || exit 1'

- [ ] [ARTIFACT] `sprints/w49-b37-validation/verify-b37.sh` 存在且含 ≥4 个 ✅ PASS 标记
  Test: node -e "const c=require('fs').readFileSync('sprints/w49-b37-validation/verify-b37.sh','utf8');const n=(c.match(/✅ PASS/g)||[]).length;if(n<4){console.error('PASS 标记不足:',n);process.exit(1)}console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，Evaluator 直接执行）

- [ ] [BEHAVIOR] sprint-contract.md 存在于 sprints/w49-b37-validation/（sprintDir 正确传递的证明）
  Test: manual:bash -c 'test -f sprints/w49-b37-validation/sprint-contract.md && echo OK || { echo "FAIL: sprint-contract.md 缺失，sprintDir 可能漂移"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] verify-b37.sh 存在于 sprints/w49-b37-validation/（Generator 创建验证脚本）
  Test: manual:bash -c 'test -f sprints/w49-b37-validation/verify-b37.sh && echo OK || { echo "FAIL: verify-b37.sh 缺失"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] verify-b37.sh 可执行并输出成功摘要（bash exit 0，4 项断言全过）
  Test: manual:bash -c 'bash sprints/w49-b37-validation/verify-b37.sh 2>&1 | grep -q "B37 验证全部通过" && echo OK || { echo "FAIL: verify-b37.sh 运行失败或未输出成功摘要"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] Brain Docker 日志无 ENOENT 关联 w49-b37-validation（全程无目录查找失败）
  Test: manual:bash -c 'COUNT=$(docker logs cecelia-brain 2>&1 | grep -c "ENOENT.*w49-b37-validation\|w49-b37-validation.*ENOENT" 2>/dev/null || echo 0); [ "${COUNT:-0}" -eq 0 ] && echo OK || { echo "FAIL: 发现 $COUNT 条 ENOENT"; exit 1; }'
  期望: OK
