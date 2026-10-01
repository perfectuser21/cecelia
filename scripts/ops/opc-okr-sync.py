#!/usr/bin/env python3
"""OKR 下行同步 v2：Notion Goals + Key Results（真身）→ agent 执行现场文件。

v1 读的是平面库（2026-09-14 已归档）。真身结构：
  Goals(29ec…)        = Objective，Area relation 挂 ZenithJoy
  Key Results(684c…)  = KR，数字列 Start/Current/Target + Goal relation + Area relation(部门 sub-area)
产出：
  /root/clawd/OKR-CURRENT.md       Director 全量
  /root/clawd-<agent>/OKR.md       各部门只看自己的
"""
import json, os, sys, time, urllib.request

KRDB = "684c40c2-ba63-83a7-b6ba-8161f110a18c"
ROOT = "/opt/openclaw/workspaces-root"
NH = {"Authorization": "Bearer " + os.environ.get("NOTION_API_KEY", ""),
      "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
AREA2AGENT = {"智能获客": ["media"], "新媒体": ["media"], "AI交付FDE": ["fde"],
              "研发部": ["dev"], "人事运营": ["people"], "基础设施": ["infra"],
              "ZenithJoy": ["clawd"]}
_page_title_cache = {}


def call(url, body=None, method=None):
    req = urllib.request.Request(url, json.dumps(body).encode() if body else None, NH, method=method)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def page_title(pid):
    if pid not in _page_title_cache:
        p = call("https://api.notion.com/v1/pages/" + pid)
        t = ""
        for v in p["properties"].values():
            if v.get("type") == "title":
                t = "".join(x["plain_text"] for x in v["title"])
        _page_title_cache[pid] = t
    return _page_title_cache[pid]


def fetch():
    rows, cur = [], None
    while True:
        body = {"page_size": 100}
        if cur:
            body["start_cursor"] = cur
        d = call("https://api.notion.com/v1/databases/%s/query" % KRDB, body)
        rows += d["results"]
        if not d.get("has_more"):
            break
        cur = d["next_cursor"]
    out = []
    for r in rows:
        pr = r["properties"]
        goal_rel = pr.get("Goal", {}).get("relation", [])
        goal = page_title(goal_rel[0]["id"]) if goal_rel else ""
        if not goal.startswith(("O1", "O2", "O3")):
            continue  # 只取公司 OKR，跳过历史杂项
        name = "".join(x["plain_text"] for x in pr["Name"]["title"])
        areas = [page_title(a["id"]) for a in pr.get("Area", {}).get("relation", [])]
        num = lambda k: pr.get(k, {}).get("number")
        st = (pr.get("Status", {}).get("status") or {}).get("name", "")
        out.append({"kr": name, "o": goal, "areas": areas,
                    "start": num("Start"), "cur": num("Current"), "target": num("Target"), "st": st})
    return sorted(out, key=lambda x: x["kr"])


def fmt(rows, title):
    now = time.strftime("%Y-%m-%d %H:%M", time.localtime(time.time() + 8 * 3600))
    L = ["# %s" % title, "",
         "> 快照 %s ｜ 真身在 Notion「Key Results」库（Goal→Objective，Area→部门），本文件自动重写勿手改。" % now, "",
         "| KR | 目标 | 当前 | 进度 | 部门 |", "|---|---|---|---|---|"]
    for r in rows:
        prog = ""
        if r["target"] not in (None, 0):
            prog = "%.0f%%" % ((r["cur"] or 0) / r["target"] * 100)
        L.append("| %s | %s | %s | %s | %s |" % (
            r["kr"], r["target"], r["cur"], prog or "-", "、".join(r["areas"]) or "-"))
    L += ["", "## 会议要求（对每条 KR）",
          "1. 进度：Current 现在是多少、和 Target 差多少（必须带证据引用，无证据写 unknown）",
          "2. 今日计划：为缩小差距今天做什么",
          "3. 阻塞与资源申请：卡在哪、要 Director 或老板给什么", ""]
    return "\n".join(L)


def main():
    rows = fetch()
    if not rows:
        sys.exit("Key Results 里没有 O1-O3 的 KR，拒绝清空现场文件（红线11）")
    open(ROOT + "/clawd/OKR-CURRENT.md", "w").write(fmt(rows, "ZenithJoy 公司 OKR（全量·Director 视图）"))
    n = 1
    for aid in ["media", "fde", "dev", "people", "infra"]:
        ws = "%s/clawd-%s" % (ROOT, aid)
        if not os.path.isdir(ws):
            continue
        mine = [r for r in rows if any(aid in AREA2AGENT.get(a, []) for a in r["areas"])]
        if mine:
            body = fmt(mine, "本部门 KR（%s）" % aid)
        else:
            body = ("# 本部门 KR（%s）\n\n> 暂无直接挂钩的公司 KR。会议上报告支撑性进展："
                    "支撑哪条 KR、做了什么、阻塞是什么。\n" % aid)
        open(ws + "/OKR.md", "w").write(body)
        n += 1
    print("已从真身写 %d 个现场文件（KR %d 条）" % (n, len(rows)))


if __name__ == "__main__":
    main()
