## Brain {VERSION} — 主干活动契约 git→Brain→Notion 自动同步（决策 0834e2fb / 92f6226b）

- 新 scheduler job `backbone-contract-sync`（`activity-contract-sync.js`）：契约真身在 zenithjoy-workspace `product-map/contracts/*.yaml`；30min 自 gate 只读 GitHub API 比 `contracts.json` 活动哈希，变了才拉 YAML 写 `journey_steps` 只读副本（contract / contract_sha256 / 钉 commit 的 contract_source），仓库删掉的活动标 deprecated；同步连续失败超 2h 告 P1 一次
- 每轮把变更行推 Notion「Backbone Activities」镜子（c213e387），缺列自动补，每行带「正本（只读·改请走 git）」链接与契约哈希
- 迁移 482：journey_steps 契约副本列 + notion_digest；获客 journey 主干活动 v2.0 四承诺 → v3.0 八活动（承诺并入 promise，stage 格子改挂同名活动，补 stage:outreach）；映射表登记 Backbone Activities 镜子
