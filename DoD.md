contract_branch: cp-harness-propose-r3-b5ac5e8a
workstream_index: 2
sprint_dir: sprints/ws1-settings-sprint-a

- [x] [ARTIFACT] `knowledge/index.ts` navGroup label 为英文 'Knowledge'
- [x] [ARTIFACT] `cecelia/index.ts` 不含独立 navGroup 声明（navGroups 数组为空或已删除）
- [x] [ARTIFACT] `execution/index.ts` 不含 navGroup label '执行'
- [x] [BEHAVIOR] knowledge navGroup label 已改为英文 'Knowledge'（'知识库' 不再出现于 navGroup 声明）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/knowledge/index.ts','utf8');const b=(c.match(/navGroups:\s*\[(.*?)\]/s)||['',''])[1];if(!c.includes(\"label: 'Knowledge'\"))process.exit(1);if(b.includes('知识库'))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] cecelia navGroups 声明已移除（id='cecelia' 消失，不新增 id='system' 声明）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/cecelia/index.ts','utf8');if(c.includes(\"id: 'cecelia'\"))process.exit(1);if((c.match(/navGroups:\s*\[([\s\S]*?)\]/)||['',''])[1].includes(\"id: 'system'\"))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] cecelia navItem.group 已改为 'system'（归入 system-hub 已声明的 system 组）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/cecelia/index.ts','utf8');if(!c.includes(\"group: 'system'\"))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] execution navGroup label '执行' 已消失（不再在 navGroups 声明中）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/execution/index.ts','utf8');if(c.includes(\"label: '\\u6267\\u884c'\"))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] execution navItem.group 已改为 'system'（execution 的 navItem 归入 system 组）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/execution/index.ts','utf8');const m=(c.match(/group:\s*'system'/g)||[]);if(m.length<1)process.exit(1);console.log('OK count='+m.length)"
- [x] [BEHAVIOR] requireSuperAdmin 过滤逻辑已保留（filterNavGroups 函数仍含 requireSuperAdmin 检查）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/dashboard/src/config/navigation.config.ts','utf8');if(!c.includes('requireSuperAdmin'))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] error path — 全局无中文 navGroup label（knowledge/cecelia/execution 全部修复）
  Test: node -e "const fs=require('fs');['knowledge','cecelia','execution'].forEach(f=>{const c=fs.readFileSync('/workspace/apps/api/features/'+f+'/index.ts','utf8');const blocks=c.match(/navGroups:\s*\[([\s\S]*?)\]/g)||[];blocks.forEach(b=>{const labels=b.match(/label:\s*'([^']*)'/g)||[];labels.forEach(l=>{if(/[一-鿿]/.test(l)){console.error('FAIL:'+f);process.exit(1)}})})});console.log('OK')"
