---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: navGroup 标签英文化 + cecelia/execution/knowledge 归并

**范围**: 3 个 feature manifest
- `apps/api/features/knowledge/index.ts`: navGroup label `'知识库'` → `'Knowledge'`
- `apps/api/features/cecelia/index.ts`: **移除** navGroups 声明（`id: 'cecelia'`，空 label），navItem.group `'cecelia'` → `'system'`
- `apps/api/features/execution/index.ts`: **移除** navGroups 声明（`id: 'execution'`, `label: '执行'`），navItem.group `'execution'` → `'system'`

> **Issue 5 修复说明**: cecelia 不是「将 id 改为 system」而是「完全移除 navGroups 声明」，避免与 system-hub 已声明的 id='system' 产生歧义。cecelia 的路由直接引用现有 'system' 组即可（buildNavGroupsFromManifests 的 Map 机制保证第一次声明的 label 生效）。

**大小**: S（3 文件，各 3-8 行变更）
**依赖**: WS1 完成后（确认 system 组已存在）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `knowledge/index.ts` navGroup label 为英文 'Knowledge'
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/knowledge/index.ts','utf8');if(!c.includes(\"label: 'Knowledge'\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `cecelia/index.ts` 不含独立 navGroup 声明（navGroups 数组为空或已删除）
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/cecelia/index.ts','utf8');const m=c.match(/navGroups:\s*\[([\s\S]*?)\]/);if(m&&m[1].trim()!=='')process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `execution/index.ts` 不含 navGroup label '执行'
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/execution/index.ts','utf8');if(c.includes(\"label: '\\u6267\\u884c'\"))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] knowledge navGroup label 已改为英文 'Knowledge'（'知识库' 不再出现于 navGroup 声明）
  Test: manual:bash -c 'FILE=/workspace/apps/api/features/knowledge/index.ts; grep -q "label: '"'"'Knowledge'"'"'" "$FILE" || { echo "FAIL: Knowledge label 不存在"; exit 1; }; python3 -c "
c = open(\"$FILE\").read()
import re
blocks = re.findall(r\"navGroups:\\s*\\[(.*?)\\]\", c, re.DOTALL)
for b in blocks:
    if \"\\u77e5\\u8bc6\\u5e93\" in b:
        print(\"FAIL: 知识库 仍在 navGroups 声明中\")
        import sys; sys.exit(1)
print(\"OK\")
"'
  期望: OK

- [ ] [BEHAVIOR] cecelia navGroups 声明已移除（id='cecelia' 消失，不新增 id='system' 声明）
  Test: manual:bash -c 'FILE=/workspace/apps/api/features/cecelia/index.ts; python3 -c "
import re, sys
content = open(\"$FILE\").read()
blocks = re.findall(r\"navGroups:\\s*\\[(.*?)\\]\", content, re.DOTALL)
for b in blocks:
    if \"id:\" in b and b.strip():
        print(\"FAIL: cecelia navGroups 仍有 id 声明:\", b[:80])
        sys.exit(1)
print(\"OK\")
"'
  期望: OK

- [ ] [BEHAVIOR] cecelia navItem.group 已改为 'system'（归入 system-hub 已声明的 system 组）
  Test: manual:bash -c 'grep -q "group: '"'"'system'"'"'" /workspace/apps/api/features/cecelia/index.ts || { echo "FAIL: cecelia navItem.group 未改为 system"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] execution navGroup label '执行' 已消失（不再在 navGroups 声明中）
  Test: manual:bash -c 'python3 -c "
import re, sys
content = open(\"/workspace/apps/api/features/execution/index.ts\").read()
blocks = re.findall(r\"navGroups:\\s*\\[(.*?)\\]\", content, re.DOTALL)
for b in blocks:
    if \"\\u6267\\u884c\" in b:
        print(\"FAIL: 执行 仍在 navGroups 声明中\")
        sys.exit(1)
print(\"OK\")
"'
  期望: OK

- [ ] [BEHAVIOR] execution navItem.group 已改为 'system'（execution 的 navItem 归入 system 组）
  Test: manual:bash -c 'FILE=/workspace/apps/api/features/execution/index.ts; COUNT=$(grep -c "group: '"'"'system'"'"'" "$FILE"); [ "$COUNT" -ge 1 ] || { echo "FAIL: execution navItem.group 未指向 system, count=$COUNT"; exit 1; }; echo "OK count=$COUNT"'
  期望: OK

- [ ] [BEHAVIOR] requireSuperAdmin 过滤逻辑已保留（filterNavGroups 函数仍含 requireSuperAdmin 检查）
  Test: manual:bash -c 'grep -q "requireSuperAdmin" /workspace/apps/dashboard/src/config/navigation.config.ts || { echo "FAIL: filterNavGroups 中 requireSuperAdmin 检查已丢失"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — 全局无中文 navGroup label（knowledge/cecelia/execution 全部修复）
  Test: manual:bash -c 'for f in /workspace/apps/api/features/*/index.ts; do python3 -c "
import re, sys
content = open(\"$f\").read()
for block in re.findall(r\"navGroups:\\s*\\[(.*?)\\]\", content, re.DOTALL):
    # 检查中文字符出现在 label 字段
    for m in re.findall(r\"label:\\s*'\''(.*?)'\''\", block):
        if any(\"\\u4e00\" <= ch <= \"\\u9fff\" for ch in m):
            print(f\"FAIL: {\"$f\"} navGroup label 含中文: {m}\")
            sys.exit(1)
"; done; echo OK'
  期望: OK
