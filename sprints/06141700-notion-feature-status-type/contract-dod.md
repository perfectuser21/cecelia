---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Notion Feature 推送 Status 属性类型修复

**范围**: packages/brain/src/notion-push-sync.js（pushJourneyFeatures 的 Status/Kind properties 构造）+ 回归测试。不改其他 push 函数 / catch 降级逻辑。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] notion-push-sync.js feature 推送 Status 用 status 类型（非 select）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8');const m=c.match(/Status: \{ status: \{ name: f\.status/);if(!m)process.exit(1)"

- [x] [ARTIFACT] regression 测试文件含 feature Status 类型断言
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/notion-push-sync.test.js','utf8');if(!c.includes('feature Status 属性类型回归'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，autonomous — 真实 node 进程/退出码）

- [x] [BEHAVIOR] feature push 的 Status 属性是 status 类型且不含 select（防 Notion 400「Status is expected to be status」）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8');const seg=c.slice(c.indexOf('pushJourneyFeatures'),c.indexOf('pushIssues'));if(!/Status: \{ status: \{/.test(seg))process.exit(1);if(/Status: \{ select:/.test(seg))process.exit(1)"
  期望: exit 0（feature 段 Status 用 status、无 select）

- [x] [BEHAVIOR] feature 的 Kind 映射首字母大写（ability→Ability / 其余→Feature），匹配 Notion select 选项
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8');const seg=c.slice(c.indexOf('pushJourneyFeatures'),c.indexOf('pushIssues'));if(!/'ability' \? 'Ability' : 'Feature'/.test(seg))process.exit(1)"
  期望: exit 0（Kind 含小写→大写映射）

- [x] [BEHAVIOR] 回归测试断言 Status 用 status 类型（toHaveProperty('status') 且 not select）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/notion-push-sync.test.js','utf8');if(!/Status\)\.toHaveProperty\('status'\)/.test(c))process.exit(1);if(!/Status\)\.not\.toHaveProperty\('select'\)/.test(c))process.exit(1)"
  期望: exit 0（测试锁定 status 类型）
