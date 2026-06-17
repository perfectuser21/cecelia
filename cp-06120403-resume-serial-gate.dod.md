# DoD: serial gate resume 终局误判修复（P0）

## 验收清单

- [x] [BEHAVIOR] PR 实际已 merged（checkpoint status=queued 陈旧）→ serial gate 走 merged 短路、纠正状态推进、不 FAIL
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-initiative-resume-serial-gate.test.js','utf8');if(!c.includes('走 merged 短路'))process.exit(1)"

- [x] [BEHAVIOR] status=queued + PR 未 merged 仍在飞 → 不判 FAIL，重新进入 run_sub_task（不递增 index）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-initiative-resume-serial-gate.test.js','utf8');if(!c.includes('重新进入 run_sub_task'))process.exit(1)"

- [x] [BEHAVIOR] genuine 终败（status=failed）→ 保持 terminal FAIL 原语义
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-initiative-resume-serial-gate.test.js','utf8');if(!c.includes('保持 terminal FAIL'))process.exit(1)"

- [x] [BEHAVIOR] requeue 超上限仍 queued 未收敛 → terminal FAIL（防本修复自身死循环）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-initiative-resume-serial-gate.test.js','utf8');if(!c.includes('防本修复自身死循环'))process.exit(1)"

- [x] [ARTIFACT] advanceTaskIndexNode 加 resume 持久事实源重导出逻辑（_checkPrMerged 复用）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('Resume 终局误判防护'))process.exit(1)"

- [x] [ARTIFACT] FullInitiativeState 新增 serial_gate_requeue_count 通道
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('serial_gate_requeue_count'))process.exit(1)"

## Learning 路径

docs/learnings/cp-06120403-resume-serial-gate.md
