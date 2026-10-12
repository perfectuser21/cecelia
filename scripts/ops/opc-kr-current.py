#!/usr/bin/env python3
"""公司 KR 原口径机算：当前快照不代表连续七天，先登记再写 Brain。"""
import json
import os
import shutil
import subprocess
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from uuid import UUID, uuid4

BRAIN = os.environ.get("CECELIA_BRAIN_API", "http://localhost:5221/api/brain").rstrip("/")
SOURCE_DOD = "3dbc40c2-ba63-8158-808a-e81bd769eb6b"
SOURCE_COST = "3dbc40c2-ba63-812c-a185-e8eab139502a"
ACTOR = "opc-kr-current"
ROOT = os.environ.get("OPC_WORKSPACES_ROOT", str(Path.home() / "openclaw-root/workspaces-root"))
NODE = os.environ.get("OPC_NODE", "/opt/homebrew/bin/node")
OPENCLAW = os.environ.get("OPC_OPENCLAW", "/opt/homebrew/bin/openclaw")
OBJECTS_HELPER = os.environ.get("OPC_OBJECTS_HELPER", str(Path.home() / ".openclaw/opc-objects.mjs"))
REPORT_CRON_IDS = ["eaedbefe-0c7c-49b0-afbc-3bb86d0f1d47", "dd2d4288-a5f5-40d7-bc62-92fbea85fa5a",
                   "6089b68c-65bb-458d-80c5-4742b45709b3"]


def business_now():
    return datetime.now(ZoneInfo("Asia/Shanghai"))


def cron_states():
    out = subprocess.run([OPENCLAW, "cron", "list", "--all", "--json"],
                         capture_output=True, text=True, timeout=90)
    if out.returncode:
        raise RuntimeError("MMV 定时状态读取失败（退出码 %s）" % out.returncode)
    data = json.loads(out.stdout)
    if not isinstance(data.get("jobs"), list) or data.get("hasMore") is not False:
        raise RuntimeError("MMV 定时快照不完整")
    states = {j["id"]: j.get("state", {}) for j in data["jobs"]}
    if not all(i in states for i in REPORT_CRON_IDS):
        raise RuntimeError("MMV 三报定时来源缺失")
    return {i: states[i] for i in REPORT_CRON_IDS}


def call(url, body=None, method=None):
    request = urllib.request.Request(url, None if body is None else json.dumps(body).encode(),
                                     {"Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def objects():
    out = subprocess.run([NODE, OBJECTS_HELPER, "list"],
                         capture_output=True, text=True, timeout=90)
    if out.returncode:
        raise RuntimeError("经营对象读取失败（退出码 %s）：%s" % (out.returncode, out.stderr.strip()))
    d = json.loads(out.stdout)
    assert d.get("ok"), d.get("error")
    return d["records"], d["now_ms"]

def dod_count():
    recs, now = objects()
    passed = []
    # 原口径仍为三报最近一次状态；读取现行 MMV cron，而非旧机 SQLite。
    if all(state.get("lastRunStatus") == "ok" for state in cron_states().values()):
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
    disk = shutil.disk_usage(ROOT)
    use = 100 * disk.used / disk.total
    if use < 85:
        passed.append("N1")
    return passed

def cost_line_up():
    day = business_now().strftime("%Y-%m-%d")
    p = str(Path(ROOT) / "clawd/reports/morning" / day / "company.md")
    if not os.path.exists(p):
        return 0
    for ln in open(p, encoding="utf-8"):
        if "成本" in ln and "GREY" not in ln:
            return 1
    return 0


def company_items():
    snapshot = call(BRAIN + "/okr/company-key-results")
    if snapshot.get("success") is not True or not isinstance(snapshot.get("items"), list) or not snapshot["items"]:
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
        "task_type": "data", "kind": "workflow", "trigger_source": "opc-cron",
        "payload": {"headed_manual": True, "source": ACTOR, "run_id": run_id, "stages": ["snapshot", "observations"]},
    }, "POST")
    task_id = task["id"]
    receipts, evidence, skipped = [], [], []
    try:
        claimed = call(BRAIN + "/tasks/" + task_id + "/claim", {"claimer": ACTOR, "executor_kind": "external-worker"}, "POST")
        if claimed.get("success") is False or claimed.get("accepted") is False or not (claimed.get("id") == task_id or claimed.get("success") is True):
            raise RuntimeError("批处理任务认领未通过")
        started = call(BRAIN + "/tasks/" + task_id, {"status": "in_progress"}, "PATCH")
        if started.get("success") is not True or started.get("status") != "in_progress":
            raise RuntimeError("批处理任务启动未通过")
        active = company_items()
        observed_at = datetime.now(timezone.utc).isoformat()
        for source in (SOURCE_DOD, SOURCE_COST):
            if source not in active:
                skipped.append({"source_page_id": source, "reason": "来源缺失或已停止分析"})
                continue
            if source == SOURCE_DOD:
                passed = dod_count()
                value = len(passed)
                proof = {"fact": "当前快照检查通过：" + ",".join(passed), "source": "opc-kr-current.py:dod_count",
                         "passed_checks": passed, "host": "mmv", "report_cron_ids": REPORT_CRON_IDS, "workspace": ROOT, "maximum_checked": 4, "window": "snapshot", "continuous_seven_days_verified": False}
            else:
                value = cost_line_up()
                proof = {"fact": "当日晨报存在非 GREY 成本行" if value else "当日晨报未发现非 GREY 成本行",
                         "source": "opc-kr-current.py:cost_line_up", "business_day": business_now().strftime("%Y-%m-%d")}
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
        print(json.dumps({"task_id": task_id, "child_task_id": task_id, "run_uuid": run_id, "observations": len(receipts), "receipts": receipts}, ensure_ascii=False))
    except Exception:
        call(BRAIN + "/tasks/" + task_id, {"status": "failed", "result": {
            "actor": ACTOR, "facts": receipts, "partial": True, "evidence": {"run_id": run_id},
        }}, "PATCH")
        raise


if __name__ == "__main__":
    main()
