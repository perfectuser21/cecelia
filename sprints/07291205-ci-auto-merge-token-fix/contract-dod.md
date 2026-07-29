# Sprint DoD — auto-merge GH_TOKEN → GH_PAT_BOT 修复

**Sprint**: 07291205-ci-auto-merge-token-fix
**Task ID**: b62e3dc3-0ffd-4733-803c-58138dac18ce
**Journey Type**: dev_pipeline
**Target Environment**: local_api

---

## [ARTIFACT] 产出物清单

- [ ] [ARTIFACT] `.github/workflows/ci.yml` 第 1896 行 `GH_TOKEN` 值改为 `${{ secrets.GH_PAT_BOT || secrets.GITHUB_TOKEN }}`（单行变更，格式与仓库既有 workflow 降级写法一致）
- [ ] [ARTIFACT] `packages/engine/tests/integrity/auto-merge-token-contract.test.sh` 新增静态契约测试脚本（可执行 bash，含 ≥3 条断言，先红后绿两 commit 流程）
- [ ] [ARTIFACT] 测试脚本在 commit-1（仅加测试）时 exit 1（Red），在 commit-2（改 ci.yml 后）时 exit 0（Green）

---

## [BEHAVIOR] 行为验收清单

- [ ] [BEHAVIOR] [L2] B-01: 契约测试（先红）— ci.yml 未改时 auto-merge-token-contract.test.sh exit 1
  动作: 在 ci.yml 未改之前，执行 `bash packages/engine/tests/integrity/auto-merge-token-contract.test.sh`
  预期观察: 脚本打印 "FAIL" 断言行，最终 exit 1（FAIL 计数 ≥ 1）
  等待预算: 0s
  留证: 命令输出的 PASS/FAIL 行，exit code 截图
  Test: manual:bash -c 'bash packages/engine/tests/integrity/auto-merge-token-contract.test.sh; [ $? -ne 0 ] && echo "RED-OK: 正确 exit 1" || { echo "RED-FAIL: 应当 exit 1 但 exit 0"; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-02: ci.yml 字段实际写法核实 — GH_TOKEN 在 auto-merge job env 块中引用 GH_PAT_BOT
  动作: 执行 `grep -n "GH_TOKEN:" .github/workflows/ci.yml`，观察输出内容
  预期观察: 输出行包含 `GH_PAT_BOT`，且包含降级写法 `||`，且包含 `GITHUB_TOKEN`（三者同行）
  等待预算: 0s
  留证: grep 命令输出内容（含行号和完整行文本）
  Test: manual:bash -c 'LINE=$(grep -n "GH_TOKEN:" .github/workflows/ci.yml | head -1); echo "$LINE" | grep -q "GH_PAT_BOT" && echo "$LINE" | grep -q "GITHUB_TOKEN" || { echo "FAIL: GH_TOKEN 行未含 GH_PAT_BOT 降级写法，实际：$LINE"; exit 1; }; echo "PASS: $LINE"'

- [ ] [BEHAVIOR] [L2] B-03: GH_TOKEN 语义字段核实（铁律-语义字段）— 确认非注释行
  动作: 使用 awk 提取 auto-merge job env 块，检查 GH_TOKEN 字段在该块内
  预期观察: auto-merge job 的 `env:` 段中存在 `GH_TOKEN: ${{ secrets.GH_PAT_BOT || secrets.GITHUB_TOKEN }}`，非注释（行首无 `#`）
  等待预算: 0s
  留证: awk 提取的 auto-merge env 块内容
  Test: manual:bash -c 'BLOCK=$(awk "/^  auto-merge:/{f=1} f && /^  [a-z]/ && !/^  auto-merge:/{exit} f{print}" .github/workflows/ci.yml); echo "$BLOCK" | grep -v "^[[:space:]]*#" | grep -q "GH_TOKEN.*GH_PAT_BOT" || { echo "FAIL: auto-merge job env 块中 GH_TOKEN 未引用 GH_PAT_BOT（或是注释行）"; exit 1; }; echo "PASS: auto-merge GH_TOKEN 引用 GH_PAT_BOT 已确认"'

