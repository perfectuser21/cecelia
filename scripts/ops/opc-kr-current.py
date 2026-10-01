#!/usr/bin/env python3
"""M1: KR Current 自动回写（可机算部分）。

KR3.1 活体 DoD 达标条数：机算 F1/F3/F4/N1 四项（其余归零直到有证据管道）。
KR3.3 晨报成本行：当日 company.md 有非 GREY 成本行 → 1。
其余 KR 的 Current 由经营会议的 Manager 主张+证据回写（下一刀接）。
只写 Current 列，Target 永远归老板。
"""
import json, os, sqlite3, subprocess, sys, time, urllib.request

KRDB = "684c40c2-ba63-83a7-b6ba-8161f110a18c"
NH = {"Authorization": "Bearer " + os.environ.get("NOTION_API_KEY", ""),
      "Notion-Version": "2022-06-28", "Content-Type": "application/json"}


def call(url, body=None, method=None):
    req = urllib.request.Request(url, json.dumps(body).encode() if body else None, NH, method=method)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def objects():
    out = subprocess.run(["docker", "exec", "openclaw-gateway", "node",
                          "/root/.openclaw/opc-objects.mjs", "list"],
                         capture_output=True, text=True, timeout=90)
    d = json.loads(out.stdout)
    assert d.get("ok"), d.get("error")
    return d["records"], d["now_ms"]


def dod_count():
    recs, now = objects()
    passed = []
    # F1 三报 cron 最近状态 ok
    c = sqlite3.connect("file:/opt/openclaw/state/state/openclaw.sqlite?mode=ro", uri=True)
    ids = ["f5e9d665-adeb-4a74-8c25-fc9e26c91cf7", "e7068db0-0bf4-45af-92ec-0ab6f77796a9",
           "583287e7-3446-4fab-bcc2-c3b80276a4d7"]
    ok = 0
    for jid in ids:
        r = c.execute("select state_json from cron_jobs where job_id=?", (jid,)).fetchone()
        if r and json.loads(r[0] or "{}").get("lastRunStatus") == "ok":
            ok += 1
    if ok == 3:
        passed.append("F1")
    # F3 零开环
    live = [r for r in recs if r["状态"] in ("待办", "进行中", "阻塞", "等审批")]
    if live and all(r["下次检查时间"] and r["下次检查时间"] > now - 3600000 for r in live):
        passed.append("F3")
    # F4 自愈闭环 ≥50%
    fix = [r for r in recs if "维修" in r["标题"]]
    done = [r for r in fix if r["状态"] in ("已完成", "完成")]
    if fix and len(done) / len(fix) >= 0.5:
        passed.append("F4")
    # N1 磁盘 <85%
    use = int(subprocess.run(["df", "--output=pcent", "/"], capture_output=True,
                             text=True).stdout.split("\n")[1].strip().rstrip("%"))
    if use < 85:
        passed.append("N1")
    return passed


def cost_line_up():
    day = time.strftime("%Y-%m-%d", time.localtime(time.time() + 8 * 3600))
    p = "/opt/openclaw/workspaces-root/clawd/reports/morning/%s/company.md" % day
    if not os.path.exists(p):
        return 0
    for ln in open(p, encoding="utf-8"):
        if "成本" in ln and "GREY" not in ln:
            return 1
    return 0


def set_current(prefix, value, note):
    rows = call("https://api.notion.com/v1/databases/%s/query" % KRDB, {"page_size": 100})["results"]
    for r in rows:
        t = "".join(x["plain_text"] for x in r["properties"]["Name"]["title"])
        if t.startswith(prefix):
            call("https://api.notion.com/v1/pages/" + r["id"],
                 {"properties": {"Current": {"number": value}}}, "PATCH")
            print("  %s Current -> %s  (%s)" % (prefix, value, note))
            return
    print("  %s 未找到行" % prefix)


def main():
    passed = dod_count()
    set_current("KR3.1", len(passed), "机算通过: " + ",".join(passed))
    set_current("KR3.3", cost_line_up(), "company.md 成本行")


if __name__ == "__main__":
    main()
