# DoD: 修 detect-review-issues.js 对"未发现需要标记为🔴的严重问题"的误判

- [x] [ARTIFACT] noIssuesDeclared 新增 "未/没有 发现 (0-40字) 严重问题" 松散匹配
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/devgate/detect-review-issues.js','utf8');if(!/\\(未\\|没有\\)发现/.test(c))process.exit(1);if(!/\\[\\\\s\\\\S\\]\\{0,40\\}严重问题/.test(c))process.exit(2);console.log('PASS')"

- [x] [BEHAVIOR] 7 条单元测试覆盖 真实🔴/未发现/没有发现/中间有字符 等句式
  Test: packages/engine/tests/scripts/detect-review-issues.test.ts
