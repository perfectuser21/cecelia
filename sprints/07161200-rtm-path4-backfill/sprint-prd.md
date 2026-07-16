# Sprint PRD — 建制W1: 客服线 RTM 补账（Path4 十六步对账表）

## 元数据
- task_id: 599338ce-7fb0-44e3-be42-0c4a3baa3c3e
- sprint_dir: sprints/07161200-rtm-path4-backfill
- journey_type: user_facing
- target_environment: local_api
- created: 2026-07-16

## 背景与目标

Path4 = 客户私域 AI 接管（Line04 微信客服）。zenithjoy-workspace 已有 16 步 golden path smoke（golden-path-4-smoke.sh，2026-07-15 三次修正版），但缺少 RTM（Requirements Traceability Matrix）——即每步的 FR/NFR/invariant 与实际验证等级的对账文档。

本 sprint 交付两件：
1. `docs/rtm/path4-customer-service.md`：16 步 RTM 表，每行含取证指针（实读 zenithjoy-workspace 取证，非凭记忆）
2. DB 回填：查 journey_steps schema → 无 metadata/jsonb 列 → 在 RTM 中注明"DB 回填待 L 级 schema（建制W2）"，跳过

## Invariant 约束

1. RTM 每行"现有验证物"列必须有实际文件路径+行号指针（不得写"见文档"无行号）
2. 等级判定严格按三级标准：L1=mock/dryrun/grep/自发回执，L2=真API+真DB断言，L3=真机真微信可观察面
3. 接缝步（Step1/6/14/16 用户直接可见结果）承诺等级=L3，当前未达到则如实标差距
4. DB 回填：journey_steps 表无 metadata/jsonb 列 → 注明"待建制W2"，禁止自造表
5. RTM 行数 = 16（步骤 1-16 全覆盖，Step4/5 共享前门单独标注）

## 累积 FR

1. FR01: docs/rtm/path4-customer-service.md 存在，16 行齐全，每行有取证指针
2. FR02: 等级判定标准在文档头部定义（L1/L2/L3 各含示例）
3. FR03: 接缝步（1/6/14/16）承诺等级 = L3，实际等级与 L3 的差距在"差距与责任通道"列说明
4. FR04: DB 回填状态在 RTM 中明确注明（含跳过原因）
5. FR05: 每行"现有验证物"格式为 `<仓库>//<文件路径>:<行号范围>`

## NFR

- NFR01: 文档格式为 Markdown 表格，可直接在 GitHub 渲染
- NFR02: 取证来源为 perfectuser21/zenithjoy-workspace（gh api 只读拉取），非本仓库

## 数据来源（取证清单）

| 来源文件 | 内容 |
|---|---|
| zenithjoy-workspace//.github/workflows/scripts/smoke/golden-path-4-smoke.sh | 16 步断言逻辑（权威） |
| zenithjoy-workspace//sprints/sprint-d-path4-private-ai-thin/contract-dod-ws1.md | Step1/2 FR+BEHAVIOR |
| zenithjoy-workspace//sprints/sprint-d-path4-private-ai-thin/contract-dod-ws2.md | Step1-3 FR |
| zenithjoy-workspace//sprints/sprint-d-path4-private-ai-thin/contract-dod-ws3.md | Step7/11/13 FR |
| zenithjoy-workspace//sprints/sprint-d-path4-private-ai-thin/contract-dod-ws4.md | Step4/朋友圈草稿 |
| zenithjoy-workspace//sprints/sprint-d-path4-private-ai-thin/contract-dod-ws5.md | Step5/6/频控 |
| zenithjoy-workspace//sprints/sprint-d-path4-private-ai-thin/contract-dod-ws6.md | Step16/CI |
| zenithjoy-workspace//.agent-knowledge/path-4/lead-acceptance-path4-sprint-1.md | Lead 自验清单 |

journey_type: user_facing
target_environment: local_api
