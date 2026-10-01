"""运行采集器和现场渲染器，验证指标的 Brain 单一写口。"""
import importlib.util
import json
import re
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import StringIO
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DOD = "3dbc40c2-ba63-8158-808a-e81bd769eb6b"
SOURCE_COST = "3dbc40c2-ba63-812c-a185-e8eab139502a"
COMPANY_SOURCES = (
    "3dbc40c2-ba63-811d-89cc-c17863d7ba80", "3dbc40c2-ba63-81d0-a417-c8e2919f77f1",
    "3dbc40c2-ba63-8116-bace-debc4c74d6e5", "3dbc40c2-ba63-81fd-a7da-d7c8e57fbc5f",
    "3dbc40c2-ba63-81b4-b5ab-e27542cba851", SOURCE_DOD,
    "3dbc40c2-ba63-811c-bbb7-f4e0e040098e", SOURCE_COST,
)


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts/ops" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def item(source, name, value="0", ratio=0):
    return {"id": "brain-" + source, "source_page_id": source,
            "title": name, "objective": {"id": "objective-3", "title": "O3 公司自转（活体达成）"},
            "source_area_ids": [], "unit": "条", "metric_mode": "company_formula_v1",
            "start_value": "0", "current_value": value, "target_value": "8",
            "progress_ratio": ratio, "progress_pct": None if ratio is None else ratio * 100,
            "status": "Open", "updated_at": "2026-10-01T06:00:00.000Z"}


def company_rows():
    return [item(source, "公司指标" + str(index)) for index, source in enumerate(COMPANY_SOURCES)]


