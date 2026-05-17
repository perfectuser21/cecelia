# Task: L2 动态契约 — Evidence System + TDD Artifact 强制

**Task ID**: d3f225a9-b7a3-4c16-9836-0c05e94bab9b
**Branch**: cp-0418201225-l2-dynamic-contract
**Version**: Engine 14.17.5 → 14.17.6
**Mode**: harness + autonomous
**Depends on**: PR #2406 (L1)

## 目标

把 Engine ↔ Superpowers 对齐状态从"字节层静态"升级到"行为层动态"。新增 Evidence JSONL + recorder + CI gate + TDD artifact 强制，第一轮 opt-in（不阻塞合并）。

## DoD

### 契约扩展 + Schema（WS1）

- [x] [ARTIFACT] alignment.yaml 为 10 full + 1 partial skill 加 runtime_evidence 字段
      Test: manual:node -e "const fs=require('fs');const t=fs.readFileSync('packages/engine/contracts/superpowers-alignment.yaml','utf8');const c=(t.match(/runtime_evidence:/g)||[]).length;if(c<10)process.exit(1)"

- [x] [BEHAVIOR] 所有 runtime_evidence 字段标 mode: opt-in（第一轮不 enforced）
      Test: manual:node -e "const fs=require('fs');const t=fs.readFileSync('packages/engine/contracts/superpowers-alignment.yaml','utf8');if(t.includes('mode: enforced'))process.exit(1)"

- [x] [ARTIFACT] Evidence schema 文档存在
      Test: manual:bash -c "test -f sprints/l2-dynamic-contract/evidence-schema.md"

### Recorder + Gate 脚本（WS2+WS3）

- [x] [ARTIFACT] record-evidence.sh 存在且可执行
      Test: manual:bash -c "test -x packages/engine/scripts/record-evidence.sh"

- [x] [ARTIFACT] check-pipeline-evidence.cjs 存在
      Test: manual:node -e "require('fs').accessSync('packages/engine/scripts/devgate/check-pipeline-evidence.cjs')"

- [x] [BEHAVIOR] recorder 能 append 合法 JSONL（自动算 sha256）
      Test: manual:bash -c "mkdir -p /tmp/evtest && bash packages/engine/scripts/record-evidence.sh --event pre_completion_verification --all-pass true --checklist-json '[{\"id\":\"x\",\"pass\":true}]' --task-id '00000000-0000-0000-0000-000000000000' --branch test --stage stage_2_code --output /tmp/evtest/x.jsonl && node -e \"const o=JSON.parse(require('fs').readFileSync('/tmp/evtest/x.jsonl','utf8').trim());if(o.event!=='pre_completion_verification'||o.version!=='1.0')process.exit(1)\""

- [x] [BEHAVIOR] recorder 拒绝用户传 sha256（防伪造）
      Test: manual:bash -c "bash packages/engine/scripts/record-evidence.sh --event subagent_dispatched --prompt-sha256 fake --subagent-type implementer --prompt packages/engine/scripts/record-evidence.sh --return-status DONE --task-id 00000000-0000-0000-0000-000000000000 --branch test --stage stage_2_code 2>&1 | grep -q 'computed by the script' || exit 1"

- [x] [BEHAVIOR] gate 无 evidence 文件时 skip exit 0
      Test: manual:node packages/engine/scripts/devgate/check-pipeline-evidence.cjs

- [x] [BEHAVIOR] gate 单元测试 7 case 全绿
      Test: manual:node --test packages/engine/tests/devgate/check-pipeline-evidence.test.cjs

### Prompt 改动 + 02-code.md 插桩（WS4+WS5）

- [x] [BEHAVIOR] implementer-prompt.md 含 TDD Deliverables Contract 段落
      Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/prompts/subagent-driven-development/implementer-prompt.md','utf8');if(!c.includes('TDD Deliverables Contract')||!c.includes('TDD_RED_LOG')||!c.includes('TDD_GREEN_LOG'))process.exit(1)"

- [x] [BEHAVIOR] spec-reviewer-prompt.md 含 Core Check #6 TDD Artifact Authenticity
      Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/prompts/subagent-driven-development/spec-reviewer-prompt.md','utf8');if(!c.includes('Core Check #6')||!c.includes('Anti-backfill'))process.exit(1)"

- [x] [BEHAVIOR] 02-code.md 3 个 P0 点已插 record-evidence 调用
      Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/02-code.md','utf8');const n=(c.match(/record-evidence\.sh/g)||[]).length;if(n<3)process.exit(1)"

### CI 集成 + 版本 + Learning（WS6）

- [x] [BEHAVIOR] CI workflow 含 Pipeline Evidence Gate
      Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('Pipeline Evidence Gate'))process.exit(1)"

- [x] [BEHAVIOR] 版本号 6 处同步到 14.17.6
      Test: manual:node -e "const fs=require('fs');const v=fs.readFileSync('packages/engine/VERSION','utf8').trim();const pkg=JSON.parse(fs.readFileSync('packages/engine/package.json','utf8')).version;const hcv=fs.readFileSync('packages/engine/.hook-core-version','utf8').trim();const hv=fs.readFileSync('packages/engine/hooks/VERSION','utf8').trim();const skill=fs.readFileSync('packages/engine/skills/dev/SKILL.md','utf8').match(/^version:\s*(\S+)/m)[1];const reg=fs.readFileSync('packages/engine/regression-contract.yaml','utf8').match(/^version:\s*(\S+)/m)[1];if(![v,pkg,hcv,hv,skill,reg].every(x=>x==='14.17.6'))process.exit(1)"

- [x] [ARTIFACT] feature-registry 14.17.6 条目
      Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('version: \"14.17.6\"'))process.exit(1)"

- [x] [ARTIFACT] Learning 文件存在且格式合规
      Test: manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-04182012-l2-dynamic-contract.md','utf8');if(!c.includes('## 根本原因')||!c.includes('## 下次预防'))process.exit(1)"

### 向后兼容（L1 不破）

- [x] [BEHAVIOR] L1 alignment gate 仍 pass（向后兼容）
      Test: manual:node packages/engine/scripts/devgate/check-superpowers-alignment.cjs

- [x] [BEHAVIOR] L1 hygiene gate 仍 pass
      Test: manual:node packages/engine/scripts/devgate/check-engine-hygiene.cjs

- [x] [BEHAVIOR] bump-version.sh 仍能同步 6 处
      Test: manual:bash packages/engine/scripts/bump-version.sh patch --dry-run
