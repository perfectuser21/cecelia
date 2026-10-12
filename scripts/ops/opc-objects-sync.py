#!/usr/bin/env python3
"""飞书多维表格「OPC 经营对象」-> Notion「OPC 经营对象」upsert 同步。

对象状态会变（待办→进行中→已完成），所以按 RecordId 做 upsert，
不是追加。每轮完整分页读取，保留既有 RecordId upsert 口径。
"""
import json, os, sys, time, urllib.error, urllib.request

FEISHU_APP = "Z1oobsDYbaUpcFsTjwWcx8Bmnge"
FEISHU_TABLE = "tbliqtUekfBVWrjw"
NOTION_DB = "3d6c40c2-ba63-811f-a83e-f981a044617d"
NH = {"Authorization": "Bearer " + os.environ.get("NOTION_API_KEY", ""),
      "Notion-Version": "2022-06-28", "Content-Type": "application/json"}

TEXT_FIELDS = ["下一步动作", "阻塞原因", "结果记录", "验收标准", "Human负责人", "证据链接"]
SELECT_FIELDS = ["状态", "负责Agent", "所属部门", "优先级", "审批级别", "执行机器"]
DATE_FIELDS = ["下次检查时间", "阶段更新时间"]


def http(url, payload=None, headers=None, method=None, attempts=4):
    delay = 1.0
    for i in range(attempts):
        try:
            data = json.dumps(payload).encode() if payload is not None else None
            req = urllib.request.Request(url, data, headers or {}, method=method)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r), None
        except urllib.error.HTTPError as e:
            if (e.code == 429 or e.code >= 500) and i < attempts - 1:
                time.sleep(delay); delay *= 2; continue
            return None, "HTTP %s" % e.code
        except Exception as e:
            if i < attempts - 1:
                time.sleep(delay); delay *= 2; continue
            return None, type(e).__name__
    return None, "exhausted"


def flat(v):
    """多维表格字段值形态很杂：str / list / {text} / [{text}]，统一压成纯文本。"""
    if v is None:
        return ""
    if isinstance(v, list):
        return " ".join(flat(x) for x in v).strip()
    if isinstance(v, dict):
        return str(v.get("text") or v.get("name") or v.get("value")
                   or v.get("link") or "").strip()
    return str(v).strip()


def feishu_records():
    required = ["FEISHU_APP_ID", "FEISHU_APP_SECRET"]
    for key in required:
        if not os.environ.get(key, "").strip():
            raise RuntimeError(key + " 未设置（仅使用1Password部署缓存）")
    tok, err = http("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                    {"app_id": os.environ["FEISHU_APP_ID"], "app_secret": os.environ["FEISHU_APP_SECRET"]},
                    {"Content-Type": "application/json"}, "POST")
    if err or tok.get("code") != 0 or not tok.get("tenant_access_token"):
        raise RuntimeError("飞书认证失败（响应内容不进入日志）")
    T = tok["tenant_access_token"]
    H = {"Authorization": "Bearer " + T, "Content-Type": "application/json"}
    items, pt, seen = [], None, set()
    while True:
        u = ("https://open.feishu.cn/open-apis/bitable/v1/apps/%s/tables/%s/records"
             "?page_size=100" % (FEISHU_APP, FEISHU_TABLE))
        if pt:
            u += "&page_token=" + pt
        d, err = http(u, None, H)
        if err or d.get("code") != 0 or not isinstance(d.get("data"), dict):
            raise RuntimeError("飞书读表失败")
        d = d["data"]
        if not isinstance(d.get("items"), list) or not isinstance(d.get("has_more"), bool):
            raise RuntimeError("飞书分页响应不完整")
        items += d["items"]
        if not d.get("has_more"):
            break
        pt = d.get("page_token")
        if not pt or pt in seen:
            raise RuntimeError("飞书分页游标缺失或重复")
        seen.add(pt)
    return items


def notion_existing():
    """RecordId -> page_id"""
    out, cur, seen = {}, None, set()
    while True:
        p = {"page_size": 100}
        if cur:
            p["start_cursor"] = cur
        d, err = http("https://api.notion.com/v1/databases/%s/query" % NOTION_DB, p, NH)
        if err:
            sys.exit("查 Notion 失败: %s" % err)
        if not isinstance(d.get("results"), list) or not isinstance(d.get("has_more"), bool):
            raise RuntimeError("Notion分页响应不完整")
        for r in d["results"]:
            rt = r["properties"].get("RecordId", {}).get("rich_text", [])
            if rt:
                out[rt[0]["plain_text"]] = r["id"]
        if not d.get("has_more"):
            break
        cur = d.get("next_cursor")
        if not cur or cur in seen:
            raise RuntimeError("Notion分页游标缺失或重复")
        seen.add(cur)
    return out


def build_props(rec):
    f = rec["fields"]
    title = flat(f.get("标题")) or "(无标题)"
    props = {
        "标题": {"title": [{"text": {"content": title[:1900]}}]},
        "RecordId": {"rich_text": [{"text": {"content": rec["record_id"]}}]},
    }
    for k in SELECT_FIELDS:
        v = flat(f.get(k))
        props[k] = {"select": {"name": v[:100]}} if v else {"select": None}
    for k in TEXT_FIELDS:
        v = flat(f.get(k))
        props[k] = {"rich_text": [{"text": {"content": v[:1900]}}] if v else []}
    for k in DATE_FIELDS:
        v = f.get(k)
        iso = None
        if isinstance(v, (int, float)) and v > 0:
            iso = time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.gmtime(v / 1000 + 8 * 3600))
        props[k] = {"date": {"start": iso} if iso else None}
    return props


def main():
    if not os.environ.get("NOTION_API_KEY", "").strip():
        raise RuntimeError("NOTION_API_KEY 未设置")
    NH["Authorization"] = "Bearer " + os.environ["NOTION_API_KEY"]
    recs = feishu_records()
    if not recs or len({r["record_id"] for r in recs}) != len(recs):
        raise RuntimeError("飞书源为空或RecordId重复，拒绝写入")
    existing = notion_existing()
    created = updated = failed = 0
    for rec in recs:
        props = build_props(rec)
        pid = existing.get(rec["record_id"])
        if pid:
            _, err = http("https://api.notion.com/v1/pages/" + pid,
                          {"properties": props}, NH, "PATCH")
            if err:
                failed += 1; sys.stderr.write("更新失败 %s: %s\n" % (rec["record_id"], err))
            else:
                updated += 1
        else:
            _, err = http("https://api.notion.com/v1/pages",
                          {"parent": {"database_id": NOTION_DB}, "properties": props}, NH, attempts=1)
            if err:
                failed += 1; sys.stderr.write("新建失败 %s: %s\n" % (rec["record_id"], err))
            else:
                created += 1
        time.sleep(0.35)
    print(json.dumps({"source_count": len(recs), "created": created, "updated": updated, "failed": failed}, ensure_ascii=False))
    if failed:
        raise RuntimeError("经营对象同步部分失败，不得记为成功")


if __name__ == "__main__":
    main()
