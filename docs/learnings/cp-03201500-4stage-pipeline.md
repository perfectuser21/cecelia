# Learning: Engine 4-Stage Pipeline 重构

## 变更概述

将 /dev 工作流从原来的多步骤结构重构为 4-Stage Pipeline（Plan → Code → Ship → Clean），删除冗余的审查 skill 和旧的 activation 脚本。

### 根本原因

原有 /dev 工作流步骤过多（5+ steps），审查流程分散在多个独立 skill 中（code-review-gate、initiative-review、prd-review、spec-review），导致维护成本高、流程不一致。Pipeline 化可以统一控制流、减少重复逻辑。

### 下次预防

- [ ] 大规模重构前先列出所有受影响的测试文件，确保测试引用的步骤名/文件名同步更新
- [ ] 删除 skill 目录时检查是否有其他代码引用该 skill 的路径
- [ ] Pipeline stage 重命名后，确认 CI gate 配置中的 step 名称匹配
- [ ] 提交前运行完整测试套件验证无遗漏
