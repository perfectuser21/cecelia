# relay project 推送错库 400 每轮重试（09-29）

### 根本原因
- 3 个 project 根的 notion_id 指向旧 Cecelia Tasks 库（迁移 488 已登记 archived）的页面，不是 Projects 库页。relay 投影不看指纹就 PATCH，按 Projects 库属性发送必然 400「Status is expected to be select / AI Project is not a property」。
- relay 的自愈判据 isGone 只认 404 与 archived ancestor，没有 notion-push-sync 早已有的错库判据；错库判据在 push-sync 和 probe-projection 各复制一份，relay 漏了。

### 下次预防
- [ ] 推送自愈判据（页不可用 / 错库）只从统一推送引擎导入，新投影禁止自写正则
- [ ] 新投影写 notion_id 前先判断旧 id 是否本投影所建（看指纹/所属库），不是就不 PATCH 旧对象
