#!/usr/bin/env bash
# launchd 已装载不代表实际持有服务；同时核对 PID、业务监听、目录和入口。
preview_agent_owner() { # label root health-url expected-plist
  local label="$1" root="${2%/}" url="$3" plist="${4:-}" state pid port listeners cwd
  state=$(launchctl print "gui/$(id -u)/${label}" 2>/dev/null) || return 1
  pid=$(printf '%s\n' "$state" | awk '/^[[:space:]]*pid = [0-9]+/{print $3;exit}')
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  port=$(node -e 'const u=new URL(process.argv[1]);process.stdout.write(u.port||(u.protocol==="https:"?"443":"80"))' "$url") || return 1
  listeners=$(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u) || return 1
  [[ "$listeners" == "$pid" ]] || return 1
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p') || return 1
  [[ "$cwd" == "$root" ]] || return 1
  # 读取内核原始 argv；ps 的拼接字符串不能区分入口与普通参数。
  python3 - "$pid" "$plist" "$root" "$label" <<'PYOWNER' || return 1
import ctypes, os, plistlib, struct, sys
try:
    pid, path, root, label = int(sys.argv[1]), *sys.argv[2:]
    with open(path, 'rb') as source:
        config = plistlib.load(source)
    args = config.get('ProgramArguments')
    assert isinstance(args, list) and len(args) == 2
    assert all(isinstance(a, str) and a.startswith('/') and not any(c.isspace() for c in a) for a in args)
    assert config.get('Label') == label and config.get('WorkingDirectory') == root
    assert args[1] == root + '/scripts/preview-agent.mjs'
    assert config.get('Program', args[0]) == args[0]
    assert os.path.isfile(args[0]) and os.access(args[0], os.X_OK)
    if sys.platform == 'darwin':
        lib = ctypes.CDLL(None, use_errno=True)
        mib, size = (ctypes.c_int * 3)(1, 49, pid), ctypes.c_size_t()
        assert lib.sysctl(mib, 3, None, ctypes.byref(size), None, 0) == 0
        data = ctypes.create_string_buffer(size.value)
        assert lib.sysctl(mib, 3, data, ctypes.byref(size), None, 0) == 0
        raw = data.raw[:size.value]
        count, = struct.unpack_from('i', raw)
        assert count == 2
        offset = raw.index(b'\0', 4) + 1  # executable path followed by alignment zeros
        while raw[offset] == 0:
            offset += 1
        actual = []
        for _ in range(count):
            end = raw.index(b'\0', offset)
            actual.append(os.fsdecode(raw[offset:end]))
            offset = end + 1
        executable = ctypes.create_string_buffer(4096)
        assert ctypes.CDLL('/usr/lib/libproc.dylib').proc_pidpath(pid, executable, 4096) > 0
        executable = os.fsdecode(executable.value)
    elif sys.platform == 'linux':
        with open('/proc/%d/cmdline' % pid, 'rb') as source:
            actual = [os.fsdecode(a) for a in source.read().split(b'\0')[:-1]]
        executable = os.readlink('/proc/%d/exe' % pid)
    else:
        raise ValueError('unsupported process inspection')
    assert actual == args
    assert os.path.realpath(executable) == os.path.realpath(args[0])
except Exception:
    sys.exit(1)
PYOWNER
  printf '%s\n' "$pid"
}
