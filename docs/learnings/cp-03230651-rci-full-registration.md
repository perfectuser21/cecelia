# Learning: 全量 RCI 注册 — /dev pipeline + Brain 核心能力

## 根本原因

### 为什么 160 条 RCI 里 Brain 认知层几乎裸奔？

历史上 RCI 是随功能开发同步添加的，但 Brain 的核心模块（tick/thalamus/self-drive/patrol 等）
是早期快速搭建的，没有同步建立回归保护。随着 /dev pipeline 演化（4-Stage、seal、OOM-aware 等），
新增的门控机制也没有及时注册进 RCI。最终形成：

- Engine/Hook 层：每次改动都会同步更新 RCI（因为有 [CONFIG] PR 要求）
- Brain 认知层：从来没有强制要求注册 RCI，所以一直裸奔

### 为什么需要全量扫描才发现？

现有 regression-contract.yaml 有 160 条，体量大，容易产生"已经很完善"的错觉。
只有主动扫描每个核心模块的行为 vs RCI 覆盖，才能发现系统性缺口。

## 下次预防

- [ ] 每次新增 Brain 核心模块（新文件/新行为）时，同步在 regression-contract.yaml 注册 RCI
- [ ] [CONFIG] PR 类型扩展：不只是 Engine changes，Brain src/ 的核心模块变更也应触发 RCI 审查
- [ ] 定期（每季度）运行全量能力扫描，检查 RCI 覆盖率 vs 实际代码分布
- [ ] 优先为 Brain tick/thalamus/executor/self-drive 这 4 个核心模块维持 100% P0 RCI 覆盖
