## Brain {VERSION} — 归位器永远判新建修复（任务 912c1143，链 2afa6d69 第 6 棒）

- 病根（2026-10-01 生产 be95ec9c 实测）：`POST /api/brain/projects/locate` 本项目排第一却 score=0.145<0.55 判 create；口语一句话前三全是 inactive 的「Test Project」。三因：embedding 对 200+ 候选逐个调用套 800ms 总超时必回退关键词；关键词用 Jaccard（交集/并集）被长候选文本稀释，又与语义共用 0.55 阈值；候选含 176 条 okr_projects 搬家带来的 inactive 历史项目。
- 修法：关键词分改 query 覆盖率（交集/query 有效 token 数），过滤单字与含口语虚词的 bigram；关键词阈值独立 `PROJECT_LOCATE_KEYWORD_THRESHOLD` 默认 0.5，语义仍 `PROJECT_LOCATE_THRESHOLD` 0.55，响应 threshold 随打分方式返回；embedding 只对关键词预筛前 20 名调用；候选排除 inactive；reason 标签改 `keyword_bigram_coverage`。
- 回归测试：project-locate.test.js 5 条（生产原句 attach / 噪音不压过真项目 / 阈值分开 / embedding 预筛 / 无关句仍低分）+ 真库集成测试长描述判 attach 与 inactive 不参与。