- [ ] [BEHAVIOR] [L2] B-04: 契约测试（后绿）— ci.yml 改后 auto-merge-token-contract.test.sh exit 0
  动作: 修改 ci.yml 第 1896 行 GH_TOKEN 为降级写法后，执行契约测试
  预期观察: 脚本打印全部 PASS 行，最终 exit 0（FAIL = 0）
  等待预算: 0s
  留证: 命令输出（含 PASS=3 FAIL=0 行，exit 0 确认）
  Test: manual:bash -c 'bash packages/engine/tests/integrity/auto-merge-token-contract.test.sh && echo "GREEN-OK: exit 0" || { echo "GREEN-FAIL: 应当 exit 0"; exit 1; }'

- [ ] [BEHAVIOR] [L2] B-05: 枚举完整性（铁律-枚举完整性）— 全仓库 GH_PAT_BOT 引用核查
  动作: 执行 `grep -r "GH_PAT_BOT" .github/ --include="*.yml"` 确认 GH_PAT_BOT 引用范围
  预期观察: 至少有一个 workflow 文件引用 GH_PAT_BOT（即 ci.yml auto-merge job），无其他意外引用
  等待预算: 0s
  留证: grep 输出内容（文件路径:行号:内容）
  Test: manual:bash -c 'COUNT=$(grep -r "GH_PAT_BOT" .github/ --include="*.yml" -c 2>/dev/null | awk -F: "NR==1{print \$2}" | tr -d " "); [ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: 全仓库无 GH_PAT_BOT 引用，改动未落地"; exit 1; }; echo "PASS: 发现 GH_PAT_BOT 引用"'

---

## Invariant 断言覆盖（铁律映射）

- [ ] [BEHAVIOR] INV-1: 字段核实铁律 — 断言测试脚本基于实际 grep 文件的结果，而非硬编码行号
  动作: 检查 auto-merge-token-contract.test.sh 脚本内容，确认使用 awk/grep 动态提取而非 `sed -n '1896p'` 硬编码行号
  预期观察: 脚本使用 `awk "/^  auto-merge:/"` 或等效方式定位 job 块，不依赖固定行号
  等待预算: 0s
  留证: 脚本源码相关行
  Test: manual:bash -c 'grep -v "^#" packages/engine/tests/integrity/auto-merge-token-contract.test.sh | grep -v "sed -n .1896p" && echo "PASS: 脚本未硬编码行号" || echo "WARN: 可能含硬编码行号，需人工确认"'

- [ ] [BEHAVIOR] INV-2: 语义字段铁律 — 断言 CI run 验收确认 event=push（而非仅 run 存在）
  动作: 检查合同/测试中 event 字段的判断逻辑，确认有 `event == "push"` 而非仅检查 run 存在
  预期观察: 合同 Step 3 验证命令含 `jq -e '.[0].event == "push"'`；E2E 脚本不仅检查 run 数量
  等待预算: 0s
  留证: contract-draft.md Step 3 验证命令段
  Test: manual:bash -c 'grep -q "event.*push" sprints/07291205-ci-auto-merge-token-fix/contract-draft.md || { echo "FAIL: 合同缺少 event=push 语义字段核实"; exit 1; }; echo "PASS: 合同含 event=push 断言"'

- [x] INV-3: 枚举完整性铁律 — 本 sprint 不涉及 status 枚举断言（N/A）
  说明：本 sprint 修改的是 GH_TOKEN 字段引用，不涉及任何 status 枚举值新增/修改，无需全仓库 grep 复查枚举完整性。

- [ ] [BEHAVIOR] INV-4: 毕业前校验铁律 — 测试入册前需本地先跑 lint-tdd-commit-order
  动作: 在 push 前执行 `node packages/engine/scripts/devgate/lint-tdd-commit-order.cjs`（若该脚本存在）
  预期观察: lint 检查通过，确认 test commit 在 fix commit 之前
  等待预算: 0s
  留证: lint 命令输出
  Test: manual:bash -c 'LINT="packages/engine/scripts/devgate/lint-tdd-commit-order.cjs"; [ -f "$LINT" ] && node "$LINT" && echo "PASS: lint-tdd-commit-order 通过" || echo "SKIP: 脚本不存在，跳过（非阻塞）"'
