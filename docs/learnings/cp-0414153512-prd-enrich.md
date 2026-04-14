## PRD Enrich 前置层（2026-04-14）

### 根本原因
autonomous_mode 对 PRD 质量极度敏感。粗 PRD（一句话 / 缺 section）会让 Subagent 自己瞎想方案，Spec Reviewer 也抓不到"需求本身没说清楚"这种元层缺陷。

### 下次预防
- [ ] 新增 PRD Enrich 前置层（Step 0.5）+ enrich-decide.sh 启发式判断（< 500 字节 或缺 section）
- [ ] Enrich Subagent 用 superpowers:brainstorming 5 自问 + 3 轮自 review 框架
- [ ] Stage 1 优先读 enriched PRD（如果存在），否则读 raw
- [ ] feature-registry 和 6 版本文件必须同步 bump（本次踩 PR #2337 同类坑）
