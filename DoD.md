# DoD: N3 harness skill-relay 最小接线

sprint_dir: sprints/07041621-harness-skill-relay-wiring

- [x] [BEHAVIOR] 双轨路由：payload.orchestrator='skill-relay' 走 relay 分支，缺省走原图（零行为变化）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!/isSkillRelayTask/.test(c)||!/spawnSkillRelaySession/.test(c))process.exit(1)"
- [x] [BEHAVIOR] relay 分支 spawn 的 prompt 含 harness-controller skill 全文 inline + 上下文头
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-skill-relay.js','utf8');if(!/loadSkill.*harness-controller/s.test(c)||!/HARNESS_TASK_ID/.test(c))process.exit(1)"
- [x] [BEHAVIOR] judge-cli 存在且 exit 语义（0=PASS/2=FAIL/1=错误）+ FIXED 归一
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/harness-judge-cli.mjs','utf8');if(!/runJudgeGate/.test(c)||!/FIXED/.test(c))process.exit(1)"
- [x] [ARTIFACT] 配对测试 + smoke 脚本在 repo
  Test: manual:node -e "const fs=require('fs');for(const f of ['packages/brain/src/__tests__/harness-skill-relay.test.js','packages/brain/src/__tests__/harness-judge-cli.test.js','packages/brain/scripts/smoke/skill-relay-smoke.sh'])if(!fs.existsSync(f))process.exit(1)"
