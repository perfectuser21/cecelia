### 根本原因

三项升级合并：
1. GAN 角色（planner/proposer/reviewer）原来没有配置 model_map，使用默认 Sonnet，推理质量不足
2. APPROVED 后只创建 1 个 harness_generate，大任务无法拆分并行
3. Generator 自写 DoD，等于自评，contract → CI 链路断裂

### 下次预防

- [ ] 新增 task_type 时同步在 model_map 里配置，不依赖默认值
- [ ] Workstream 拆分上限设 6（safeWsCount），防止意外爆炸
- [ ] Generator 的 DoD 必须来自合同，CI 检测 DoD 来源（未来可加 [x] 来源标记）
