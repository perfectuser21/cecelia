---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Crystal 第3件 契约 reviewer skill（15 秒轻对抗审契约完备性）

**范围**: 新增独立 skill `skill-contract-auditor`（固化 09-05 轻对抗审技能契约提示词）+ 驱动脚本 scan.mjs（确定性归一/排序/截断/落库/批量）+ 基准 fixtures；判定假设洞经既有 Brain API 写 decisions(category=judgment)。不改第2件九格 CHECKS schema，不并入 GAN 循环，不自动修复契约，无 UI。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] skill 本体存在且声明「非 GAN、单枪、审技能契约本体」，与 harness-contract-reviewer 区分
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/skill-contract-auditor/SKILL.md','utf8');if(!/name:\s*skill-contract-auditor/.test(c)||!c.includes('单枪')||!c.includes('技能契约'))process.exit(1)"

- [ ] [ARTIFACT] SKILL.md 固化三缺陷面（缺失前置 / 不可判定后置 / 未声明失败模式）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/skill-contract-auditor/SKILL.md','utf8');if(!c.includes('缺失前置')||!c.includes('不可判定后置')||!c.includes('未声明失败模式'))process.exit(1)"

- [ ] [ARTIFACT] 驱动脚本 scan.mjs 存在且导出确定性流水线函数（rankFindings/parseSkillContract）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/skill-contract-auditor/scan.mjs','utf8');if(!c.includes('rankFindings')||!c.includes('parseSkillContract'))process.exit(1)"

- [ ] [ARTIFACT] search_account 基准 fixtures（契约 + 8 条录制 findings）存在
  Test: node -e "const fs=require('fs');const d='packages/workflows/skills/skill-contract-auditor/fixtures/';fs.accessSync(d+'search-account-contract.md');const f=JSON.parse(fs.readFileSync(d+'search-account-findings.json','utf8'));if(!Array.isArray(f)||f.length!==8)process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] [L2] B-01: search_account 基准输出 8 条、severity 降序、第一条为 critical 真实死因
  动作: 对 search_account 基准契约+录制 findings 跑 scan.mjs 确定性流水线
  预期观察: report.findings 长度 8，severity 降序，findings[0].id=SA-01-login-vs-notfound 且 severity=critical
  等待预算: 0s
  留证: /tmp/sa-report.json（命令输出末尾 OK 行）
  Test: manual:bash -c 'D=packages/workflows/skills/skill-contract-auditor; node $D/scan.mjs --contract $D/fixtures/search-account-contract.md --findings $D/fixtures/search-account-findings.json --source-ref "skill-contract-auditor:b01" --out /tmp/sa-report.json && jq -e "(.findings|length)==8 and .findings[0].severity==\"critical\" and .findings[0].id==\"SA-01-login-vs-notfound\" and ([.findings[].severity]==([.findings[].severity]|sort_by({critical:0,high:1,medium:2,low:3}[.])))" /tmp/sa-report.json && echo OK'

- [ ] [BEHAVIOR] [L2] B-02: 漏洞数 > 8 时截断到 8 且 truncated=true、total_found 记真实数
  动作: 对 overflow-findings（10 条）跑 scan.mjs
  预期观察: findings 长度 8，truncated=true，total_found>8
  等待预算: 0s
  留证: /tmp/of-report.json
  Test: manual:bash -c 'D=packages/workflows/skills/skill-contract-auditor; node $D/scan.mjs --contract $D/fixtures/search-account-contract.md --findings $D/fixtures/overflow-findings.json --source-ref "skill-contract-auditor:b02" --out /tmp/of-report.json && jq -e "(.findings|length)==8 and .truncated==true and .total_found>8" /tmp/of-report.json && echo OK'

- [ ] [BEHAVIOR] [L2] B-03: 判定假设洞真实写入 Brain decisions(category=judgment) [接缝×2]
  动作: 对 search_account 基准跑 scan.mjs 指向真实 Brain（localhost:5221），再 psql 回读对账
  预期观察: report.judgments_written==4，且 decisions 表近 5 分钟 category=judgment 且 source_ref 匹配的行 ≥4
  等待预算: 30s
  留证: psql 计数输出 + /tmp/sa-b03.json
  Test: manual:bash -c 'D=packages/workflows/skills/skill-contract-auditor; node $D/scan.mjs --contract $D/fixtures/search-account-contract.md --findings $D/fixtures/search-account-findings.json --brain-url "http://localhost:5221" --source-ref "skill-contract-auditor:b03" --out /tmp/sa-b03.json && jq -e ".judgments_written==4" /tmp/sa-b03.json && C=$(psql "$DB_URL" -tAc "SELECT count(*) FROM decisions WHERE category='\''judgment'\'' AND source_ref='\''skill-contract-auditor:b03'\'' AND created_at > NOW() - interval '\''5 minutes'\''" | tr -d " ") && [ "$C" -ge 4 ] && echo OK'

