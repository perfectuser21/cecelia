---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: 编写并运行 B37 验证脚本

**范围**: 在 `sprints/w49-b37-validation/` 创建 `verify-b37.sh` 验证脚本，验证 parsePrdNode git diff 逻辑生效
**大小**: S(<100行)
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w49-b37-validation/verify-b37.sh` 存在且含 4 项断言
  Test: node -e "const c=require('fs').readFileSync('sprints/w49-b37-validation/verify-b37.sh','utf8');if(!c.includes('w49-b37-validation'))process.exit(1);if((c.match(/PASS/g)||[]).length<4)process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `sprints/w49-b37-validation/sprint-prd.md` 存在（planner 产出，B37 起点）
  Test: node -e "require('fs').accessSync('sprints/w49-b37-validation/sprint-prd.md');console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，禁止只索引 vitest）

- [ ] [BEHAVIOR] git diff --name-only origin/main HEAD -- sprints/ 输出含 sprints/w49-b37-validation/
  Test: manual:bash -c 'DIFF_OUT=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null); echo "$DIFF_OUT" | grep -q "sprints/w49-b37-validation/" && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] sprint-prd.md 存在于 sprints/w49-b37-validation/（planner 写入正确路径）
  Test: manual:bash -c 'test -f sprints/w49-b37-validation/sprint-prd.md && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] verify-b37.sh 可执行并输出成功摘要（git diff 断言通过）
  Test: manual:bash -c 'bash sprints/w49-b37-validation/verify-b37.sh 2>&1 | grep -q "git diff 找到正确 sprint 目录" && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] Brain Docker 日志无 ENOENT 关联 w49-b37-validation（全程无目录查找失败）
  Test: manual:bash -c 'COUNT=$(docker logs cecelia-brain 2>&1 | grep -c "ENOENT.*w49-b37-validation\|w49-b37-validation.*ENOENT" || echo 0); [ "${COUNT:-0}" -eq 0 ] && echo OK || exit 1'
  期望: OK
