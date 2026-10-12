## coding workflow 活动层与提示词按仓库参数化：仓库口径只认一份配置，缺省必须等于旧行为（2026-10-12）

### 根本原因
- C4/C5 让 runner 门禁按仓库跑，但活动层（publish 版本碎片、ci-precheck 清单、qa-report 生产判定、qa-smoke 目录、pr-branch 受保护路径）和提示词里仍写死 cecelia 的口径：zenithjoy 任务一跑就会被要求写 changes/、补 packages/brain/scripts/smoke、拿 5221 当唯一生产，而它真正的必需门（test-registry.yaml 登记、smoke-baseline）一条没预检。
- QA 门对非 brain_preview 仓库只能「不验」，zenithjoy 没有 PR 预览，UI / 真机任务 local 黑盒又验不了，需要在 spec 阶段就分流。

### 下次预防
- [ ] 仓库差异一律进 repos.json 条目，经信封 / cfg 显式传给活动，活动自己不猜仓库；没传时退回默认仓，用测试钉住「默认 = 旧行为」
- [ ] 预检清单按目标仓库真实 CI 抄，必需门优先、会改文件的生成类检查只做只读校验
- [ ] 碰生产判定取「本仓 ∪ 默认仓」：同一台执行机上的其他生产（MMV 本机 5221）对任何仓库都是红线
- [ ] 提示词里的仓库专属规矩抽成 repo-rules 文件注入，主提示词只留通用流程，测试断言主提示词不含专属路径