- [ ] [BEHAVIOR] [L2] B-04: 零漏洞契约返回空清单（0 条），不编造洞
  动作: 对零漏洞契约+空 findings 跑 scan.mjs
  预期观察: findings 长度 0，total_found 0，exit 0
  等待预算: 0s
  留证: /tmp/zero-report.json
  Test: manual:bash -c 'D=packages/workflows/skills/skill-contract-auditor; node $D/scan.mjs --contract $D/fixtures/zero-vuln-contract.md --findings $D/fixtures/zero-vuln-findings.json --source-ref "skill-contract-auditor:b04" --out /tmp/zero-report.json && jq -e "(.findings|length)==0 and .total_found==0" /tmp/zero-report.json && echo OK'

- [ ] [BEHAVIOR] [L2] B-05: 非法契约报错（error 对象 + 非 0 exit），不产假空清单
  动作: 对无法解析的 invalid-contract 跑 scan.mjs
  预期观察: 进程非 0 exit，输出含 {"error":"..."} 字符串，绝不返回空 findings
  等待预算: 0s
  留证: 命令捕获输出
  Test: manual:bash -c 'D=packages/workflows/skills/skill-contract-auditor; OUT=$(node $D/scan.mjs --contract $D/fixtures/invalid-contract.md --findings $D/fixtures/search-account-findings.json 2>&1) && { echo "FAIL: 非法契约未非0 exit"; exit 1; } || true; echo "$OUT" | jq -e ".error | type==\"string\"" && echo OK'

- [ ] [BEHAVIOR] [L2] B-06: Brain 不可达只告警不阻塞——清单仍产出、judgments_written=0、stderr WARN
  动作: 指向不可达 Brain URL 跑 scan.mjs
  预期观察: exit 0，findings 8 条，judgments_written=0，stderr 含 warn
  等待预算: 10s
  留证: /tmp/unreach-report.json + /tmp/unreach.err
  Test: manual:bash -c 'D=packages/workflows/skills/skill-contract-auditor; node $D/scan.mjs --contract $D/fixtures/search-account-contract.md --findings $D/fixtures/search-account-findings.json --brain-url "http://127.0.0.1:59999" --source-ref "skill-contract-auditor:b06" --out /tmp/unreach-report.json 2>/tmp/unreach.err && jq -e "(.findings|length)==8 and .judgments_written==0" /tmp/unreach-report.json && grep -qi warn /tmp/unreach.err && echo OK'

- [ ] [BEHAVIOR] [L2] B-07: 单份确定性流水线壁钟 ≤ 15s（NFR 下界 oracle）
  动作: 计时跑一次 search_account 单份扫描
  预期观察: 壁钟 ≤ 15s
  等待预算: 15s
  留证: 耗时打印
  Test: manual:bash -c 'D=packages/workflows/skills/skill-contract-auditor; S=$(date +%s); node $D/scan.mjs --contract $D/fixtures/search-account-contract.md --findings $D/fixtures/search-account-findings.json --source-ref "skill-contract-auditor:b07" --out /tmp/timing.json; E=$(date +%s); [ $((E-S)) -le 15 ] && echo OK || { echo "FAIL: $((E-S))s>15s"; exit 1; }'

- [ ] [BEHAVIOR] [L2] INV-1 [合同验证实跑]: 冻结测试落 sprints/**/tests/（根 vitest include 内）真实产生红/绿 exit code
  动作: 从仓库根跑本 sprint 冻结测试文件
  预期观察: 实现落地前该文件真实 FAIL（非 include 范围外的假绿 exit 0）
  等待预算: 60s
  留证: vitest 输出
  Test: manual:bash -c 'npx vitest run sprints/09052206-kernel-5e43ebd9/tests/ --reporter=dot >/tmp/inv1.log 2>&1; grep -Eq "Test Files|No test files found" /tmp/inv1.log && ! grep -q "No test files found" /tmp/inv1.log && echo OK || { cat /tmp/inv1.log; exit 1; }'

### 铁律映射（Invariant 覆盖）

- INV-1 [合同验证实跑] → 见上方 INV-1 [BEHAVIOR]（冻结测试落 root vitest include 内真实 exit code）。
- [planner分支] → N/A：本 sprint 是 contract propose 阶段，不做 planner checkout/switch。
- [judge证据窗] → N/A：本 sprint 不产出 judge 证据文件，不涉及前 8 条 × 600 字符窗口。
- [台账离git] → N/A：本 sprint 不写 controller 台账（.harness/progress.md）进 repo PR。
- [凭据不混用] → N/A：本 skill 无跨账号凭据操作，Brain 写库用本地端点无第三方凭据。
