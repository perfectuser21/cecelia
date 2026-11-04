#!/usr/bin/env python3
"""Only disclose whether the CI identity parses and matches the registered key."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def check_identity():
    parsed = False
    matches = False
    try:
        key = os.environ.get("SKILLS_SOURCE_SSH_KEY", "")
        expected = os.environ.get("SKILLS_SOURCE_PUBLIC_KEY_SHA256", "")
        if key:
            with tempfile.TemporaryDirectory(prefix="skill-identity-") as private:
                os.chmod(private, 0o700)
                identity = Path(private) / "key"
                descriptor = os.open(identity, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, "wb") as output:
                    output.write((key.replace("\r\n", "\n").rstrip() + "\n").encode("utf-8"))
                # The secret is not forwarded to the subprocess or exposed in argv.
                env = os.environ.copy()
                env.pop("SKILLS_SOURCE_SSH_KEY", None)
                result = subprocess.run(
                    ["ssh-keygen", "-y", "-P", "", "-f", str(identity)],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, env=env, timeout=10, check=False,
                )
                fields = result.stdout.decode("utf-8").split()
                parsed = result.returncode == 0 and len(fields) >= 2
                if parsed and re.fullmatch(r"[0-9a-f]{64}", expected):
                    digest = hashlib.sha256(" ".join(fields[:2]).encode("utf-8")).hexdigest()
                    matches = hmac.compare_digest(digest, expected)
    except Exception:
        # Neither subprocess stderr nor exception text may disclose key material.
        parsed = False
        matches = False
    print(json.dumps({"parse_ok": parsed, "matches_registered": matches}))
    return 0 if parsed and matches else 1


if __name__ == "__main__":
    raise SystemExit(check_identity())
