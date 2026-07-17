# Handoff：golden-path-mapper 归位模式 Mode2 + 承诺地图体系 doctrine 补丁

- verdict: PASS ｜ task: unknown（无 Brain task_id，本次为直派实现子任务，非 /dev 派工）｜ PR: zenithjoy-skills#152

## 完成
- golden-path-mapper/SKILL.md 新增「模式总览」区分 Mode 1（原有切分流程，零删改）/ Mode 2（归位模式，新增）
- Mode 2 归位流程：读 Brain 现有地图（journeys/journey_features/golden_paths，不可达则退化为读文档）
  → 五关判定链（①频率判据 ②三问法 ③承诺翻译测试 ④四问归家 ⑤输出归位裁决单）
  → 归位裁决单不写库，呈用户确认后按 `Skill(db-update)` 规范落账
- doctrine 附录追加四块：七动作总表（贯穿/加厚/修复/动骨干/退役/探索spike/置换）、
  场景牌组（承诺×八场景矩阵：首次使用/日常运行/重启恢复/断网弱网/并发洪峰/对抗输入/平台改版/凭据过期，
  空格=红灯）、频率判据与共享前置裁决（步骤频率=路的触发频率；一次性进场链独立成公司级
  「首次成功路径」GP；禁止把共享步骤复制进每条路前面）、例外与铁律（止血例外24h内补裁决/
  软格子eval+judge+人工抽样显式标软/账本写入必须是流水线自动副作用）
- version 1.0.0 → 1.1.0 + SKILL.md 内联 changelog 一行 + 根 CHANGELOG.md 一条完整记录（症状/根因/修改）
- 本地全量自检通过：lint-skills.py / lint-learning-placeholders.py / check-brain-contract.sh 均绿；
  git diff 确认 Mode 1 原有内容零删改（唯一删除行是 version 号本身）
- PR zenithjoy-skills#152 已 push + gh pr create + auto-merge 启用，CI 绿后已自动 squash 合并
  （commit 4972a10），本地 main 已 fast-forward，已合并分支已清理

## 没完成
- 无（本次任务范围仅限 SKILL.md doctrine 补丁本身，不涉及代码/CI/部署）

## 下一步
- 完成，无下一步（Mode 2 归位模式已可用，下次「归位/这个加到哪/放哪个golden path」类请求即可触发）
- 后续若有真实归位案例跑过一遍，建议回来给 Mode 2 补一个实战范例，充实 doctrine 附录

## 数据源
- ~/perfect21/zenithjoy-skills/golden-path-mapper/SKILL.md（改动主体）
- ~/perfect21/zenithjoy-skills/CHANGELOG.md（根变更记录）
- https://github.com/perfectuser21/zenithjoy-skills/pull/152

## 决策引用
- 0717 主理人定型总纲「承诺地图体系 v1.0」（本次改动的口径来源，用户在任务指令中直接给出）
