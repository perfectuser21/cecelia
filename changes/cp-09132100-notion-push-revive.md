## Brain {VERSION} — Notion 驾驶舱推送复活

- fix(brain): SUB_AREA_NOTION_IDS 整表死 ID（对 Notion API 全 404）换为 Sub Area 库实查真 ID——此前每条 brain/engine issue 推送 404 被静默标已同步（notion_id 空）无声丢弃；配合 us-vps 补配 NOTION_API_KEY（09-11 迁机丢失致同步链静默停摆两天）
