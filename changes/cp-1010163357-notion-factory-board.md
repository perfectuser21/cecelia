## Brain {VERSION} — 技能工厂看板投影 Notion + Activity「生产版本」接发布线

- 新增 Notion「技能工厂看板」（挂在「数据落脚总台账」下，迁移 543 登记 notion_projection_map，vessel=skill-factory-board，brain_table 为空）：Brain scheduler job `skill-factory-board`（60 秒调、自 gate 5 分钟）把技能工厂阶段任务（payload.stage 或【执行参数】阶段：试跑/探索/验证/沉淀/重跑/固化/退役）投影成一条流程一行：流程、树上坐标、当前阶段、skill@版本、连续通过 x/K（与工位 bin/count_streak.py 同规则，只数挂在阶段任务下的执行单与审计单；子任务读不到写「无法计数」不当 0；试跑/探索/固化/退役写「本阶段不计数」）、最近运行结果（blocked 取 result.delivery.claimed_result）、卡点一句话（失败原因第一句 + 同父任务下进行中的修复单）、裁判结论与生产版本（按树上同名流程的 Activity 汇总；未拆 Activity 如实写）、最近更新、阶段任务链接。页身份 = projection_links(target=notion-skill-factory) + 「Brain ID」列，内容指纹没变不写，没链接先按 Brain ID 认领旧页，页被删清链接重建，不重复建页。
- Activity 目录页「生产版本」接 activity_release_state：显示 `v<版本号> · 收敛过` 或 `v<版本号> · 冷启动（未收敛过）`（收敛过与 release-line.js everConverged 同口径），没有生产指针留空。
- 目录源：已有目录页但失去流程引用的 Activity 继续投影（10-10 实测 6 页老获客流程 Activity 因此「裁判结论」停在空白）。
