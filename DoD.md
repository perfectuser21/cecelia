# DoD：清退旧模型审查与过程资料自动维护入口

- [x] [ARTIFACT] 删除 pr-review、skill-distillation-eval、cleanup-merged-artifacts、archive-learnings 四份工作流，以及旧模型审查专属脚本和测试。
  Test: manual:node -e "const fs=require('node:fs'); for(const name of ['pr-review','skill-distillation-eval','cleanup-merged-artifacts','archive-learnings']) if(fs.existsSync('.github/workflows/'+name+'.yml')) process.exit(1)"
- [x] [BEHAVIOR] 归档工具直接执行真实 Python 脚本；保留同月合并、损坏与同名冲突拒绝、跨月失败不丢原文的回归。
  Test: manual:node --test scripts/ci/__tests__/basic-archive-learnings.test.mjs
- [x] [BEHAVIOR] 清理工具直接执行真实 Node 脚本；保留精确 Git 删除、其他 worktree 不受影响、读取失败及畸形来源登记拒绝。
  Test: manual:node --test scripts/ci/__tests__/basic-merged-artifact-cleanup.test.mjs
- [x] [BEHAVIOR] 来源声明与文档删除仍在同一 Git 提交中核验；跨仓巡查治理的身份、秘密隔离及原固定协议保持。
  Test: manual:node --test scripts/ci/__tests__/device-patrol-governance.test.mjs
  Test: manual:npm exec --workspace cecelia-brain -- vitest run scripts/ci/__tests__/cleanup-source-retirement.test.mjs
- [ ] [BEHAVIOR] 完整 scripts 必需检查与候选精确 HEAD 官方 CI 通过，受保护合并后读回主干仅剩十九份工作流。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
