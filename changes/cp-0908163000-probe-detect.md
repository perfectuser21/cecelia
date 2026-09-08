## Brain {VERSION} — 探针检测：DisCo 档位补全最后一块拼图

- `detectPostcondition` 从 SKILL.md 正文判断 skill 有无探针（识别「产出契约」段、postcondition、后置条件、最小 evidence 等**结构化声明**；随口一句"记得验证"不算——那不是机器能检查的东西）。结果落 `ops_skills.has_postcondition`。
- 补上后 DisCo 三条固化判据齐备（频率 + 变体收敛度 + 探针），档位可自动判定，不再停在"数据不全等人确认"。判据来自决策：**无 postcondition 不许固化**，因为"碎了能当场发现"是固化前提。
- 未知一律判 false——不知道有没有探针时按"没有"处理，宁可不升档也不误固化。
