#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
owned_root="$(mktemp -d)"
trap 'rm -rf "$owned_root"' EXIT
printf '#!/usr/bin/env bash\nexit 0\n' > "$owned_root/launchctl"
chmod +x "$owned_root/launchctl"
marker="$owned_root/fleet-worker.drain"
owner='77b9d1e2-58f2-42f3-b8df-5342318235fb'
other='8a3acbd6-4a26-49f4-afdc-c963c210523d'
call() { NODE_ENV=test CECELIA_MACHINE_ID=xian-mac-m4 FLEET_NODECTL_NODE="$(command -v node)" FLEET_NODECTL_DRAIN_MARKER="$marker" FLEET_NODECTL_DRAIN_OWNER="$1" FLEET_NODECTL_LAUNCHCTL="$owned_root/launchctl" "$DIR/fleet-nodectl.sh" "$2" xian-mac-m4 --apply; }
printf 'unowned-existing-marker\n' > "$marker"
if call "$owner" undrain >/dev/null 2>&1; then echo 'FAIL: undrain deleted unowned marker' >&2; exit 1; fi
[[ "$(cat "$marker")" == 'unowned-existing-marker' ]]
if call "$owner" drain >/dev/null 2>&1; then echo 'FAIL: drain claimed preexisting marker' >&2; exit 1; fi
rm "$marker"
call "$owner" drain >/dev/null
if call "$other" drain >/dev/null 2>&1; then echo 'FAIL: competing owner claimed marker' >&2; exit 1; fi
if call "$other" undrain >/dev/null 2>&1; then echo 'FAIL: other owner released marker' >&2; exit 1; fi
[[ -f "$marker" ]]
call "$owner" undrain >/dev/null
[[ ! -e "$marker" ]]
echo 'PASS: fixed drain marker ownership'
