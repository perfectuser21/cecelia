## Brain {VERSION} — Notion 推送回收站页自愈 + Issues Status 映射

- notion 推送：PATCH 返回 400「Can't edit page on block with an archived ancestor」（页或所在库进回收站）视同 404，清 notion_id 与指纹下轮重建。覆盖 tasks、skill_registry、统一推送引擎（issues 等）与 relay project 投影；新增 isPageGoneError。
- issues 推送：Status 映射到 Notion Issues 库合法选项（Backlog→Open、Done→Closed、open→Open、closed→Closed，大小写不敏感，未知→Open），修「Invalid status option」每轮失败。
