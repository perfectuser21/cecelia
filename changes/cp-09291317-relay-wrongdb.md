## Brain {VERSION} — relay project 推送错库 400 自愈

- relay 投影：project 根的 legacy notion_id 指向错库（旧 Cecelia Tasks 库页）时 PATCH 返回 400「Status is expected to be select / AI Project is not a property」，现与 notion-push-sync 同款判据放弃旧页，在 Projects 库重建并回存新 id 与指纹。isWrongDatabaseError 收进统一推送引擎导出，push-sync / probe-projection / relay 三处共用。
