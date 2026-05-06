# Contract DoD — Workstream 3: F2 评估好坏（verifyKRMovement 三态）

**范围**: 在 `kr-verifier.js` 新增 `verifyKRMovement(taskId)` 异步函数，返回 `{kr_id, before, after, moved}` 三态结构。
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/kr-verifier.js` 命名导出 `verifyKRMovement`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/kr-verifier.js','utf8');if(!/export\s+(async\s+)?function\s+verifyKRMovement\b/.test(c)&&!/export\s*\{[^}]*\bverifyKRMovement\b/.test(c))process.exit(1)"

- [ ] [ARTIFACT] kr-verifier.js 中 verifyKRMovement 注释或实现含三态关键字（true/false/null）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/kr-verifier.js','utf8');const slice=c.split(/verifyKRMovement/)[1]||'';if(!/true/.test(slice)||!/false/.test(slice)||!/null/.test(slice))process.exit(1)"

- [ ] [ARTIFACT] 返回结构形态字符串出现在源文件中（kr_id / before / after / moved 四个 key）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/kr-verifier.js','utf8');for(const k of ['kr_id','before','after','moved']){if(!new RegExp('\\\\b'+k+'\\\\b').test(c))process.exit(1)}"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/verify-kr-movement.test.ts`，覆盖：
- kr-verifier.js 导出 verifyKRMovement
- after > before → moved=true（before=50, after=51 → moved=true）
- after === before → moved=false（before=50, after=50 → moved=false）
- task 无 kr_id → moved=null, before=null, after=null
- 返回对象 keys 严格为 [kr_id, before, after, moved] 四个，无多余字段
- before 与 after 在有 kr_id 时类型均为 number
