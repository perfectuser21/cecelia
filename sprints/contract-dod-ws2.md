# Contract DoD — Workstream 2: integration 与 smoke 测试覆盖

- [ ] [ARTIFACT] `critical-routes.integration.test.js` 与 `golden-path.integration.test.js` 均包含 `docker_runtime` 关键字的新增断言
  Test: node -e "const fs=require('fs'); const p1='packages/brain/src/__tests__/integration/critical-routes.integration.test.js'; const p2='packages/brain/src/__tests__/integration/golden-path.integration.test.js'; if(!/docker_runtime/.test(fs.readFileSync(p1,'utf8')))throw new Error('FAIL: '+p1); if(!/docker_runtime/.test(fs.readFileSync(p2,'utf8')))throw new Error('FAIL: '+p2); console.log('PASS')"
- [ ] [ARTIFACT] 三种状态（healthy / unhealthy / disabled）均在 integration 测试中有字面量覆盖
  Test: node -e "const fs=require('fs'); const c=fs.readFileSync('packages/brain/src/__tests__/integration/critical-routes.integration.test.js','utf8')+fs.readFileSync('packages/brain/src/__tests__/integration/golden-path.integration.test.js','utf8'); ['healthy','unhealthy','disabled'].forEach(s=>{if(!new RegExp(\"['\\\"\`]\"+s+\"['\\\"\`]\").test(c))throw new Error('FAIL miss '+s)}); console.log('PASS')"
- [ ] [BEHAVIOR] brain integration 测试（critical-routes 与 golden-path）全部通过，零回归
  Test: cd packages/brain && npm test -- --testPathPattern='(critical-routes|golden-path)\.integration' 2>&1 | tail -5 && [ "${PIPESTATUS[0]}" = "0" ] && echo PASS || (echo FAIL; exit 1)
