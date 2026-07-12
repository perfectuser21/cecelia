# Learning: pre-flight 占位符检测误杀驼峰/蛇形标识符

任务：51dafd1e-7bcc-4c19-83e7-d4b162ae35ba ｜ 分支：cp-07120833-preflight-xxx-fix

### 根本原因

pre-flight-check.js 的 hasXxx 正则意图是"xxx 只在非中文语境下判占位符"，
但 lookaround 只排除了非 ASCII（CJK）邻接字符，没有排除 ASCII 字母/数字邻接。
真实标识符（parseXxxResponse、_setXxx()、checkXxxAvailable()）lowercase 后
xxx 前后是 ASCII 字母，照样命中占位符判定。arch_review 定时任务的 line_ledger
digest 常引用 learnings 原文里的此类标识符，导致 pre-flight 三振
（PRE_FLIGHT_MAX_STRIKES=3）永久 blocked——最近 8 条 arch_review 任务 5 条
pre_flight_rejected，自动巡检管线系统性瘫痪 2 天以上。

修法：叠加 lookaround，xxx 邻接字符既不能是 ASCII 字母/数字/下划线
（排 camelCase 与 snake_case 标识符），也不能是非 ASCII（保留 CJK 排除，
测试 D2 锁定）。误报代价（管线瘫痪）远重于漏报（任务照常跑），故取舍
偏向排除更多标识符形态（含下划线）。

### 下次预防

- [ ] 写"文本启发式判定"类正则（占位符/敏感词/格式探测）时，负向条件必须
      枚举完整字符类别：排除了 CJK 不等于排除了标识符，用"邻接字符白名单"
      （只有空格/标点/边界才算独立 token）思维替代"排除某一类"思维。
- [ ] 定时管线（arch_review 等）连续多次 blocked 同一 reason 时应有升级告警：
      现有 P0 burst 告警止于飞书，本次瘫痪 2 天无人发现；需要用户立即处理的
      告警应走 Bark（既有缺口，未在本 PR 范围）。
- [ ] regression test（D4 段）已永久留 CI：4 条标识符不误判 + 1 条标点邻接
      独立 xxx 仍判定，加上既有 D2 CJK 用例共同锁死正则行为边界。
