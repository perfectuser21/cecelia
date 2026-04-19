from datetime import datetime, timezone

from flask import Blueprint, jsonify


bp = Blueprint("brain_ping", __name__)


@bp.route("/api/brain/ping", methods=["GET"])
def ping():
    return jsonify(
        {
            "pong": True,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
    )
