from datetime import datetime, timezone

import pytest
from flask import Flask

from api.routes import register_routes


@pytest.fixture()
def client():
    app = Flask(__name__)
    register_routes(app)
    return app.test_client()


def test_ping_route_registered():
    app = Flask(__name__)
    register_routes(app)
    rules = [str(r) for r in app.url_map.iter_rules()]
    assert "/api/brain/ping" in rules


def test_ping_returns_200_json_pong_true(client):
    r = client.get("/api/brain/ping")
    assert r.status_code == 200
    assert "application/json" in r.headers.get("Content-Type", "")
    body = r.get_json()
    assert body["pong"] is True
    assert isinstance(body["timestamp"], str)


def test_ping_timestamp_iso8601_fresh(client):
    r = client.get("/api/brain/ping")
    ts = r.get_json()["timestamp"]
    parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    delta = abs((datetime.now(timezone.utc) - parsed).total_seconds())
    assert delta < 5


def test_ping_timestamp_changes_between_calls(client):
    import time

    t1 = client.get("/api/brain/ping").get_json()["timestamp"]
    time.sleep(0.011)
    t2 = client.get("/api/brain/ping").get_json()["timestamp"]
    assert t1 != t2


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_ping_rejects_non_get_methods(client, method):
    r = client.open("/api/brain/ping", method=method)
    assert r.status_code == 405


def test_ping_path_is_case_sensitive(client):
    r = client.get("/api/brain/Ping")
    assert r.status_code != 200
