## Brain {VERSION} — 运行舱刀8：skill 级 run 归因 + eval 入库通道

- **A（阶段级归因）**：从 n8n `execution_data.data`（扁平指针格式，每条 ~80KB）解析节点级执行——每个「阶段 X」节点带 `executionStatus` 与 `executionTime`，按 `STAGE_TO_SKILL` 映射反推**逐 skill 的运行次数/成功率/平均耗时**，回填 ops_skills（migration 442 五列）。DisCo 档位据此自动判定，不再全是 `stage_confident=false`。
- **实测发现**：流程级 `status=success` ≠ 每阶段都成功。真实 40 条 run 里仅 19 条走到首阶段之后——手机预检 19 次 100%（均 6 分），视频发现只跑了 2 次。这解释了"流程 80% 成功率但业务产出少"：绝大多数 run 卡在进入视频发现之前。
- **B（eval 入库通道·框架）**：`buildEvalRecord` 接收真机 A/B 评测结果（有 skill 臂 vs 无 skill 臂同题对照），算出 score/baseline/**lift（提升幅度）**，落成 ops_skill_versions 新一代，Notion 自动出演进曲线。非法输入（缺 total、分数超题数）直接抛错——不接受说不清的分数入库。评测执行本身需真机（xian-m4/HONOR/抖音）+ 评测集设计，另行安排。
- 阶段→skill 映射手工维护且改名会静默失效，故未知阶段一律跳过（禁硬塞给某个 skill）。
