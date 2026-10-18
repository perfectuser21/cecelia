#!/usr/bin/env python3
"""Reject tracked skill definitions in a consuming business repository."""
import subprocess
import sys
import argparse


def violations(root="."):
    paths = subprocess.check_output(["git", "-C", str(root), "ls-files", "-z"]).split(b"\0")
    return [p.decode("utf-8", "surrogateescape") for p in paths if p and p.rsplit(b"/", 1)[-1].lower() == b"skill.md"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--allow-unchanged-from')
    args = parser.parse_args()
    found = violations()
    if args.allow_unchanged_from:
        # Transitional tooling PR: existing definitions must remain byte-identical
        # to the fixed pre-migration commit. New/edited definitions still fail.
        baseline = args.allow_unchanged_from
        if baseline != 'ee143abb5d0994721d7c3963fc93e91b94a0b013':
            sys.exit('Unrecognized ownership baseline')
        def blob(ref, path):
            result = subprocess.run(['git', '--no-replace-objects', 'rev-parse', '--verify', ref + ':' + path], capture_output=True)
            return result.stdout.strip() if result.returncode == 0 else None
        found = [path for path in found if blob(baseline, path) is None or blob(baseline, path) != blob('', path)]
    if found:
        print("Skill definitions belong in perfectuser21/zenithjoy-skills; keep pinned references here.", file=sys.stderr)
        for path in found:
            print(repr(path), file=sys.stderr)
        sys.exit(1)
    print("Skill source ownership passed")
