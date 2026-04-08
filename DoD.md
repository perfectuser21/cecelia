# DoD: Test KR for decomp — 验证交付

**分支**: cp-04080726-ba5dd980-c113-4571-a1b2-147e6a

- [x] [ARTIFACT] `docs/learnings/cp-04080726-test-kr-decomp-verification.md` 文件存在（验证报告）
  - Test: `manual:node -e "require('fs').accessSync('docs/learnings/cp-04080726-test-kr-decomp-verification.md')"`

- [x] [ARTIFACT] `decomposition-checker.js` Check A 不再查询 `ready` 状态 KR
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/decomposition-checker.js','utf8');if(c.includes(\"status IN ('pending', 'ready')\"))process.exit(1)"`

- [x] [BEHAVIOR] checkPendingKRs 不为 `ready` 状态的 KR 创建拆解任务
  - Test: `tests/decomposition-checker-ready-kr.test.js`
