contract_branch: cp-harness-propose-r3-b5ac5e8a
workstream_index: 2
sprint_dir: sprints/ws1-settings-sprint-a

---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: navGroup 标签英文化 + cecelia/execution/knowledge 归并

**范围**: 3 个 feature manifest
- `apps/api/features/knowledge/index.ts`: navGroup label `'知识库'` → `'Knowledge'`
- `apps/api/features/cecelia/index.ts`: **移除** navGroups 声明（`id: 'cecelia'`，空 label），navItem.group `'cecelia'` → `'system'`
- `apps/api/features/execution/index.ts`: **移除** navGroups 声明（`id: 'execution'`, `label: '执行'`），navItem.group `'execution'` → `'system'`

BEHAVIOR 条目:
- [BEHAVIOR] knowledge navGroup label='Knowledge'，不含中文 '知识库'
- [BEHAVIOR] cecelia navGroups 声明已移除（navGroups 数组为空），navItem.group='system'
- [BEHAVIOR] execution navGroups 声明已移除，navItem.group='system'
- [BEHAVIOR] requireSuperAdmin 过滤逻辑仍在 filterNavGroups 函数中
- [ARTIFACT] 全局无中文 navGroup label
