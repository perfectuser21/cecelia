## step_probes 对齐 workspace 探针最终形状（2026-09-26）

task 14cd9e76 ｜ 链 bf5088a3 棒2 后续 ｜ 决策 702949b6

### 根本原因

- **两仓并行定形状，Brain 侧先落地时只按 prompt 里的简写 `probe:{type,target,query|url}` 写归一化器**，workspace 侧最终 schema.json 的 http 形状多了 `filter/reduce/minus`。归一化器"只挑认识的键"这种写法会静默丢字段——落库的 spec 看起来合法，执行体却拿不到取数条件。
- **"只挑认识的键"与"拒未知键"是两种安全性**：前者防私货进库，后者防真身字段被吞。对 SSOT 投影表必须用后者（同 schema `additionalProperties:false`），否则漂移检测永远绿（哈希是对残缺 spec 算的）。
- **哈希粒度要写明，不能二选一含糊**：逐条 canonical 哈希回答"哪条变了"，整文件 sha256 回答"仓库那份是不是库里这版"（且与对方仓 probes-lib 同口径可直接对读）。两级并存，各答各的。

### 下次预防

- [ ] 跨仓契约先拿对方已合并的 schema/样例文件过一遍本方解析器再收尾（本次用 gh api 拉 main 上真 YAML 跑 loadProbesYaml，sha256 前缀对上才算对齐）。
- [ ] SSOT 投影表的归一化器一律拒未知键（allowlist 键集 + 报错），禁止"挑认识的键"。
- [ ] 哈希/指纹类字段在 PR 描述里写明口径（算什么、和谁同口径、粒度）。
