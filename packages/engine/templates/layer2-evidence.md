# Layer 2 效果验证证据

> 此文件记录 Layer 2 效果验证的证据。
> - 截图证据：S1, S2, S3...（必须有实际文件）
> - API 证据：C1, C2, C3...（必须包含 HTTP_STATUS）

---

## 截图证据

### S1: 功能页面截图描述
- 文件: `./artifacts/screenshots/S1-description.png`
- 说明: 页面显示了什么内容

### S2: 另一个功能截图
- 文件: `./artifacts/screenshots/S2-description.png`
- 说明: 页面显示了什么内容

---

## API 验证证据

### C1: API 接口名称
```bash
$ curl -X POST http://localhost:3000/api/endpoint \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'

HTTP_STATUS: 200

{
  "status": "ok",
  "data": {...}
}
```

### C2: 另一个 API 接口
```bash
$ curl http://localhost:3000/api/another

HTTP_STATUS: 200

{
  "result": "success"
}
```

---

## 验证规则

1. **截图证据 (S*)**
   - 必须有 `### S1:` 格式的标题
   - 必须有 `文件:` 行指向实际文件
   - 文件必须存在于 `./artifacts/screenshots/`

2. **API 证据 (C*)**
   - 必须有 `### C1:` 格式的标题
   - curl 输出必须包含 `HTTP_STATUS: xxx`
   - 建议包含完整的请求命令和响应

3. **pr-gate-v2.sh 验证**
   - 检查 S* 对应的文件是否存在
   - 检查 C* 块是否包含 HTTP_STATUS
   - 检查 .dod.md 中的 Evidence 引用是否有效
