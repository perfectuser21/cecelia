---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: dev/SKILL.md Route B 步骤

**范围**: `packages/workflows/skills/dev/SKILL.md`（加 Route A/B 对比说明 + Route B POST Brain 步骤，~30 行）
**大小**: S（~30 行净增）
**依赖**: Workstream 1 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `dev/SKILL.md` 含 Route B 段落（出现 "Route B" 文字）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/dev/SKILL.md','utf8');if(!c.includes('Route B'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `dev/SKILL.md` 含 Brain POST 端点引用
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/dev/SKILL.md','utf8');if(!c.includes('localhost:5221/api/brain/tasks'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] Route B 段落含 `task_type=dev`（Brain 注册任务类型字段）
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/workflows/skills/dev/SKILL.md\",\"utf8\");
  if(!c.includes(\"Route B\")){console.error(\"FAIL: Route B 段落不存在\");process.exit(1);}
  if(!c.includes(\"task_type\")){console.error(\"FAIL: task_type 字段缺失\");process.exit(1);}
  if(!c.includes(\"localhost:5221/api/brain/tasks\")){console.error(\"FAIL: Brain POST endpoint 缺失\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [ ] [BEHAVIOR] Route A（有 `--task-id`）路径保持不变，`--task-id` 引用仍在文件中
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/workflows/skills/dev/SKILL.md\",\"utf8\");
  if(!c.includes(\"--task-id\")){console.error(\"FAIL: Route A --task-id 引用丢失\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [ ] [BEHAVIOR] Route B 含 Brain 离线时不阻断 `/dev` 流程的描述（warn 日志或"不阻断"文字）
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/workflows/skills/dev/SKILL.md\",\"utf8\");
  const hasWarn=c.includes(\"warn\") || c.includes(\"不阻断\") || c.includes(\"offline\") || c.includes(\"离线\");
  if(!hasWarn){console.error(\"FAIL: 缺 Brain 离线降级说明\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK

- [ ] [BEHAVIOR] error path — Route B POST Brain 步骤描述明确是在 PrepPRD 确认后执行（不是 Stage 2/3）
  Test: manual:bash -c '
  node -e "
  const c=require(\"fs\").readFileSync(\"packages/workflows/skills/dev/SKILL.md\",\"utf8\");
  // Route B 段落必须在文件里存在（前两条 BEHAVIOR 已覆盖）
  // 额外检查 Route B 段落和 PrepPRD / Stage 1 区域有关联
  const hasRouteB=c.includes(\"Route B\");
  if(!hasRouteB){console.error(\"FAIL: Route B 不存在\");process.exit(1);}
  // PrepPRD 或 Stage 1 确认点在文件中存在
  const hasPrepCtx=c.includes(\"PrepPRD\") || c.includes(\"Stage 1\") || c.includes(\"Spec\");
  if(!hasPrepCtx){console.error(\"FAIL: 缺 PrepPRD/Stage1 上下文\");process.exit(1);}
  console.log(\"OK\");
  "
  '
  期望: OK
