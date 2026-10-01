#!/usr/bin/env python3
"""公司 KR 原口径机算：当前快照不代表连续七天，先登记再写 Brain。"""
import json
import os
import sqlite3
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from uuid import UUID, uuid4

BRAIN = os.environ.get("CECELIA_BRAIN_API", "http://localhost:5221/api/brain").rstrip("/")
SOURCE_DOD = "3dbc40c2-ba63-8158-808a-e81bd769eb6b"
SOURCE_COST = "3dbc40c2-ba63-812c-a185-e8eab139502a"
ACTOR = "opc-kr-current"


def call(url, body=None, method=None):
    request = urllib.request.Request(url, None if body is None else json.dumps(body).encode(),
                                     {"Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def objects():
    out = subprocess.run(["/usr/bin/node", "/opt/openclaw/state/opc-objects.mjs", "list"],
                         capture_output=True, text=True, timeout=90)
    if out.returncode:
        raise RuntimeError("经营对象读取失败（退出码 %s）：%s" % (out.returncode, out.stderr.strip()))
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


def company_items():
    snapshot = call(BRAIN + "/okr/company-key-results")
    if snapshot.get("success") is not True or not isinstance(snapshot.get("items"), list):
        raise RuntimeError("公司 KR 快照读取失败")
    active, seen = {}, set()
    for item in snapshot["items"]:
        try:
            source = item["source_page_id"]
            identity = UUID(source) if isinstance(source, str) and len(source) in (32, 36) else None
        except (ValueError, TypeError, KeyError):
            identity = None
        if not identity or not identity.int or identity in seen or item.get("metric_mode") != "company_formula_v1":
            raise RuntimeError("公司 KR 来源映射不唯一或模式不合法")
        seen.add(identity)
        if not isinstance(item.get("unit"), str) or not item["unit"].strip():
            raise RuntimeError("公司 KR 原单位缺失")
        inactive = {"done", "complete", "completed", "closed", "cancelled", "canceled", "archived", "paused", "on hold", "suspended",
                    "已完成", "完成", "已归档", "归档", "暂停", "已暂停", "取消", "已取消"}
        if item.get("active") is False or item.get("sync_error") or str(item.get("status", "")).strip().lower() in inactive:
            continue
        active[str(identity)] = item
    return active


def set_current(source_page_id, value, evidence, task_id, run_id, observed_at):
    """历史函数名保留；只写独立观察，正式Current保持主理人填写值。"""
    if source_page_id not in (SOURCE_DOD, SOURCE_COST):
        raise RuntimeError("此来源未配置采集算法，不能编造观察")
    item = company_items().get(source_page_id)
    if not item:
        return {"source_page_id": source_page_id, "skipped": True, "reason": "来源缺失或已停止分析"}
    response = call(BRAIN + "/okr/key-results/" + item["id"] + "/observations", {
        "source_page_id": source_page_id, "current_value": value, "unit": item["unit"],
        "actor": ACTOR, "observed_at": observed_at, "evidence": [evidence], "task_id": task_id,
        "idempotency_key": run_id + ":" + source_page_id, "expected_updated_at": item["updated_at"],
    }, "POST")
    if response.get("success") is not True:
        raise RuntimeError("公司 KR 观察未入账")
    return {"source_page_id": source_page_id, "observed_current_value": value,
            "formal_current_value": (response.get("item") or {}).get("current_value", item["current_value"]),
            "unit": item["unit"], "evidence": evidence, "duplicate": response.get("duplicate", False)}


def main():
    run_id = str(uuid4())
    task = call(BRAIN + "/tasks", {
        "title": "公司 KR 机算观察 " + run_id,
        "description": "保留 F1/F3/F4/N1 当前快照和当日晨报成本行口径，写 Brain 观察与证据。",
        "task_type": "workflow_run", "kind": "workflow", "trigger_source": "opc-cron",
        "payload": {"source": ACTOR, "run_id": run_id, "stages": ["snapshot", "observations"]},
    }, "POST")
    task_id = task["id"]
    try:
        call(BRAIN + "/tasks/" + task_id + "/claim", {"claimer": ACTOR, "executor_kind": "external-worker"}, "POST")
        call(BRAIN + "/tasks/" + task_id, {"status": "in_progress"}, "PATCH")
        active = company_items()
        observed_at = datetime.now(timezone.utc).isoformat()
        receipts, evidence, skipped = [], [], []
        for source in (SOURCE_DOD, SOURCE_COST):
            if source not in active:
                skipped.append({"source_page_id": source, "reason": "来源缺失或已停止分析"})
                continue
            if source == SOURCE_DOD:
                passed = dod_count()
                value = len(passed)
                proof = {"fact": "当前快照检查通过：" + ",".join(passed), "source": "opc-kr-current.py:dod_count",
                         "passed_checks": passed, "maximum_checked": 4, "window": "snapshot", "continuous_seven_days_verified": False}
            else:
                value = cost_line_up()
                proof = {"fact": "当日晨报存在非 GREY 成本行" if value else "当日晨报未发现非 GREY 成本行",
                         "source": "opc-kr-current.py:cost_line_up", "business_day": time.strftime("%Y-%m-%d", time.localtime(time.time() + 8 * 3600))}
            receipt = set_current(source, value, proof, task_id, run_id, observed_at)
            if receipt.get("skipped"):
                skipped.append(receipt)
            else:
                receipts.append(receipt)
                evidence.append(proof)
        completed = call(BRAIN + "/tasks/" + task_id, {"status": "completed", "result": {
            "actor": ACTOR, "facts": receipts, "evidence": evidence, "skipped": skipped,
            "handoff": {"schema_version": 1, "task_id": task_id, "title": "公司 KR 原口径机器观察",
                        "verdict": "PASS", "done": ["%s条独立机器观察及证据已入 Brain；正式数字由主理人填写" % len(receipts)],
                        "not_done": [], "next_steps": [], "data_sources": [BRAIN + "/okr/company-key-results"],
                        "created_at": observed_at},
        }}, "PATCH")
        if completed.get("success") is not True or completed.get("status") != "completed":
            raise RuntimeError("采集任务完成回执未通过")
        print(json.dumps({"task_id": task_id, "observations": len(receipts)}, ensure_ascii=False))
    except Exception:
        call(BRAIN + "/tasks/" + task_id, {"status": "failed", "result": {
            "actor": ACTOR, "facts": "观察未完整入账，未声称完成", "evidence": {"run_id": run_id},
        }}, "PATCH")
        raise


if __name__ == "__main__":
    main()
