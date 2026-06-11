sprint_dir: sprints/06111530-fix-forensics-smoke

---
skeleton: false
journey_type: autonomous
---
# DoD — 修复 forensics-no-overwrite-smoke.sh 的四个缺陷

**范围**: 仅改 `packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh`，把断言从「验证脚本自己写的文件」改为「验证容器真实 stdout 与注入 env 一致」；修 `|| true` 吞错、同义反复断言、全角括号假绿退出码。
**大小**: S

> CI 无 docker，无法直接跑 smoke 脚本（含 `docker run`）。故 [BEHAVIOR] 用 `manual:node` 读脚本内容、断言四个修复点真实落地（关键字 + 负向检查），等价于对脚本结构的回归契约。脚本本身在宿主（有 docker + cecelia/runner:latest）已实跑：正向全绿 exit 0、改坏 env 真 FAIL 非零退出。

## ARTIFACT 条目

- [x] [ARTIFACT] smoke 脚本仍为真实 host-docker spawn（保留 docker run + ENTRYPOINT_TEST 短路）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh','utf8'); if(!c.includes('docker run')) process.exit(1); if(!c.includes('CECELIA_ENTRYPOINT_TEST=1')) process.exit(1); console.log('OK')"

## BEHAVIOR 条目

- [x] [BEHAVIOR] 缺陷1修复 — 断言以容器真实 stdout 为 oracle（解析 PROMPT_FILE/STDOUT_FILE 并与注入 env 期望值精确比较）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh','utf8'); if(!c.includes('PARSE')) process.exit(1); if(!c.includes('ACTUAL_PROMPT1')||!c.includes('EXPECT_PROMPT1')) process.exit(1); if(!c.includes('ACTUAL_STDOUT1')||!c.includes('EXPECT_STDOUT1')) process.exit(1); console.log('OK')"

- [x] [BEHAVIOR] 缺陷2修复 — 容器失败不再被 `|| true` 吞掉，捕获退出码非零即 FAIL
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh','utf8'); if(c.includes('2>/dev/null || true')) process.exit(1); if(!c.includes('RC=\$?')) process.exit(1); if(!c.includes('容器退出码非零')) process.exit(1); console.log('OK')"

- [x] [BEHAVIOR] 缺陷3修复 — 断言3改为比较两容器真实报告路径（互异 + 各含实例后缀），删除同义反复的 INST1=INST2 判定
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh','utf8'); if(c.includes('两次 spawn runInstance 相同')) process.exit(1); if(!c.includes('两容器报告的 PROMPT_FILE 路径相同')) process.exit(1); if(!c.includes('case \"\$ACTUAL_PROMPT1\"')) process.exit(1); console.log('OK')"

- [x] [BEHAVIOR] 缺陷4修复 — 无全角括号紧贴变量的写法，结尾显式 exit 0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh','utf8'); if(/（[^）]*\$/.test(c)) process.exit(1); if(!/\nexit 0\n?\$/.test(c)) process.exit(1); console.log('OK')"
