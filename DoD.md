# DoD: 修复 capability-scanner skillStats recent_30d 缺失

- [x] [ARTIFACT] skillStats SQL 查询新增 recent_30d 计算列
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/capability-scanner.js','utf8');if(!c.includes('recent_30d'))process.exit(1);console.log('ok')"

- [x] [BEHAVIOR] failing 状态测试存在且通过（success_rate < 30%）
  Test: manual:bash -c "cd packages/brain && NODE_OPTIONS='--max-old-space-size=3072' npx vitest run src/__tests__/capability-scanner.test.js 2>&1 | tail -5"

- [x] [PRESERVE] 现有 capability-scanner 全部测试通过（9/9）
  Test: manual:bash -c "cd packages/brain && NODE_OPTIONS='--max-old-space-size=3072' npx vitest run src/__tests__/capability-scanner.test.js 2>&1 | grep 'Tests'"
