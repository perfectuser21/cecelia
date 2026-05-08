---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 3: 真发执行 + 证据回写 STATUS.md

**范围**: Lead 走完 7 步 checklist，把真 cmd stdout / 截图 / 新 item_id / 签名填回 evidence；STATUS.md 视频条目 item_id 更新为本次真发的 ID（≠ 7605861760767233306）
**大小**: M（涉及真账号操作 + 文档回写）
**依赖**: WS1 + WS2 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] STATUS.md 含本次新 item_id（19 位数字字符串，且 ≠ 7605861760767233306 历史值）
  Test: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/douyin-publisher/STATUS.md','utf8');const m=c.match(/[0-9]{19}/g)||[];const fresh=m.filter(x=>x!=='7605861760767233306'&&x!=='7605837846758313266');if(fresh.length===0)process.exit(1)"`

- [ ] [ARTIFACT] STATUS.md 历史 item_id 7605861760767233306 含"历史/旧/废弃/已替换"显式标注（前后 2 行内）
  Test: `grep -B2 -A2 "7605861760767233306" packages/workflows/skills/douyin-publisher/STATUS.md | grep -qiE "历史|旧值|废弃|已替换|deprecated|legacy" || exit 1`

- [ ] [ARTIFACT] evidence 含同一个 item_id（一致性证据：STATUS.md 与 evidence 双向匹配）
  Test: `node -e "const fs=require('fs');const s=fs.readFileSync('packages/workflows/skills/douyin-publisher/STATUS.md','utf8');const e=fs.readFileSync('.agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md','utf8');const fresh=(s.match(/[0-9]{19}/g)||[]).filter(x=>x!=='7605861760767233306'&&x!=='7605837846758313266');if(!fresh.some(id=>e.includes(id)))process.exit(1)"`

- [ ] [ARTIFACT] evidence 含 Lead 签名行（"Cecelia, 2026-05-0X, 自验通过" 真签字而非占位 YYYY）
  Test: `grep -qE "Cecelia.*2026-05-0[0-9].*自验通过|Cecelia.*自验通过.*2026-05-0[0-9]" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md || exit 1`

- [ ] [ARTIFACT] evidence 含 CDP 19222 真探活输出（webSocketDebuggerUrl 字段或 type=page 真返回内容）
  Test: `grep -qE "webSocketDebuggerUrl|\"type\":\"page\"|devtools/page" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md || exit 1`

- [ ] [ARTIFACT] evidence 含 Mac mini 真触发 batch-publish 的 stdout（含 PASS / Connected 字样之一）
  Test: `grep -qE "PASS:.*item_id|Connected to|published item_id=" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md || exit 1`

- [ ] [ARTIFACT] evidence 含 Windows 路径真 ls 输出（证明 Lead 真 ssh xian-pc 跑 dir/ls 看文件）
  Test: `grep -qE "C:\\\\Users\\\\xuxia|C:/Users/xuxia|xuxia.douyin-media|video\\.mp4|title\\.txt" .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md || exit 1`

- [ ] [ARTIFACT] `.agent-knowledge/content-pipeline-douyin/screenshots/` 目录含 ≥ 3 张真截图文件
  Test: `[ "$(find .agent-knowledge/content-pipeline-douyin/screenshots -type f \\( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \\) | wc -l)" -ge "3" ] || exit 1`

- [ ] [ARTIFACT] 每张截图 mtime ≥ sprint 启动日 2026-05-08（防止重用历史截图）
  Test: `SPRINT_START=$(date -d "2026-05-08" +%s 2>/dev/null || date -j -f "%Y-%m-%d" "2026-05-08" +%s); for f in $(find .agent-knowledge/content-pipeline-douyin/screenshots -type f \\( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \\)); do MT=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f"); [ "$MT" -ge "$SPRINT_START" ] || exit 1; done`

- [ ] [ARTIFACT] evidence mtime ≥ sprint 启动日 2026-05-08（防止重用旧 evidence 文件）
  Test: `SPRINT_START=$(date -d "2026-05-08" +%s 2>/dev/null || date -j -f "%Y-%m-%d" "2026-05-08" +%s); MT=$(stat -c %Y .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md 2>/dev/null || stat -f %m .agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md); [ "$MT" -ge "$SPRINT_START" ] || exit 1`

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/real-publish-evidence.test.ts`，覆盖：
- 解析 STATUS.md：提取本次 item_id（19 位数字 ≠ 7605861760767233306）
- 解析 evidence：提取的 item_id 与 STATUS.md 一致
- 解析 evidence：含 Lead 真签名（含 sprint 周期内日期）
- 解析 evidence：含 CDP/Mac mini/Windows 路径三类真 stdout
- 解析 screenshots/：≥ 3 张文件且 mtime 在 sprint 周期内
