#!/usr/bin/env python3

"""Bounded, fail-closed extraction for trusted GitHub evidence artifacts."""

import hashlib
import json
import pathlib
import shutil
import stat
import sys
import uuid
import zipfile


MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_ENTRIES = 512
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200
CHUNK_BYTES = 1024 * 1024


def reject() -> None:
    raise RuntimeError("github_evidence_archive_rejected")


def safe_member_parts(name: str) -> tuple[str, ...]:
    if not name or "\x00" in name or "\\" in name or name.startswith("/"):
        reject()
    value = pathlib.PurePosixPath(name)
    if value.is_absolute() or any(part in ("", ".", "..") for part in value.parts):
        reject()
    return value.parts


def extract(archive: pathlib.Path, capsule: pathlib.Path, purpose: str,
            artifact_name: str) -> list[dict]:
    archive = archive.resolve(strict=True)
    capsule = capsule.resolve(strict=True)
    if capsule not in archive.parents or archive.stat().st_size > MAX_ARCHIVE_BYTES:
        reject()

    destination = capsule / "extracted" / purpose / artifact_name
    staging = destination.parent / f".{artifact_name}.extracting-{uuid.uuid4().hex}"
    if destination.exists():
        reject()
    staging.mkdir(parents=True, mode=0o700)
    extracted: list[dict] = []
    total = 0
    seen: set[pathlib.Path] = set()
    try:
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            if len(members) > MAX_ENTRIES:
                reject()
            for member in members:
                parts = safe_member_parts(member.filename)
                member_type = (member.external_attr >> 16) & 0o170000
                if member.flag_bits & 0x1 or member_type == stat.S_IFLNK:
                    reject()
                if member.is_dir():
                    continue
                if member.file_size > MAX_FILE_BYTES:
                    reject()
                total += member.file_size
                if total > MAX_TOTAL_BYTES:
                    reject()
                if member.file_size > 0 and (
                    member.compress_size == 0
                    or member.file_size / member.compress_size > MAX_COMPRESSION_RATIO
                ):
                    reject()

                target = staging.joinpath(*parts)
                if target in seen:
                    reject()
                seen.add(target)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                digest = hashlib.sha256()
                written = 0
                with bundle.open(member) as source, target.open("xb") as output:
                    while True:
                        chunk = source.read(CHUNK_BYTES)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > member.file_size or written > MAX_FILE_BYTES:
                            reject()
                        digest.update(chunk)
                        output.write(chunk)
                if written != member.file_size:
                    reject()
                target.chmod(0o400)
                relative = pathlib.PurePosixPath(
                    "extracted", purpose, artifact_name, *parts
                )
                extracted.append({
                    "path": str(relative),
                    "size": written,
                    "sha256": digest.hexdigest(),
                })
        if not extracted:
            reject()
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        staging.rename(destination)
        return extracted
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    if len(sys.argv) != 5:
        reject()
    result = extract(
        pathlib.Path(sys.argv[1]),
        pathlib.Path(sys.argv[2]),
        sys.argv[3],
        sys.argv[4],
    )
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("github_evidence_archive_rejected", file=sys.stderr)
        raise SystemExit(1)
