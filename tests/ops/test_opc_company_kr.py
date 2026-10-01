"""运行采集器和现场渲染器，验证指标的 Brain 单一写口。"""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DOD = "3dbc40c2-ba63-8158-808a-e81bd769eb6b"
SOURCE_COST = "3dbc40c2-ba63-812c-a185-e8eab139502a"


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


class Pipeline(unittest.TestCase):
    def collector(self, fail=False):
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
            return {"success": True, "status": body.get("status") if body else None}

        with patch.object(module, "call", side_effect=call), \
                patch.object(module, "dod_count", return_value=["F1", "N1"]), \
                patch.object(module, "cost_line_up", return_value=1):
            if fail:
                with self.assertRaises(RuntimeError):
                    module.main()
            else:
                module.main()
        return calls

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

    def test_rejected_observation_does_not_claim_completion(self):
        calls = self.collector(fail=True)
        self.assertFalse(any(method == "PATCH" and body.get("status") == "completed" for _, method, body in calls))
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
        rows = [item(SOURCE_DOD, "名称无需KR编号", "1.234", 0.125)]
        calls = []

        def call(url, body=None, method=None):
            calls.append(url)
            if "api.notion.com" in url:
                return {"results": []}
            return {"success": True, "items": rows}

        with patch.object(module, "call", side_effect=call):
            result = module.fetch()
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["cur"], "1.234")
        self.assertEqual(result[0]["ratio"], 0.125)
        self.assertEqual(result[0]["areas"], [])
        self.assertTrue(all("api.notion.com" not in url for url in calls))

    def test_empty_brain_snapshot_preserves_existing_site_files(self):
        module = load("opc-okr-sync")
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "clawd/OKR-CURRENT.md"
            target.parent.mkdir()
            target.write_text("上一份有效快照")
            with patch.object(module, "ROOT", directory), patch.object(module, "fetch", return_value=[]):
                with self.assertRaises(SystemExit):
                    module.main()
            self.assertEqual(target.read_text(), "上一份有效快照")


if __name__ == "__main__":
    unittest.main()
