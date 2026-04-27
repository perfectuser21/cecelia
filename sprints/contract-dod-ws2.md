# Contract DoD — Workstream 2: 验收脚本 + README + 预算/追踪验收

**范围**: 新建 `initiatives/b1/scripts/verify.sh` 与 `initiatives/b1/README.md`，串起 PRD 验收场景 1/2/3，并把 LOC 预算 + git 追踪完整性作为合同性 ARTIFACT 校验
**大小**: S（< 100 LOC）
**依赖**: Workstream 1（验收脚本与测试都需要 entry.js + default.json 真实存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] 验收脚本文件 `initiatives/b1/scripts/verify.sh` 存在
  Test: node -e "require('fs').accessSync('initiatives/b1/scripts/verify.sh')"

- [ ] [ARTIFACT] 验收脚本含执行位（owner 可执行）
  Test: node -e "const m=require('fs').statSync('initiatives/b1/scripts/verify.sh').mode;if((m & 0o100)===0)process.exit(1)"

- [ ] [ARTIFACT] 验收脚本源码包含字面量 `PASS`（成功路径必须输出 PASS）
  Test: node -e "const c=require('fs').readFileSync('initiatives/b1/scripts/verify.sh','utf8');if(c.indexOf('PASS')<0)process.exit(1)"

- [ ] [ARTIFACT] 验收脚本启用 `set -e` 或 `set -euo pipefail`（确保任一断言失败传播）
  Test: node -e "const c=require('fs').readFileSync('initiatives/b1/scripts/verify.sh','utf8');if(!/^\s*set\s+-[eu]+(o\s+pipefail)?/m.test(c))process.exit(1)"

- [ ] [ARTIFACT] README 文件 `initiatives/b1/README.md` 存在且非空
  Test: node -e "const s=require('fs').statSync('initiatives/b1/README.md');if(s.size===0)process.exit(1)"

- [ ] [ARTIFACT] README 含字面命令 `node initiatives/b1/entry.js`
  Test: node -e "const c=require('fs').readFileSync('initiatives/b1/README.md','utf8');if(c.indexOf('node initiatives/b1/entry.js')<0)process.exit(1)"

- [ ] [ARTIFACT] README 含字面命令 `bash initiatives/b1/scripts/verify.sh`
  Test: node -e "const c=require('fs').readFileSync('initiatives/b1/README.md','utf8');if(c.indexOf('bash initiatives/b1/scripts/verify.sh')<0)process.exit(1)"

- [ ] [ARTIFACT] `initiatives/b1/` 目录下所有文件均被 git 追踪（无 untracked 残留，对齐 PRD SC-004）
  Test: bash -c "untracked=$(git ls-files --others --exclude-standard initiatives/b1/ | wc -l); if [ \"$untracked\" -ne 0 ]; then echo \"untracked files: $untracked\"; exit 1; fi"

- [ ] [ARTIFACT] `initiatives/b1/` 下所有 git 追踪文件总行数 < 400（对齐 PRD SC-003 capacity-budget hard 阈值）
  Test: bash -c "total=$(git ls-files initiatives/b1/ | xargs -r wc -l | awk 'END{print $1+0}'); if [ \"$total\" -ge 400 ]; then echo \"LOC=$total >= 400\"; exit 1; fi"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `sprints/tests/ws2/verify.test.ts`，覆盖：
- exits 0 and prints PASS when scaffold is healthy
- exits non-zero when entry script is replaced with process.exit(7)
- exits non-zero when banner field is removed from default config
- prints readable failure when entry file is unreadable, no raw stack frame
- README documents both entry and verify run commands as copy-pasteable lines
