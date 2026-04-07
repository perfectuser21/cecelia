# Sprint PRD — Sprint 4

## 产品目标

Harness v3.1 Pipeline 的 GAN 对抗循环目前存在断链：Proposer 完成后需人工 curl 才能推进，Sprint Report 无法自动生成，测试版本号硬编码导致每次 migration 后需人工维护。本 Sprint 目标是打通全自动闭环——从 Proposer 完成到 sprint_report 生成，零人工干预——同时消除测试脆性与 sprint 结束后的环境垃圾。目标用户是依赖 Cecelia Harness 运行 sprint 的开发者（目前为 Alex）。

## 功能清单

- [ ] F1: verdict 解析修复 — Brain 能从 Claude 纯文本输出中自动提取 JSON verdict，无需人工 callback
- [ ] F2: Harness E2E 链路测试 — 测试覆盖 Proposer→Reviewer→sprint_generate→sprint_evaluate→sprint_report 完整自动流转
- [ ] F3: sprint_report 自动触发 — sprint_evaluate PASS 后，Brain 自动生成 sprint-report.md，无需人工介入
- [ ] F4: Schema 版本测试动态化 — 测试文件中的 EXPECTED_SCHEMA_VERSION 从代码动态读取，migration 后无需人工改测试
- [ ] F5: Sprint 结束自动清理 — sprint_report 完成后，过期 worktree/分支/临时日志自动清除

## 验收标准（用户视角）

### F1: verdict 解析修复
- GAN Proposer 任务完成后，Reviewer 任务自动出现在 Brain 任务列表，不需要用户手动执行任何 curl 命令
- 当 Claude 输出包含混合文本+JSON 时，系统能正确识别 verdict 字段（approved/rejected/needs_revision）
- 当 Claude 输出不含任何 JSON 时，系统记录解析失败原因，任务状态变为 failed 而非卡死

### F2: Harness E2E 链路测试
- 开发者运行 harness 测试套件，能看到完整 5 步链路（Proposer→Reviewer→generate→evaluate→report）各步骤的通过/失败状态
- 测试不依赖真实 Brain 运行，可在 CI 环境中独立执行
- 任何一步链路断裂时，测试输出能明确指出是哪一步、为什么失败

### F3: sprint_report 自动触发
- sprint_evaluate 任务结果为 PASS 时，Brain 任务列表中自动出现 sprint_report 任务
- sprint_report 任务完成后，`sprints/sprint-N/sprint-report.md` 文件自动出现在对应目录
- 整个流程（evaluate PASS → report 文件生成）无需用户操作

### F4: Schema 版本测试动态化
- 开发者新增一次数据库 migration 后，无需修改任何测试文件，测试仍然通过
- 当 EXPECTED_SCHEMA_VERSION 与 migrations 目录实际最大版本不一致时，测试输出清晰的不一致提示

### F5: Sprint 结束自动清理
- sprint_report 完成后，用户能在日志中看到"已清理 N 个 worktree、N 个分支、N 个临时文件"的汇总
- 清理前系统检查 worktree 是否有未提交变更，有则跳过并报告，不强制删除
- /tmp 下的 sprint 相关日志（超过 24 小时的）被自动删除

## AI 集成点（如适用）

- F1 的 verdict 提取：使用正则/JSON 解析，不依赖 AI（确定性操作）
- F3 的 sprint_report 内容生成：调用 /sprint-report skill，该 skill 内部使用 Claude 生成报告内容

## 不在范围内

- 不修改 GAN 对抗的评判逻辑（Proposer/Reviewer 的 prompt 内容不变）
- 不新增 Brain API 端点（现有端点足够支撑）
- 不改动 CI pipeline 结构（只补测试，不改 workflow 文件）
- 不处理跨 sprint 的 worktree 清理（只清理当前 sprint 创建的）
- 不实现 sprint 清理的 UI 展示
