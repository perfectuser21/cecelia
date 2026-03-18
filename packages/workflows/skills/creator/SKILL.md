---
description: 内容制作中心 — 所有卡片、图文、视觉内容生成工具的入口目录。触发词：做内容、做图、做卡片、内容制作、content creator、有哪些卡片工具、我要做一套内容、制作素材
---

# /creator — 内容生成中枢

## 触发方式

```
/creator <主题或模板>
/creator 一人公司案例 Dan Koe
/creator solopreneur 案例
```

---

## 路由规则

根据用户意图选择对应子技能，通过 **Read 工具读取子技能文件** 后按其指示执行。

| 意图关键词 | 子技能路径 |
|-----------|-----------|
| 一人公司、solopreneur、个人品牌案例、成功案例 | `packages/workflows/skills/creator/solo-company-case/SKILL.md` |

---

## 路由方法（CRITICAL）

**技能不可调用技能**。正确做法：

```
1. 识别用户意图
2. 匹配上表路由
3. Read packages/workflows/skills/creator/<sub>/SKILL.md
4. 按读取到的文件指示执行（不再递归调用）
```

---

## 新增子技能

在 `packages/workflows/skills/creator/` 下新建目录，放入 `SKILL.md`，在上表添加路由条目即可。
