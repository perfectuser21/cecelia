#!/usr/bin/env python3
"""公司 OKR 下行同步：Brain 原指标快照 → 六个既有执行现场。"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

BRAIN = os.environ.get("CECELIA_BRAIN_API", "http://localhost:5221/api/brain").rstrip("/")
ROOT = "/opt/openclaw/workspaces-root"
ACTOR = "opc-okr-sync"
AREA2AGENT = {"智能获客": ["media"], "新媒体": ["media"], "AI交付FDE": ["fde"],
              "研发部": ["dev"], "人事运营": ["people"], "基础设施": ["infra"],
              "ZenithJoy": ["clawd"]}


def call(url, body=None, method=None):
    request = urllib.request.Request(url, None if body is None else json.dumps(body).encode(),
                                     {"Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def fetch():
    snapshot = call(BRAIN + "/okr/company-key-results")
    if snapshot.get("success") is not True:
        raise RuntimeError("Brain 公司 KR 快照读取失败")
    rows, seen = [], set()
    for item in snapshot["items"]:
        source = item["source_page_id"]
        if not source or source in seen or item.get("metric_mode") != "company_formula_v1":
            raise RuntimeError("公司 KR 来源映射不合法，拒绝重写现场")
        seen.add(source)
        area_ids = item.get("source_area_ids", [])
        area_names = item.get("source_area_names", [])
        if len(area_ids) != len(area_names) or any(not isinstance(name, str) or not name for name in area_names):
            raise RuntimeError("公司 Area 来源尚未解析，保留既有部门现场")
        rows.append({"kr": item["title"], "o": (item.get("objective") or {}).get("title", ""),
                     "areas": area_names, "validation_state": item.get("validation_state"),
                     "start": item["start_value"], "cur": item["current_value"],
                     "target": item["target_value"], "ratio": item["progress_ratio"], "st": item["status"]})
    return sorted(rows, key=lambda row: row["kr"])


def fmt(rows, title):
    now = time.strftime("%Y-%m-%d %H:%M", time.localtime(time.time() + 8 * 3600))
    lines = ["# %s" % title, "",
             "> 快照 %s ｜ 真身在 Brain；公司 KR 保留原 Start/Current/Target 与公式口径。本文件自动重写勿手改。" % now, "",
             "> KR3.1 当前机算范围为四项快照，尚无连续7天证据。", "",
             "| KR | 目标 | 当前 | 进度 | 部门 | 证据态 |", "|---|---|---|---|---|---|"]
    for row in rows:
        ratio = row["ratio"]
        progress = "unknown" if ratio is None else format(ratio * 100, ".12g") + "%"
        state = {"unverified": "历史值·未验证", "historical_unverified": "历史值·未验证",
                 "historical_snapshot": "历史快照·未验证", "verified_observation": "有观察证据",
                 "observed": "有观察证据", "verified": "已验证"}.get(row.get("validation_state"), "unknown")
        lines.append("| %s | %s | %s | %s | %s | %s |" % (
            row["kr"], "unknown" if row["target"] is None else row["target"],
            "unknown" if row["cur"] is None else row["cur"], progress, "、".join(row["areas"]) or "-", state))
    lines += ["", "## 会议要求（对每条 KR）",
              "1. 进度：Current 现在是多少、和 Target 差多少（必须带证据引用，无证据写 unknown）",
              "2. 今日计划：为缩小差距今天做什么",
              "3. 阻塞与资源申请：卡在哪、要 Director 或老板给什么", ""]
    return "\n".join(lines)


def write_site(path, body):
    destination = Path(path)
    draft = destination.with_name(destination.name + "." + str(uuid4()) + ".tmp")
    try:
        draft.write_text(body, encoding="utf-8")
        os.replace(draft, destination)
    finally:
        draft.unlink(missing_ok=True)


def main():
    run_id = str(uuid4())
    task = call(BRAIN + "/tasks", {
        "title": "公司 OKR 执行现场同步 " + run_id,
        "description": "从 Brain 原指标快照更新 Director 与五部门执行现场。",
        "task_type": "workflow_run", "kind": "workflow", "trigger_source": "opc-cron",
        "payload": {"source": ACTOR, "run_id": run_id, "stages": ["snapshot", "site-projection"]},
    }, "POST")
    task_id = task["id"]
    written = []
    try:
        call(BRAIN + "/tasks/" + task_id + "/claim", {"claimer": ACTOR, "executor_kind": "external-worker"}, "POST")
        call(BRAIN + "/tasks/" + task_id, {"status": "in_progress"}, "PATCH")
        rows = fetch()
        if not rows:
            sys.exit("Brain 没有公司 KR，拒绝清空既有现场文件")
        director = ROOT + "/clawd/OKR-CURRENT.md"
        write_site(director, fmt(rows, "ZenithJoy 公司 OKR（全量·Director 视图）"))
        written.append(director)
        for agent in ["media", "fde", "dev", "people", "infra"]:
            workspace = "%s/clawd-%s" % (ROOT, agent)
            if not os.path.isdir(workspace):
                continue
            own = [row for row in rows if any(agent in AREA2AGENT.get(area, []) for area in row["areas"])]
            body = fmt(own, "本部门 KR（%s）" % agent) if own else (
                "# 本部门 KR（%s）\n\n> 暂无直接挂钩的公司 KR。会议上报告支撑性进展："
                "支撑哪条 KR、做了什么、阻塞是什么。\n" % agent)
            destination = workspace + "/OKR.md"
            write_site(destination, body)
            written.append(destination)
        completed = call(BRAIN + "/tasks/" + task_id, {"status": "completed", "result": {
            "actor": ACTOR, "facts": {"company_krs": len(rows), "site_files": written},
            "evidence": {"source": BRAIN + "/okr/company-key-results", "run_id": run_id},
            "handoff": {"schema_version": 1, "task_id": task_id, "title": "公司 OKR 执行现场同步",
                        "verdict": "PASS", "done": ["Brain 公司原指标快照已同步执行现场"],
                        "not_done": [], "next_steps": [], "data_sources": [BRAIN + "/okr/company-key-results"],
                        "created_at": datetime.now(timezone.utc).isoformat()},
        }}, "PATCH")
        if completed.get("success") is not True or completed.get("status") != "completed":
            raise RuntimeError("现场同步任务完成回执未通过")
        print(json.dumps({"task_id": task_id, "company_krs": len(rows), "site_files": len(written)}, ensure_ascii=False))
    except (Exception, SystemExit):
        call(BRAIN + "/tasks/" + task_id, {"status": "failed", "result": {
            "actor": ACTOR, "facts": {"site_files_written": written}, "evidence": {"run_id": run_id},
        }}, "PATCH")
        raise


if __name__ == "__main__":
    main()
