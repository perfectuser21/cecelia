## {VERSION}

### Skills 库推送补全（驾驶舱最后一块）

#5240 把 Skills 库纳管进了建库脚本并补了 14 列，但**推送函数没写**——`pushOpsGraph` 里只有 agents/workflows/runs。结果 Skills 库继续停在手动灌入的旧快照，新加的 14 列全空，主理人要的「DisCo 档位人工覆盖」没地方显示。

- 新增 `buildOpsSkillNotionProperties` + `pushOpsSkills`，接进 `pushOpsGraph`
- 推档位的同时**必须推判定依据**（`StageReason`）——只给档位不给理由，人没法判断该不该推翻它
- 无运行数据不发假 0（19 个 skill 里 17 个还没有阶段归因数据）；探针未知（null）不发 checkbox，因为 `false` 会被误读成「已确认没有探针」
- 人工列（`Stage`/`Owner`/`Note`/`Priority`/`Starred`）一律不推——`Stage` 正是推翻自动判定的地方

**一致性闸加第五条**：kv 里每个库都必须有对应推送函数、且该函数必须真的被调用。这条直接针对本次遗漏形态（「库纳管了但没写推送」）和 Notion 停更根因（「函数写了但挂在无人调用的死链上」），已 proven-to-fire。
