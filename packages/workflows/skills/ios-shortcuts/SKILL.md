---
id: ios-shortcuts
description: 用 Python 程序化构建 iOS Shortcuts plist 文件，签名并分发给 iPhone 用户安装
version: 1.0.0
created: 2026-05-19
updated: 2026-05-19
changelog:
  - 1.0.0: 初始版本，基于抖音内容剪藏流程实战总结
---

# iOS Shortcuts 构建 Skill

## 概述

通过 Python 生成 iOS Shortcuts `.shortcut`（binary plist）文件，在 xian-m4 签名后托管分发。
适用于从 iPhone 触发后端 webhook、自动化内容处理等场景。

---

## 关键结论（实战总结）

### ✅ 可靠的 Action Identifiers

| 功能 | 正确 ID | 错误 ID |
|------|---------|--------|
| HTTP 请求 | `is.workflow.actions.downloadurl` | `is.workflow.actions.gethttpcontents`（旧版，部分 iOS 不存在） |
| 弹通知 | `is.workflow.actions.notification` | `is.workflow.actions.shownotification`（已废弃） |
| 读剪贴板 | `is.workflow.actions.getclipboard` | — |
| 输入弹框 | `is.workflow.actions.ask` | — |
| 存变量 | `is.workflow.actions.setvariable` | — |

### ✅ HTTP 动态值：唯一可靠方案

**变量只能放 Form body，不能放 WFURL 或 JSON body。**

| 方案 | 结果 |
|------|------|
| `WFURL` 里嵌变量（query string） | ❌ 变量始终为空，query 被丢弃 |
| `WFHTTPBodyType: 'JSON'` + `WFHTTPRequestBodyEntries` | ❌ body 始终为 `{}` |
| `WFHTTPBodyType: 'Form'` + `WFFormValues` | ✅ 稳定可靠 |

### ✅ 引用 Action 输出：用 OutputUUID，不走 setvariable

`ask` → `setvariable` → 引用变量 = 值为空（pipe 未正确传递）。

直接用 `ActionOutput + OutputUUID` 引用上一个 action 输出，稳定。

---

## 标准模板：Ask 弹框 → POST Form → 通知

```python
import plistlib, uuid

ask_uuid = str(uuid.uuid4()).upper()

actions = [
    # 1. 弹输入框让用户粘贴
    {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.ask',
        'WFWorkflowActionParameters': {
            'UUID': ask_uuid,
            'WFAskActionPrompt': '粘贴链接',
            'WFInputType': 'Text',
        }
    },
    # 2. POST Form，直接引用 ask 的 OutputUUID（不经过 setvariable）
    {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
        'WFWorkflowActionParameters': {
            'UUID': str(uuid.uuid4()).upper(),
            'WFHTTPMethod': 'POST',
            'WFURL': 'https://your-webhook.example.com/endpoint',
            'WFHTTPBodyType': 'Form',
            'WFFormValues': {
                'Value': {
                    'WFDictionaryFieldValueItems': [
                        {
                            'WFItemType': 0,
                            'WFKey': {
                                'Value': {'string': 'url'},
                                'WFSerializationType': 'WFTextTokenString'
                            },
                            'WFValue': {
                                'Value': {
                                    'attachmentsByRange': {
                                        '{0, 1}': {
                                            'Type': 'ActionOutput',
                                            'OutputName': 'Provided Input',
                                            'OutputUUID': ask_uuid  # ← 直接引用 ask UUID
                                        }
                                    },
                                    'string': '￼'  # U+FFFC 占位符
                                },
                                'WFSerializationType': 'WFTextTokenString'
                            }
                        }
                    ]
                },
                'WFSerializationType': 'WFDictionaryFieldValue'
            }
        }
    },
    # 3. 通知
    {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.notification',
        'WFWorkflowActionParameters': {
            'UUID': str(uuid.uuid4()).upper(),
            'WFNotificationActionTitle': '✅ 已送出',
            'WFNotificationActionBody': '处理中...',
            'WFNotificationActionSound': True
        }
    }
]

shortcut = {
    'WFQuickActionSurfaces': [],
    'WFWorkflowActions': actions,
    'WFWorkflowClientVersion': '2600.0.48',
    'WFWorkflowHasOutputFallback': False,
    'WFWorkflowHasShortcutInputVariables': False,
    'WFWorkflowIcon': {
        'WFWorkflowIconGlyphNumber': 59511,
        'WFWorkflowIconStartColor': 1869967359
    },
    'WFWorkflowImportQuestions': [],
    'WFWorkflowInputContentItemClasses': [],
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowOutputContentItemClasses': [],
    'WFWorkflowTypes': ['Watch', 'Widget']
}

with open('my-shortcut.shortcut', 'wb') as f:
    plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)
```

