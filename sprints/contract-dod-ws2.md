# Contract DoD — Workstream 2: 验收脚本 + README + 预算/追踪验收

**范围**: 新建 `initiatives/b1/scripts/verify.sh` 与 `initiatives/b1/README.md`，串起 PRD 验收场景 1/2/3，并把 LOC 预算 + git 追踪完整性作为合同性 ARTIFACT 校验
**大小**: S（< 100 LOC）
**依赖**: Workstream 1（验收脚本与测试都需要 entry.js + default.json 真实存在）

> **Round 2 加固**：每条 ARTIFACT 提供两种可粘贴执行的命令形式（`Test` 用 `node -e`，`Test (alt)` 用 POSIX shell）。任一形式 exit 0 即视为通过。Feature 5（LOC 预算 + git 追踪）按 DoD 分家规则归属本 WS2 ARTIFACT，不产生 BEHAVIOR `it()` 块（这是 git/文件层面的静态事实，不是运行时行为）。

## ARTIFACT 条目

- [ ] [ARTIFACT] 验收脚本文件 `initiatives/b1/scripts/verify.sh` 存在
  Test: node -e "require('fs').accessSync('initiatives/b1/scripts/verify.sh')"
  Test (alt): test -f initiatives/b1/scripts/verify.sh

- [ ] [ARTIFACT] 验收脚本含执行位（owner 可执行）
  Test: node -e "const m=require('fs').statSync('initiatives/b1/scripts/verify.sh').mode;if((m & 0o100)===0)process.exit(1)"
  Test (alt): test -x initiatives/b1/scripts/verify.sh

- [ ] [ARTIFACT] 验收脚本源码包含字面量 `PASS`（成功路径必须输出 PASS）
  Test: node -e "const c=require('fs').readFileSync('initiatives/b1/scripts/verify.sh','utf8');if(c.indexOf('PASS')<0)process.exit(1)"
  Test (alt): grep -c "PASS" initiatives/b1/scripts/verify.sh

- [ ] [ARTIFACT] 验收脚本启用 `set -e` 或 `set -euo pipefail`（确保任一断言失败传播）
  Test: node -e "const c=require('fs').readFileSync('initiatives/b1/scripts/verify.sh','utf8');if(!/^\s*set\s+-[eu]+(o\s+pipefail)?/m.test(c))process.exit(1)"
  Test (alt): grep -cE "^[[:space:]]*set[[:space:]]+-[eu]+" initiatives/b1/scripts/verify.sh

- [ ] [ARTIFACT] README 文件 `initiatives/b1/README.md` 存在且非空
  Test: node -e "const s=require('fs').statSync('initiatives/b1/README.md');if(s.size===0)process.exit(1)"
  Test (alt): test -s initiatives/b1/README.md

- [ ] [ARTIFACT] README 含字面命令 `node initiatives/b1/entry.js`
  Test: node -e "const c=require('fs').readFileSync('initiatives/b1/README.md','utf8');if(c.indexOf('node initiatives/b1/entry.js')<0)process.exit(1)"
  Test (alt): grep -c "node initiatives/b1/entry.js" initiatives/b1/README.md

- [ ] [ARTIFACT] README 含字面命令 `bash initiatives/b1/scripts/verify.sh`
  Test: node -e "const c=require('fs').readFileSync('initiatives/b1/README.md','utf8');if(c.indexOf('bash initiatives/b1/scripts/verify.sh')<0)process.exit(1)"
  Test (alt): grep -c "bash initiatives/b1/scripts/verify.sh" initiatives/b1/README.md

- [ ] [ARTIFACT] **[Feature 5]** `initiatives/b1/` 目录下被 git 追踪文件数 ≥ 1（目录非空）
  Test: bash -c "n=$(git ls-files initiatives/b1/ | wc -l); if [ \"$n\" -lt 1 ]; then exit 1; fi"
  Test (alt): bash -c "[ \"$(git ls-files initiatives/b1/ | wc -l)\" -ge 1 ]"

- [ ] [ARTIFACT] **[Feature 5]** `initiatives/b1/` 目录下所有文件均被 git 追踪（无 untracked 残留，对齐 PRD SC-004）
  Test: bash -c "untracked=$(git ls-files --others --exclude-standard initiatives/b1/ | wc -l); if [ \"$untracked\" -ne 0 ]; then echo \"untracked files: $untracked\"; exit 1; fi"
  Test (alt): bash -c "[ \"$(git ls-files --others --exclude-standard initiatives/b1/ | wc -l)\" = \"0\" ]"

- [ ] [ARTIFACT] **[Feature 5]** `initiatives/b1/` 下所有 git 追踪文件总行数 < 400（对齐 PRD SC-003 capacity-budget hard 阈值）
  Test: bash -c "total=$(git ls-files initiatives/b1/ | xargs -r wc -l | awk 'END{print $1+0}'); if [ \"$total\" -ge 400 ]; then echo \"LOC=$total >= 400\"; exit 1; fi"
  Test (alt): bash -c "[ \"$(git ls-files initiatives/b1/ | xargs -r wc -l | awk 'END{print $1+0}')\" -lt 400 ]"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `sprints/tests/ws2/verify.test.ts`，覆盖：
- exits 0 and prints PASS when scaffold is healthy
- exits non-zero when entry script is replaced with process.exit(7)
- exits non-zero when banner field is removed from default config
- prints readable failure when entry file is unreadable, no raw stack frame
- README documents both entry and verify run commands as copy-pasteable lines

> **Feature 5 无 BEHAVIOR 说明**：LOC 预算 + git 追踪完整性是 git/文件系统层面的静态事实，不存在"运行时行为"可断言（没有进程要拉起、没有 API 要调用、没有函数返回值要观察）。按 DoD 分家决策树，正确归类为纯 ARTIFACT。Reviewer 反馈中的"挂在 ws2 但无 BEHAVIOR 覆盖"已通过本说明 + 上方 3 条具名 `[Feature 5]` ARTIFACT 显式认领，不再是孤儿。
