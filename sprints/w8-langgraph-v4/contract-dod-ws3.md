---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: 终态校验 + 报告生成器 + lead 自验文件骨架（含 R3 24h SLA helper）

**范围**: 实现 `scripts/acceptance/w8-v4/render-report.mjs` 四函数：renderAcceptanceReport / renderLeadEvidence / writeReportFiles / **assertInterruptResumeSla**
**大小**: M
**依赖**: Workstream 2（render 时读取 fault-inject 产物 + assertInterruptResumeSla 写 inject-b.json）

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/acceptance/w8-v4/render-report.mjs` 文件存在
  Test: node -e "const fs=require('fs');if(!fs.existsSync('scripts/acceptance/w8-v4/render-report.mjs'))process.exit(1)"

- [ ] [ARTIFACT] render-report.mjs 导出四个具名函数（原 3 + R3 新增 1）
  Test: node -e "import('./scripts/acceptance/w8-v4/render-report.mjs').then(m => { for (const fn of ['renderAcceptanceReport','renderLeadEvidence','writeReportFiles','assertInterruptResumeSla']) { if (typeof m[fn] !== 'function') process.exit(1); } })"

- [ ] [ARTIFACT] 含 6 个 acceptance 报告必备章节标题字面量（防漏写章节）
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/render-report.mjs','utf8'); for(const k of ['graph_node_update','故障注入 A','故障注入 B','故障注入 C','v3','watchdog']){ if(!c.includes(k)) process.exit(1); }"

- [ ] [ARTIFACT] 含 5 个 lead 自验关键字字面量
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/render-report.mjs','utf8'); for(const k of ['rev-parse','brain/status','/api/brain/tasks','task_events','status FROM tasks']){ if(!c.includes(k)) process.exit(1); }"

- [ ] [ARTIFACT] writeReportFiles 调用 mkdir 之后再 write（原子保证）
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/render-report.mjs','utf8'); if(!c.match(/mkdir[\\s\\S]*?writeFile|fs\\.promises\\.mkdir[\\s\\S]*?fs\\.promises\\.writeFile/)) process.exit(1);"

- [ ] [ARTIFACT] assertInterruptResumeSla 含 86400 字面量（24h 阈值）和 'inject-b.json' 文件名字面量
  Test: node -e "const c=require('fs').readFileSync('scripts/acceptance/w8-v4/render-report.mjs','utf8'); if(!c.includes('86400')) process.exit(1); if(!c.includes('inject-b.json')) process.exit(1);"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/render-report.test.ts`，覆盖：
- `renderAcceptanceReport` 普通 mode 输出 ≥ 2000 字节，含 6 个关键章节字面量
- `renderAcceptanceReport` mode='dryrun-nodes-only' 时输出含 "14/14" 字面量供 Step 3 dryrun 校验
- `renderAcceptanceReport` 含 slaCaveats 时报告输出 24h SLA caveat 段（R3）
- `renderLeadEvidence` 输出 ≥ 1000 字节且含 5 个 lead 命令关键字
- `writeReportFiles` 给定不存在的嵌套路径时先创建目录再写文件，写入后内容可读回
- **(R3)** `assertInterruptResumeSla` delta < 24h → withinSla=true 且写 happy 标记到 inject-b.json
- **(R3)** `assertInterruptResumeSla` delta ≥ 24h → withinSla=false 写 caveat 字段到 inject-b.json 但不抛错
