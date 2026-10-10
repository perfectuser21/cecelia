## Brain {VERSION} — 技能工厂看板「skill@版本」不再塞整份 skill 正文

- 生产实测：抖音·视频发布第 3 次试跑交付的 result.delivery.flow_skill_v1 是整份 skill 正文，看板「skill@版本」单元格被塞进上千字。现在遇到带 frontmatter 的正文只取 `name@version`（如 android-douyin-private-video@1.0.0），没有 frontmatter 的取第一行并截到 80 字。
