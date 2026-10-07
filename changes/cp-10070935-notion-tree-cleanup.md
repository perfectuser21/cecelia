## Brain {VERSION} — Notion 六层目录库清理：只留 Brain 列与登记人工列，旧写入方断开，价值流由目录接管，流程运行列改用 runs

- 规矩：Notion 部门/价值流/能力/流程/Activity/Step 六库每一列要么来自 Brain（原样或派生：分组·*、树位置、运行统计），要么是登记过的人工列（部门库 PARA 关系与名称/上下级/归档、流程库「你的标记」）；两样都不是就删。列合同 `directory-schema.js` 带每列来源表 `DIRECTORY_COLUMN_SOURCES` 与人工列登记 `DIRECTORY_HUMAN_COLUMNS`
- 目录投影不再建/写：真身来源、责任主体、分组·子部门（全部库）；部门 Key；流程 Trigger/Input/Output/执行策略/Activity 数/定时任务数/启用任务数/近7天有跑/失败任务数/静默任务数/步骤级运行次数/旧功能状态（及 4 条恒定的 *_undeclared 缺口）；Activity 使用位置（及 contract_missing 缺口）
- 新写：流程 7天次数/7天失败/7天成功率/平均时长(秒)（v_workflow_run_stats 7d），在用吗/最近运行同时看 runs 与闹钟总账；活动编排改为按引用顺序列 Activity 名字；Activity Key（能力.活动）与「正本（只读·改请走 git）」链接；Step 顺序（step_order），Input/Output 以 steps.inputs/outputs 为准；价值流 Name/说明
- 价值流库由目录接管：挂了能力的 15 个价值流按 Brain ID 建页（不凭同名认领），能力「所属价值流」可全部连上；32 个空壳价值流不建页、作 catalog gap 报出；部门「价值流」关联只连建了页的
- 旧写入方断开：Activity 契约推送器删掉英文列推送与「缺列即补」（job 只写页面正文，正文页取目录链接）；结构地图价值流镜子不再挂进推送轮；公司 KR 登记只写流程页与运行页，不再写 Step/Activity 旧列
- 新增 `scripts/ops/notion-tree-cleanup.mjs`：默认 dry-run 打印每库删列/留列（带来源）/归档页；`--apply` 先备份被删列逐页原值与被归档页到本地 JSON，再按公式→汇总→其余删列、归档无 Brain ID 页（价值流/能力/Activity/Step；流程库只列待拍板），读回核对；新投影列未建出（新代码未上线）时拒绝执行
