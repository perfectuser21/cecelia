---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 三个故障注入脚本 inject-fault-{a,b,c}.sh

**范围**: 在 `scripts/acceptance/w8-v2/` 下新建 3 个脚本，覆盖 W2/W3/W5/W6 联动验证：
- A — docker SIGKILL → OOM_killed → 自动重试 PASS
- B — final E2E FAIL × 3 → interrupt → resume abort → END error
- C — watchdog deadline 过期 → phase=failed
**大小**: M（每个 60–120 LOC，合计 200–300 LOC）
**依赖**: Workstream 1（必须先有 in-flight initiative_runs 才能注入）

## ARTIFACT 条目

### Fault A: docker SIGKILL

- [ ] [ARTIFACT] 脚本 A 文件存在 + shebang + set -euo pipefail
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-a-docker-sigkill.sh','utf8');if(!/^#!\/bin\/bash/.test(c)||!/set -[eu]+o\s+pipefail/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 A 含 `docker kill --signal=KILL` 或 `docker kill -s KILL`
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-a-docker-sigkill.sh','utf8');if(!/docker kill\\s+(--signal=KILL|-s\\s+KILL)/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 A 校验 `callback_queue.failure_class='docker_oom_killed'`
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-a-docker-sigkill.sh','utf8');if(!c.includes('docker_oom_killed')||!c.includes('callback_queue'))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 A 校验子任务最终 `status='completed'` 且 `execution_attempts >= 2`
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-a-docker-sigkill.sh','utf8');if(!c.includes('execution_attempts')||!/status\\s*=\\s*['\"]?completed/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 A bash 语法合法
  Test: `bash -n scripts/acceptance/w8-v2/inject-fault-a-docker-sigkill.sh`

### Fault B: max_fix_rounds interrupt

- [ ] [ARTIFACT] 脚本 B 文件存在 + shebang + set -euo pipefail
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-b-max-fix-interrupt.sh','utf8');if(!/^#!\/bin\/bash/.test(c)||!/set -[eu]+o\s+pipefail/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 B 含 `interrupt_pending` 事件查询 + `harness-interrupts` API 调用
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-b-max-fix-interrupt.sh','utf8');if(!c.includes('interrupt_pending')||!c.includes('/api/brain/harness-interrupts'))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 B 含 resume 调用 body `{"decision":{"action":"abort"}}` 与 `/resume` 路径
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-b-max-fix-interrupt.sh','utf8');if(!/\"decision\"\\s*:\\s*\\{\\s*\"action\"\\s*:\\s*\"abort\"/.test(c)||!/\\/resume/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 B 含 HTTP 202 校验 + interrupt_resumed 校验 + initiative_runs.phase=failed 校验
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-b-max-fix-interrupt.sh','utf8');for(const k of ['202','interrupt_resumed','initiative_runs','phase']){if(!c.includes(k)){console.error('missing:'+k);process.exit(1)}}"`

- [ ] [ARTIFACT] 脚本 B bash 语法合法
  Test: `bash -n scripts/acceptance/w8-v2/inject-fault-b-max-fix-interrupt.sh`

### Fault C: watchdog deadline

- [ ] [ARTIFACT] 脚本 C 文件存在 + shebang + set -euo pipefail
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-c-watchdog-deadline.sh','utf8');if(!/^#!\/bin\/bash/.test(c)||!/set -[eu]+o\s+pipefail/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 C 含 `UPDATE initiative_runs SET deadline_at=NOW()-INTERVAL '1 minute'` 或等效语句
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-c-watchdog-deadline.sh','utf8');if(!/UPDATE\\s+initiative_runs[\\s\\S]+deadline_at\\s*=\\s*NOW\\(\\)\\s*-\\s*INTERVAL/i.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 C 含 `failure_reason='watchdog_overdue'` 校验
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-c-watchdog-deadline.sh','utf8');if(!c.includes('watchdog_overdue'))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 C 含轮询等待逻辑（≤6 分钟）
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-c-watchdog-deadline.sh','utf8');if(!/for\\s+\\w+\\s+in\\s+\\$\\(seq/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 C 校验 Brain 日志含 `[harness-watchdog] flagged initiative=39d535f3-…`
  Test: `node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v2/inject-fault-c-watchdog-deadline.sh','utf8');if(!c.includes('harness-watchdog')||!c.includes('flagged'))process.exit(1)"`

- [ ] [ARTIFACT] 脚本 C bash 语法合法
  Test: `bash -n scripts/acceptance/w8-v2/inject-fault-c-watchdog-deadline.sh`

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/fault-injection.test.ts`，覆盖：
- 3 个脚本各自的结构性 smoke
- A 含 docker kill SIGKILL + callback_queue.failure_class 校验路径
- B 含完整 interrupt → resume(abort) → phase=failed 全链路验证
- C 含 deadline 时间旅行 + 6 分钟轮询 + 日志 grep 三段
- 3 个脚本 bash -n 语法合法
- 3 个脚本 fixed UUID 字面量都在
