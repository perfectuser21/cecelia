from datetime import datetime, timezone

_started_at = None


def get_started_at():
    global _started_at
    if _started_at is None:
        _started_at = datetime.now(timezone.utc)
    return _started_at