---

## 签名与分发

**签名必须在有 iCloud 账号的 Mac 执行（xian-m4）：**

```bash
# 生成 → 传到 xian-m4 → 签名 → 取回 → 托管
scp my-shortcut.shortcut xian-m4:/tmp/
ssh xian-m4 "shortcuts sign --input /tmp/my-shortcut.shortcut --output /tmp/my-shortcut-signed.shortcut --mode anyone"
scp xian-m4:/tmp/my-shortcut-signed.shortcut ./
scp my-shortcut-signed.shortcut administrator@38.23.47.81:~/claude-output/
```

iPhone 安装：Safari 打开 `http://38.23.47.81:9998/文件名.shortcut`

> `shortcuts sign` 会打印几行 `ERROR: Unrecognized attribute string flag` 警告，可忽略，签名正常完成。

---

## N8N Webhook 接收 Form POST

```javascript
// Platform Detection Code Node
const body = $input.first().json.body || {};
const query = $input.first().json.query || {};
let rawInput = body.url || query.url || '';

// 从抖音分享文本提取干净 URL（抖音复制链接带大段文字）
function extractURL(text) {
  const m = text.match(/https?:\/\/(?:v\.douyin\.com|douyin\.com|xhslink\.com|xiaohongshu\.com|mp\.weixin\.qq\.com)[^\s\r\n]*/);
  return m ? m[0].replace(/\/+$/, '') : text.trim();
}
const url = rawInput.includes('http') ? extractURL(rawInput) : rawInput.trim();
```

N8N Webhook `responseMode` 注意：
- 有 `respondToWebhook` 节点 → `responseMode` 必须设为 `responseNode`
- 否则报 "Unused Respond to Webhook node found" 错误

---

## 触发方式

| 方式 | 路径 | 适合场景 |
|------|------|---------|
| 手动点击 | 快捷指令 App 首页 | 默认 |
| Back Tap 双击 | 设置 → 辅助功能 → 触控 → 轻点背面 | 高频使用 |
| 主屏小组件 | 长按主屏 → 添加小组件 → 快捷指令 | 可见性高 |

---

## 常见坑

1. **WFURL 里的变量不生效**：无论怎么写 `attachmentsByRange`，WFURL 的变量替换在 iOS 上不稳定。解法：变量放 Form body，URL 用静态字符串。

2. **setvariable 管道问题**：`ask` → `setvariable` → 在 body 引用变量 = 空。解法：用 `ActionOutput + OutputUUID` 直接引用，跳过 setvariable。

3. **Background 模式下 ask 失效**：Back Tap / Siri 等后台触发时，`ask` 弹框不显示，返回空值。后台场景改用 `getclipboard` 读剪贴板。

4. **中文文件名**：iOS Safari 会自动处理 URL 编码，中文名 shortcut 文件可正常安装。

5. **WFHTTPBodyType 大小写**：`'Form'`（首字母大写）可用，`'JSON'`（大写）iOS 会忽略 body，改用 Form。
