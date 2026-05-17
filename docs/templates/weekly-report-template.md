# 内容运营周报 — {YEAR}-W{WEEK_NUMBER}

> 周期：{START_DATE}（周一）~ {END_DATE}（周日）北京时间
> 生成时间：{GENERATED_AT}
> 数据来源：content_analytics + pipeline_publish_stats

---

## 📊 一、本周发布概况

| 平台 | 发布条数 | 总播放 | 总点赞 | 总评论 | 总分享 | 互动率 |
|------|----------|--------|--------|--------|--------|--------|
| 抖音 | {douyin_count} | {douyin_views} | {douyin_likes} | {douyin_comments} | {douyin_shares} | {douyin_engagement_rate}% |
| 小红书 | {xiaohongshu_count} | {xiaohongshu_views} | {xiaohongshu_likes} | {xiaohongshu_comments} | {xiaohongshu_shares} | {xiaohongshu_engagement_rate}% |
| 微博 | {weibo_count} | {weibo_views} | {weibo_likes} | {weibo_comments} | {weibo_shares} | {weibo_engagement_rate}% |
| 公众号 | {wechat_count} | {wechat_views} | {wechat_likes} | {wechat_comments} | {wechat_shares} | {wechat_engagement_rate}% |
| **合计** | **{total_count}** | **{total_views}** | **{total_likes}** | **{total_comments}** | **{total_shares}** | **{avg_engagement_rate}%** |

---

## 🏆 二、爆款内容 Top 5

| 排名 | 标题 | 平台 | 播放量 | 互动总量 | 热度分 |
|------|------|------|--------|----------|--------|
| 1 | {top1_title} | {top1_platform} | {top1_views} | {top1_engagement} | {top1_score} |
| 2 | {top2_title} | {top2_platform} | {top2_views} | {top2_engagement} | {top2_score} |
| 3 | {top3_title} | {top3_platform} | {top3_views} | {top3_engagement} | {top3_score} |
| 4 | {top4_title} | {top4_platform} | {top4_views} | {top4_engagement} | {top4_score} |
| 5 | {top5_title} | {top5_platform} | {top5_views} | {top5_engagement} | {top5_score} |

> 热度分计算公式：`raw = views×0.1 + likes×3 + comments×5 + shares×7`，归一化到 0-100

---

## 🔥 三、本周高热话题

> 基于 `topic-heat-scorer.js` 分析，heat_score ≥ 60 为高热

| 话题关键词 | 发布数 | 总播放 | 热度分 | 下周推荐 |
|------------|--------|--------|--------|----------|
| {topic1_keyword} | {topic1_count} | {topic1_views} | {topic1_score} | {topic1_recommend} |
| {topic2_keyword} | {topic2_count} | {topic2_views} | {topic2_score} | {topic2_recommend} |
| {topic3_keyword} | {topic3_count} | {topic3_views} | {topic3_score} | {topic3_recommend} |

---

## 📈 四、ROI 分析

| 指标 | 本周 | 上周 | 环比 |
|------|------|------|------|
| 人均播放量 | {avg_views_per_post} | {prev_avg_views} | {views_change}% |
| 人均互动量 | {avg_engagement_per_post} | {prev_avg_engagement} | {engagement_change}% |
| 最高热度分 | {max_heat_score} | {prev_max_heat} | {heat_change}% |
| 高热话题数 | {high_heat_count} | {prev_high_heat_count} | — |

---

## 🎯 五、下周选题建议

> 基于本周高热话题 + 历史4周高热数据，由 `topic-selector.js` 生成

1. **{next_topic_1}** — 推荐指数：{score_1}/100，依据：{reason_1}
2. **{next_topic_2}** — 推荐指数：{score_2}/100，依据：{reason_2}
3. **{next_topic_3}** — 推荐指数：{score_3}/100，依据：{reason_3}
4. **{next_topic_4}** — 推荐指数：{score_4}/100，依据：{reason_4}
5. **{next_topic_5}** — 推荐指数：{score_5}/100，依据：{reason_5}

---

## ⚠️ 六、预警与异常

| 类型 | 描述 | 影响 | 处理建议 |
|------|------|------|----------|
| {alert1_type} | {alert1_desc} | {alert1_impact} | {alert1_action} |

---

## 📋 七、数据采集状态

| 平台 | 采集器 | 最近采集时间 | 数据条数 | 状态 |
|------|--------|------------|----------|------|
| 抖音 | scraper-douyin-v3.js | {douyin_last_collect} | {douyin_total} | {douyin_status} |
| 小红书 | scraper-xiaohongshu-v3.js | {xhs_last_collect} | {xhs_total} | {xhs_status} |
| 微博 | scraper-weibo-v3.js | {weibo_last_collect} | {weibo_total} | {weibo_status} |
| 公众号 | scraper-wechat-v3.js | {wechat_last_collect} | {wechat_total} | {wechat_status} |

---

*由 `weekly-report-generator.js` 自动生成 | Brain v{brain_version} | 每周一 09:00 北京时间发送至飞书*
