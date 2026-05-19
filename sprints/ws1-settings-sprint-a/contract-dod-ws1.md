---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: Settings 独立 navItem 注册

**范围**: `apps/api/features/system-hub/index.ts` 单文件
- 从 System tab `children` 数组移除 `{ path: '/settings', label: '设置', icon: 'Settings', order: 20 }`
- 给 `/settings` 路由（原已有 component: SettingsLayout）添加独立 navItem：
  `{ label: 'Settings', icon: 'Settings', group: 'system', order: 20 }`

**大小**: S（< 20 行变更，1 文件）
**依赖**: 无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/features/system-hub/index.ts` 包含英文 `label: 'Settings'` 字段
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/system-hub/index.ts','utf8');if(!c.includes(\"label: 'Settings'\"))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/api/features/system-hub/index.ts` 不再包含中文 `label: '设置'`
  Test: node -e "const c=require('fs').readFileSync('/workspace/apps/api/features/system-hub/index.ts','utf8');if(c.includes(\"label: '\\u8bbe\\u7f6e'\"))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] `/settings` 路由在 system-hub manifest 中有独立 navItem 字段（navItem.group = 'system'）
  Test: manual:bash -c 'python3 -c "
import re, sys
content = open(\"/workspace/apps/api/features/system-hub/index.ts\").read()
# 匹配: path: '"'"'/settings'"'"', ... navItem: { label: '"'"'Settings'"'"', ... group: '"'"'system'"'"' ... }
pattern = r\"path:\\s*'"'"'/settings'"'"'[^}]+navItem\\s*:\"
if not re.search(pattern, content, re.DOTALL):
    print(\"FAIL: /settings 无独立 navItem\")
    sys.exit(1)
print(\"OK\")
"'
  期望: OK

- [ ] [BEHAVIOR] Settings navItem label 为英文 'Settings'（非中文 '设置'）
  Test: manual:bash -c 'FILE=/workspace/apps/api/features/system-hub/index.ts; grep -q "label: '"'"'Settings'"'"'" "$FILE" || { echo "FAIL: label 不含 Settings"; exit 1; }; ! grep -q "label: '"'"'\xe8\xae\xbe\xe7\xbd\xae'"'"'" "$FILE" || { echo "FAIL: 中文 设置 仍存在"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 旧中文 '设置' 已从 system-hub 全文移除（children 数组和任何位置）
  Test: manual:bash -c 'python3 -c "
content = open(\"/workspace/apps/api/features/system-hub/index.ts\").read()
if chr(8) in content:
    pass
if \"\\u8bbe\\u7f6e\" in content:
    print(\"FAIL: 中文 设置 仍存在于 system-hub\")
    import sys; sys.exit(1)
print(\"OK\")
"'
  期望: OK

- [ ] [BEHAVIOR] /settings 路由的 navItem.group 指向已存在的 'system' 组（不新增额外 navGroup 声明）
  Test: manual:bash -c 'FILE=/workspace/apps/api/features/system-hub/index.ts; COUNT=$(grep -c "group: '"'"'system'"'"'" "$FILE"); [ "$COUNT" -ge 1 ] || { echo "FAIL: /settings navItem.group 未指向 system"; exit 1; }; echo "OK group=system count=$COUNT"'
  期望: OK

- [ ] [BEHAVIOR] SettingsLayout 组件注册于 manifest components（import 路径指向 dashboard 包）
  Test: manual:bash -c 'grep "SettingsLayout" /workspace/apps/api/features/system-hub/index.ts | grep -q "import" || { echo "FAIL: SettingsLayout import 未注册"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — TypeScript 编译 apps/dashboard 无新增错误
  Test: manual:bash -c 'cd /workspace/apps/dashboard && npx tsc --noEmit 2>&1 | grep -c "error TS" | xargs sh -c '"'"'[ $0 -eq 0 ] && echo OK || { echo "FAIL: TS errors=$0"; exit 1; }'"'"''
  期望: OK
