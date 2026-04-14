## autonomous_mode 融合（2026-04-14）

### 根本原因
/dev 的 Step 文件只有流程骨架，缺少行为纪律的具体指导；基础设施 bug（worktree-manage.sh 中文逗号、Stop Hook orphan 不区分 session、worktree 消失后永久 block）导致自动化流程一崩全崩。Superpowers 有完整的 TDD/verification/debugging 行为纪律和 subagent 三角色模式，两者融合可实现 PRD→PR 全自动。

### 下次预防
- [ ] shell 脚本里所有 bash 变量一律用 `${var}` 括号包裹（中文标点 ，。（）等会被 set -u 误认为变量名一部分）
- [ ] Stop Hook 的 session 隔离 + worktree 存活检测必须有专门测试覆盖
- [ ] 新增 skill/step 文件时，同时派 Spec Reviewer 审查"不信任 implementer 报告"原则是否被正确实施
