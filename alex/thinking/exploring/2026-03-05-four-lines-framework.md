# Personal OS：从四条线到三条 Pipeline

## 演化过程

原始设计（Notion）有四条线：GTD、Content、Knowledge、AI/Build。
经过探讨，AI/Build 合并进 GTD —— AI 只是加速了 GTD 的执行，不是独立管道。

## 最终模型：三条 Pipeline

```
Input Layer
  ├── Ideas Box（内在：想法、灵感、反思）
  └── Reference DB（外部：文章、视频、别人的框架）

Pipeline Layer（三条）
  1. GTD Pipeline:       Task → Event / Project Notes
  2. Content Pipeline:   Seed → Core → Portfolio
  3. Knowledge Pipeline: Idea → Insight → OKD

Meta Layer
  └── OKR（方向，定期分解出 Task）
```

## 关键决策

### AI/Build 合并进 GTD（不再是独立管道）

- 原因：AI 不改变"做什么"，只改变"谁做、多快做完"
- AI/Build = GTD 的执行加速器
- Cecelia Brain 派发 /dev 任务 = AI 自动执行 GTD 里的 Task
- 不需要独立管道，Task 有个 executor 属性（human / ai）就够了

### 每次 Pipeline 状态转换 = 一个 Task

- Seed → Core 是一个 Task（有人要写、研究、打磨）
- Idea → Insight 是一个 Task（有人要深度思考、提炼）
- Task DB 是唯一的执行引擎，驱动所有三条 Pipeline

### 三条 Pipeline 的区别

| Pipeline | 对象性质 | 流动方式 |
|----------|----------|----------|
| GTD | 行动（做事） | 离散：done / not done |
| Content | 作品（创作） | 阶段：Seed → Core → Portfolio |
| Knowledge | 认知（沉淀） | 深度：Idea → Insight → OKD |

## 待探讨

- [ ] Reference DB 是否也能分流到 Content / GTD（不只喂 Knowledge）？
- [ ] 三条 Pipeline 跟 Cecelia 的 Area 概念如何对应？
- [ ] Pipeline 之间的反馈回路怎么建模？（做完事产生新想法 → 回到 Ideas Box）
