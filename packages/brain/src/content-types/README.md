# content-types/

内容类型 YAML 注册表目录。每个 `.yaml` 文件定义一种内容类型的配置。

## 新增内容类型

在此目录下新建 `<type-name>.yaml`，无需修改任何代码。

**完整指南**：`docs/content-type-guide.md`

## 必填字段

```yaml
content_type: <type-name>        # 与文件名一致
images:
  count: <正整数>                 # 生成图片数量
template:
  generate_prompt: <string>       # 生成阶段提示词，支持 {keyword}
review_rules: []                  # 审查规则（可为空）
copy_rules: {}                    # 文案规则（可为空）
```

## 文件

| 文件 | 说明 |
|------|------|
| `content-type-registry.js` | YAML 加载器（`getContentType` / `listContentTypes` / `loadAllContentTypes`） |
| `content-type-validator.js` | 格式校验器（`validateContentType` / `validateAllContentTypes`） |
| `solo-company-case.yaml` | 独立公司案例内容类型（示例） |
