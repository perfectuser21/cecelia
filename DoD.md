contract_branch: cp-harness-propose-r3-b5ac5e8a
workstream_index: 2
sprint_dir: sprints/ws1-settings-sprint-a

- [x] [ARTIFACT] `knowledge/index.ts` navGroup label 为英文 'Knowledge'
- [x] [ARTIFACT] `cecelia/index.ts` 不含独立 navGroup 声明（navGroups 数组为空或已删除）
- [x] [ARTIFACT] `execution/index.ts` 不含 navGroup label '执行'
- [x] [BEHAVIOR] knowledge navGroup label 已改为英文 'Knowledge'（'知识库' 不再出现于 navGroup 声明）
- [x] [BEHAVIOR] cecelia navGroups 声明已移除（id='cecelia' 消失，不新增 id='system' 声明）
- [x] [BEHAVIOR] cecelia navItem.group 已改为 'system'（归入 system-hub 已声明的 system 组）
- [x] [BEHAVIOR] execution navGroup label '执行' 已消失（不再在 navGroups 声明中）
- [x] [BEHAVIOR] execution navItem.group 已改为 'system'（execution 的 navItem 归入 system 组）
- [x] [BEHAVIOR] requireSuperAdmin 过滤逻辑已保留（filterNavGroups 函数仍含 requireSuperAdmin 检查）
- [x] [BEHAVIOR] error path — 全局无中文 navGroup label（knowledge/cecelia/execution 全部修复）