class Pipeline(unittest.TestCase):
    def collector(self, fail=False, completion_state="completed", brain_api=None):
        module = load("opc-kr-current")
        calls = []
        rows = [item(SOURCE_DOD, "重命名后的经营指标"), item(SOURCE_COST, "不同标题")]

        def call(url, body=None, method=None):
            method = method or ("POST" if body is not None else "GET")
            calls.append((url, method, body))
            if "api.notion.com" in url:
                return {"results": [{"id": SOURCE_DOD, "properties": {"Name": {"title": [{"plain_text": "KR3.1 原名"}]}}},
                                    {"id": SOURCE_COST, "properties": {"Name": {"title": [{"plain_text": "KR3.3 原名"}]}}}]}
            if url.endswith("/company-key-results"):
                return {"success": True, "items": rows}
            if url.endswith("/tasks"):
                return {"id": "run-task-id", "status": "queued"}
            if url.endswith("/observations"):
                if fail:
                    raise RuntimeError("observation rejected")
                return {"success": True, "item": rows[0], "duplicate": False}
            if method == "PATCH" and body.get("status") == "completed":
                return {"success": True, "status": completion_state}
            return {"success": True, "status": body.get("status") if body else None}

        with patch.object(module, "BRAIN", brain_api or module.BRAIN), \
                patch.object(module, "call", side_effect=call), \
                patch.object(module, "dod_count", return_value=["F1", "N1"]), \
                patch.object(module, "cost_line_up", return_value=1):
            if fail or completion_state != "completed":
                with self.assertRaises(RuntimeError):
                    module.main()
            else:
                module.main()
        return calls

    def test_brain_path_containing_notion_domain_uses_brain_responses(self):
        calls = self.collector(brain_api="http://127.0.0.1/api.notion.com/api/brain")
        self.assertEqual(len([url for url, _, _ in calls if url.endswith("/observations")]), 2)
        self.assertTrue(any(method == "PATCH" and body.get("status") == "completed" for _, method, body in calls))

    def test_collector_writes_brain_and_explicit_source_ids(self):
        calls = self.collector()
        self.assertTrue(all("api.notion.com" not in url for url, _, _ in calls), calls)
        observations = [(url, body) for url, _, body in calls if url.endswith("/observations")]
        self.assertEqual(len(observations), 2)
        self.assertEqual({body["source_page_id"] for _, body in observations}, {SOURCE_DOD, SOURCE_COST})
        self.assertEqual([body["current_value"] for _, body in observations], [2, 1])
        for url, body in observations:
            self.assertIn("/brain-" + body["source_page_id"] + "/observations", url)
            self.assertEqual(body["task_id"], "run-task-id")
            self.assertEqual(body["actor"], "opc-kr-current")
            self.assertEqual(body["expected_updated_at"], "2026-10-01T06:00:00.000Z")
            self.assertTrue(body["evidence"][0]["fact"])
            self.assertTrue(body["evidence"][0]["source"])

    def test_collector_registers_before_observations_and_records_receipt(self):
        calls = self.collector()
        registration = next(i for i, (url, method, _) in enumerate(calls) if url.endswith("/tasks") and method == "POST")
        observations = [i for i, (url, _, _) in enumerate(calls) if url.endswith("/observations")]
        self.assertLess(registration, min(observations))
        complete = [body for _, method, body in calls if method == "PATCH" and body.get("status") == "completed"]
        self.assertEqual(len(complete), 1)
        self.assertEqual(complete[0]["result"]["actor"], "opc-kr-current")
        self.assertTrue(complete[0]["result"]["evidence"])
        self.assertEqual(complete[0]["result"]["handoff"]["next_steps"], [])
        self.assertEqual(complete[0]["result"]["handoff"].get("schema_version"), 1)
        self.assertEqual(complete[0]["result"]["handoff"].get("task_id"), "run-task-id")
        self.assertTrue(complete[0]["result"]["handoff"].get("done"))

    def test_rejected_observation_does_not_claim_completion(self):
        calls = self.collector(fail=True)
        self.assertFalse(any(method == "PATCH" and body.get("status") == "completed" for _, method, body in calls))
        self.assertTrue(any(method == "PATCH" and body.get("status") == "failed" for _, method, body in calls))

    def test_refused_completion_is_recorded_as_failure(self):
        calls = self.collector(completion_state="in_progress")
        self.assertTrue(any(method == "PATCH" and body.get("status") == "failed" for _, method, body in calls))

    def test_renderer_uses_raw_values_and_original_ratio(self):
        module = load("opc-okr-sync")
        row = {"kr": "原指标", "o": "O3", "areas": [], "start": "2", "cur": "1.234",
               "target": "1", "ratio": 0.766, "st": "Open"}
        text = module.fmt([row], "公司")
        self.assertIn("Brain", text)
        self.assertIn("1.234", text)
        self.assertIn("76.6%", text)
        row["ratio"] = None
        self.assertIn("unknown", module.fmt([row], "公司"))
        row["ratio"] = 1.25
        self.assertIn("125%", module.fmt([row], "公司"))

    def test_fetch_reads_brain_source_identity(self):
        module = load("opc-okr-sync")
        rows = company_rows()
        rows[5] = item(SOURCE_DOD, "名称无需KR编号", "1.234", 0.125)
        calls = []

        def call(url, body=None, method=None):
            calls.append(url)
            if "api.notion.com" in url:
                return {"results": []}
            return {"success": True, "items": rows}

        with patch.object(module, "BRAIN", "http://127.0.0.1/api.notion.com/api/brain"), \
                patch.object(module, "call", side_effect=call):
            result = module.fetch()
        self.assertEqual(len(result), 8)
        renamed = next(row for row in result if row["kr"] == "名称无需KR编号")
        self.assertEqual(renamed["cur"], "1.234")
        self.assertEqual(renamed["ratio"], 0.125)
        self.assertEqual(renamed["areas"], [])
        self.assertTrue(all("api.notion.com" not in url for url in calls))

    def test_empty_brain_snapshot_preserves_existing_site_files(self):
        module = load("opc-okr-sync")
        calls = []

        def call(url, body=None, method=None):
            calls.append((url, method, body))
            return {"id": "empty-sync-task", "success": True}

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "clawd/OKR-CURRENT.md"
            target.parent.mkdir()
            target.write_text("上一份有效快照")
            with patch.object(module, "ROOT", directory), patch.object(module, "fetch", return_value=[]), \
                    patch.object(module, "call", side_effect=call):
                with self.assertRaises(SystemExit):
                    module.main()
            self.assertEqual(target.read_text(), "上一份有效快照")
            self.assertTrue(calls, "空快照失败也必须登记")
            self.assertTrue(calls[0][0].endswith("/tasks"))
            self.assertTrue(any(method == "PATCH" and body.get("status") == "failed" for _, method, body in calls))

    def test_unresolved_area_ids_refuse_to_misreport_departments(self):
        module = load("opc-okr-sync")
        rows = company_rows()
        rows[5]["source_area_ids"] = ["300c40c2-real-source-area"]
        with patch.object(module, "call", return_value={"success": True, "items": rows}):
            with self.assertRaises(RuntimeError):
                module.fetch()

    def assert_invalid_snapshot_preserves_six_files(self, rows):
        module = load("opc-okr-sync")
        calls = []

        def call(url, body=None, method=None):
            calls.append((url, method, body))
            if url.endswith("/company-key-results"):
                return {"success": True, "items": rows}
            if url.endswith("/tasks"):
                return {"id": "invalid-sync-task"}
            return {"success": True, "status": body.get("status") if body else None}

        with tempfile.TemporaryDirectory() as directory:
            targets = [Path(directory) / "clawd/OKR-CURRENT.md"] + [
                Path(directory) / ("clawd-" + agent) / "OKR.md"
                for agent in ["media", "fde", "dev", "people", "infra"]]
            for target in targets:
                target.parent.mkdir()
                target.write_text("上一份有效快照：" + target.parent.name)
            before = {target: target.read_bytes() for target in targets}
            with patch.object(module, "ROOT", directory), patch.object(module, "call", side_effect=call), \
                    patch.object(module, "write_site", wraps=module.write_site) as write:
                with self.assertRaises(RuntimeError):
                    module.main()
                write.assert_not_called()
            self.assertEqual({target: target.read_bytes() for target in targets}, before)
            self.assertTrue(calls[0][0].endswith("/tasks"))
            self.assertTrue(any(method == "PATCH" and body.get("status") == "failed" for _, method, body in calls))
            self.assertFalse(any(method == "PATCH" and body.get("status") == "completed" for _, method, body in calls))

    def test_missing_company_source_fails_before_any_site_write(self):
        self.assert_invalid_snapshot_preserves_six_files(company_rows()[:-1])

    def test_unknown_replacement_source_fails_before_any_site_write(self):
        rows = company_rows()
        rows[-1] = item("unknown-but-unique-page", "同名公司指标")
        self.assert_invalid_snapshot_preserves_six_files(rows)

    def test_standalone_source_catalog_matches_brain_catalog(self):
        module = load("opc-okr-sync")
        brain = (ROOT / "packages/brain/src/lib/company-kr-metrics.js").read_text()
        catalog = brain.split("export const COMPANY_KR_CATALOG = [", 1)[1].split("].map(", 1)[0]
        expected = set(re.findall(r"\['([a-f0-9-]{36})',", catalog))
        self.assertEqual(len(expected), 8)
        self.assertEqual(module.SOURCE_PAGE_IDS, expected)

    def test_historical_values_are_labelled_unverified(self):
        module = load("opc-okr-sync")
        row = {"kr": "公司 KR", "o": "O1", "areas": [], "start": "0", "cur": "0",
               "target": "5", "ratio": 0, "st": "Open", "validation_state": "unverified"}
        text = module.fmt([row], "公司")
        self.assertIn("历史值·未验证", text)
        self.assertIn("四项快照", text)
        row["validation_state"] = "verified_observation"
        self.assertIn("有观察证据", module.fmt([row], "公司"))

    def test_real_http_observation_preserves_raw_payload_and_source(self):
        module = load("opc-kr-current")
        received = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "items": [item(SOURCE_DOD, "变更名称")]}).encode())

            def do_POST(self):
                received.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"success":true,"duplicate":false}')

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(module, "BRAIN", "http://127.0.0.1:%s/api/brain" % server.server_port):
                module.set_current(SOURCE_DOD, "1.234", {"fact": "真实测试观察", "source": "case"},
                                   "registered-task", "run", "2026-10-01T07:00:00Z")
            self.assertEqual(received[0][0], "/api/brain/okr/key-results/brain-" + SOURCE_DOD + "/observations")
            self.assertEqual(received[0][1]["current_value"], "1.234")
            self.assertEqual(received[0][1]["task_id"], "registered-task")
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

    def test_duplicate_source_mapping_stops_before_write(self):
        module = load("opc-kr-current")
        with patch.object(module, "call", return_value={"success": True, "items": [item(SOURCE_DOD, "a"), item(SOURCE_DOD, "b")]}) as call:
            with self.assertRaises(RuntimeError):
                module.set_current(SOURCE_DOD, 2, {"fact": "snapshot", "source": "case"}, "task", "run", "time")
            self.assertEqual(call.call_count, 1)

    def test_original_dod_snapshot_four_checks_and_boundaries(self):
        module = load("opc-kr-current")
        records = [{"状态": "进行中", "标题": "维修1", "下次检查时间": 10_000_000},
                   {"状态": "已完成", "标题": "维修2", "下次检查时间": None}]

        class Database:
            def execute(self, *_):
                return self

            def fetchone(self):
                return (json.dumps({"lastRunStatus": "ok"}),)

        class Process:
            stdout = "Use%\n84%\n"

        with patch.object(module, "objects", return_value=(records, 10_000_000)), \
                patch.object(module.sqlite3, "connect", return_value=Database()), \
                patch.object(module.subprocess, "run", return_value=Process()):
            self.assertEqual(module.dod_count(), ["F1", "F3", "F4", "N1"])
            records[0]["下次检查时间"] = 10_000_000 - 3_600_000
            Process.stdout = "Use%\n85%\n"
            self.assertEqual(module.dod_count(), ["F1", "F4"])

    def test_original_cost_line_requires_non_grey_cost(self):
        module = load("opc-kr-current")
        with patch.object(module.os.path, "exists", return_value=True):
            with patch("builtins.open", return_value=StringIO("成本 GREY\n其他 GREEN\n")):
                self.assertEqual(module.cost_line_up(), 0)
            with patch("builtins.open", return_value=StringIO("成本 GREEN\n")):
                self.assertEqual(module.cost_line_up(), 1)

    def test_renderer_writes_six_actual_site_files_after_registration(self):
        module = load("opc-okr-sync")
        calls = []
        rows = company_rows()
        rows[5] = item(SOURCE_DOD, "KR3.1", "2", 0.25)

        def call(url, body=None, method=None):
            calls.append((url, method, body))
            if url.endswith("/tasks"):
                return {"id": "sync-task"}
            if url.endswith("/company-key-results"):
                return {"success": True, "items": rows}
            return {"success": True, "status": body.get("status") if body else None}

        with tempfile.TemporaryDirectory() as directory:
            for name in ["clawd", "clawd-media", "clawd-fde", "clawd-dev", "clawd-people", "clawd-infra"]:
                (Path(directory) / name).mkdir()
            with patch.object(module, "ROOT", directory), patch.object(module, "call", side_effect=call):
                module.main()
            director = (Path(directory) / "clawd/OKR-CURRENT.md").read_text()
            self.assertIn("25%", director)
            self.assertIn("Brain", director)
            for name in ["media", "fde", "dev", "people", "infra"]:
                self.assertIn("暂无直接挂钩", (Path(directory) / ("clawd-" + name) / "OKR.md").read_text())
            complete = [body for _, method, body in calls if method == "PATCH" and body.get("status") == "completed"]
            self.assertEqual(len(complete[0]["result"]["facts"]["site_files"]), 6)
            self.assertEqual(complete[0]["result"]["facts"]["company_krs"], 8)
            self.assertEqual(complete[0]["result"]["handoff"].get("schema_version"), 1)
            self.assertEqual(complete[0]["result"]["handoff"].get("task_id"), "sync-task")
            self.assertTrue(complete[0]["result"]["handoff"].get("done"))
            self.assertFalse(list(Path(directory).rglob("*.tmp")))


if __name__ == "__main__":
    unittest.main()
