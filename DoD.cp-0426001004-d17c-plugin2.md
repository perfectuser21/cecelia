# DoD: cp-0426001004-d17c-plugin2

- [x] [BEHAVIOR] 4 plugin 文件存在且各 export tick；Test: manual:node -e "for (const m of ['pipeline-patrol-plugin','pipeline-watchdog-plugin','kr-health-daily-plugin','cleanup-worker-plugin']) { try { const x=require(\`./packages/brain/src/\${m}.js\`); if(typeof x.tick!=='function') process.exit(1); } catch(e) { process.exit(1); } }"
- [x] [BEHAVIOR] tick-runner.js 4 处 wire；Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');const ms=['pipelinePatrolPlugin','pipelineWatchdogPlugin','krHealthDailyPlugin','cleanupWorkerPlugin'];for(const m of ms){if(!c.includes(m))process.exit(1)}"
- [x] [BEHAVIOR] 4 个新 plugin 单测全 pass；Test: tests/pipeline-patrol-plugin.test.js
- [x] [BEHAVIOR] tick-state / cleanup-worker / pipeline-watchdog 老测试不破坏；Test: tests/tick-state.test.js
- [x] [ARTIFACT] 4 plugin 文件存在；Test: manual:node -e "['pipeline-patrol-plugin','pipeline-watchdog-plugin','kr-health-daily-plugin','cleanup-worker-plugin'].forEach(m=>require('fs').accessSync(\`packages/brain/src/\${m}.js\`))"
