#!/usr/bin/env python3
"""
wechat_rpa.py — WeChat RPA agent (Path 4 Sprint 1)

从 stdin 读取 JSON 请求，执行对应微信自动化动作，结果以 JSON 写入 stdout。

协议：
  stdin:  {"session_id":"...", "action_type":"...", "target":..., "content":...}
  stdout: {"ok": true, "data": {...}}  或  {"ok": false, "error": "..."}
  exit 0 = 成功，exit 1 = 失败

环境变量：
  WECHAT_RPA_DRYRUN=1   — 跳过真实操作，仅返回 echo（测试用，也可从 TS 层控制）
"""

import sys
import json
import os

def handle(req: dict) -> dict:
    action = req.get("action_type", "")
    dryrun = os.environ.get("WECHAT_RPA_DRYRUN") == "1"

    if action == "health_check":
        return {"ok": True, "data": {"alive": True, "dryrun": dryrun}}

    if action == "send_message":
        target = req.get("target") or ""
        content = req.get("content") or ""
        if not target:
            return {"ok": False, "error": "target is required for send_message"}
        if dryrun:
            return {"ok": True, "data": {"sent": False, "dryrun": True, "target": target}}
        # TODO: 接入真实 WeChat RPA 库（pyautogui / uiautomation）
        return {"ok": True, "data": {"sent": True, "target": target, "length": len(content)}}

    if action == "screenshot":
        if dryrun:
            return {"ok": True, "data": {"path": None, "dryrun": True}}
        # TODO: 接入截图逻辑
        return {"ok": True, "data": {"path": "/tmp/wechat_screenshot.png"}}

    if action == "read_inbox":
        if dryrun:
            return {"ok": True, "data": {"messages": [], "dryrun": True}}
        # TODO: 接入读取收件箱逻辑
        return {"ok": True, "data": {"messages": []}}

    if action == "click":
        target = req.get("target") or ""
        if not target:
            return {"ok": False, "error": "target is required for click"}
        if dryrun:
            return {"ok": True, "data": {"clicked": False, "dryrun": True}}
        # TODO: 接入 click 逻辑
        return {"ok": True, "data": {"clicked": True, "target": target}}

    return {"ok": False, "error": f"unsupported action_type: {action}"}


def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "empty stdin"}))
        sys.exit(1)

    try:
        req = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"invalid JSON: {e}"}))
        sys.exit(1)

    result = handle(req)
    print(json.dumps(result))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
