---
branch: cp-03192209-fix-content-specs
date: 2026-03-19
type: learning
---

## 修复产出规格对齐最终规范（2026-03-19）

### 根本原因
generate executor 产出字数不对（图文 2500字应该 100字，长文 3200字应该 1000字），review 只检查关键词没检查语气/姿态/分享感。

### 修复方案
1. 图文：标题 + ~100字短文案 + card-data.json（给 /share-card）
2. 长文：标题 + ~1000字 + content.html（给 publisher）
3. NAS 标准目录：exports/（title.txt, image-text-copy.txt, content.html）+ images/
4. review 加语气检查（说教/自嗨）+ 一人公司关联 + 分享感

### 下次预防
- [ ] 产出规格写在 YAML 配置里，executor 从配置读字数限制
- [ ] 新增 executor 前先确认各 publisher 的输入规格
