# Contract DoD — Workstream 1: PRD Presence Validator

**范围**: 在 `sprints/validators/prd-presence.mjs` 实现 `checkSprintPrdPresence(path)`，返回 `{ok, size?, lines?, reason?}` 形态值，不抛异常。
**大小**: S（< 100 行实现）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 文件存在
  Test: node -e "const fs=require('fs');fs.accessSync('sprints/sprint-prd.md');console.log('PASS:exists')"

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 字节数 > 0
  Test: node -e "const s=require('fs').statSync('sprints/sprint-prd.md');if(s.size<=0)throw new Error('FAIL:size='+s.size);console.log('PASS:size='+s.size)"

- [ ] [ARTIFACT] `sprints/sprint-prd.md` 行数 ≥ 50
  Test: node -e "const c=require('fs').readFileSync('sprints/sprint-prd.md','utf8');const n=c.split('\n').length;if(n<50)throw new Error('FAIL:lines='+n);console.log('PASS:lines='+n)"

- [ ] [ARTIFACT] `sprints/validators/prd-presence.mjs` 文件存在
  Test: node -e "require('fs').accessSync('sprints/validators/prd-presence.mjs');console.log('PASS:exists')"

- [ ] [ARTIFACT] `sprints/validators/prd-presence.mjs` export 名为 `checkSprintPrdPresence` 的 function
  Test: node -e "const c=require('fs').readFileSync('sprints/validators/prd-presence.mjs','utf8');if(!/export\s+(async\s+)?function\s+checkSprintPrdPresence\b/.test(c)&&!/export\s*\{\s*[^}]*\bcheckSprintPrdPresence\b[^}]*\}/.test(c))throw new Error('FAIL:no export checkSprintPrdPresence');console.log('PASS:export found')"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/prd-presence.test.ts`，覆盖：
- returns ok=true with size and lines for the real sprint PRD
- returns ok=false with reason=missing when path does not exist, instead of throwing
- returns ok=false with reason=empty when the file exists but is zero bytes
