---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: inbox 合并入 dashboard（分组数缩减至 ≤ 5）

**范围**: 单文件 `apps/api/features/inbox/index.ts`
- 移除 `navGroups: [{ id: 'inbox', label: 'Inbox', icon: 'Inbox', order: 1.5 }]` 声明
- 将 inbox 路由的 `navItem.group: 'inbox'` → `navItem.group: 'dashboard'`

合并后 inbox 条目归入 dashboard 分组（dashboard 已由 dashboard/index.ts 声明，order: 1）。

**大小**: S（< 10 行变更，1 文件）
**依赖**: 无（可与 WS1/WS2 并行）

---

## ARTIFACT 条目

- [x] [ARTIFACT] `inbox/index.ts` 不含 `{ id: 'inbox'` navGroup 声明
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/inbox/index.ts','utf8');if(c.includes(\"{ id: 'inbox'\"))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] `inbox/index.ts` 含 navItem.group 值 'dashboard'
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/inbox/index.ts','utf8');if(!c.includes(\"group: 'dashboard'\"))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [x] [BEHAVIOR] inbox navGroup 独立声明已移除（navGroups 数组为空或已删除）
  Test: manual:bash -c 'python3 -c "
import re, sys
content = open(\"/workspace/apps/api/features/inbox/index.ts\").read()
blocks = re.findall(r\"navGroups:\\s*\\[(.*?)\\]\", content, re.DOTALL)
for b in blocks:
    if \"id:\" in b and b.strip():
        print(\"FAIL: inbox navGroups 仍有 id 声明\")
        sys.exit(1)
print(\"OK\")
"'
  期望: OK

- [x] [BEHAVIOR] inbox navItem.group 已改为 'dashboard'（条目归入 dashboard 分组）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/inbox/index.ts','utf8');if(!c.includes(\"group: 'dashboard'\"))process.exit(1);console.log('OK')"
  期望: OK

- [x] [BEHAVIOR] 合并后全局 navGroup 唯一 id 数量 ≤ 5（WS1+WS2+WS3 全部完成后）
  Test: manual:bash -c 'python3 -c "
import re, glob, sys
ids = set()
for path in glob.glob(\"/workspace/apps/api/features/*/index.ts\"):
    content = open(path).read()
    for block in re.findall(r\"navGroups:\\s*\\[(.*?)\\]\", content, re.DOTALL):
        for id_val in re.findall(r\"id:\\s*'"'"'([\\w-]+)'"'"'\", block):
            ids.add(id_val)
count = len(ids)
print(f\"navGroup unique count={count}: {sorted(ids)}\")
if count > 5:
    print(f\"FAIL: count={count} > 5\")
    sys.exit(1)
print(\"OK\")
"'
  期望: OK

- [x] [BEHAVIOR] inbox navGroup id='inbox' 已不在任何 manifest navGroups 声明中出现
  Test: node -e "const fs=require('fs');const path=require('path');const dir='/workspace/apps/api/features';fs.readdirSync(dir).forEach(f=>{const fp=path.join(dir,f,'index.ts');if(!fs.existsSync(fp))return;const c=fs.readFileSync(fp,'utf8');if(c.includes(\"id: 'inbox'\")){console.error('FAIL: '+fp);process.exit(1)}});console.log('OK')"
  期望: OK

- [x] [BEHAVIOR] error path — TypeScript 编译无新增错误（inbox 修改不破坏类型）
  Test: node -e "const {execSync}=require('child_process');try{execSync('npx tsc --noEmit',{cwd:'/workspace/apps/dashboard',stdio:'pipe'})}catch(e){const out=(e.stdout||Buffer.from('')).toString()+(e.stderr||Buffer.from('')).toString();const n=(out.match(/error TS/g)||[]).length;if(n>0){process.stderr.write('FAIL: TS errors='+n+'\n');process.exit(1)}}console.log('OK')"
  期望: OK
