"""唯一固定只读ADB服务；只连接既有daemon，不exec或启动/终止任何程序。

协议依据：Android SERVICES.TXT 与现代 client/adb_client.cpp 的 adb_query。
这里只证明本socket查询结束，不能推广成采收/触达的进程树退出证明。
"""
import math
import re
import socket
import time


HOST = '127.0.0.1'
PORT = 5037
MAX_STATE_BYTES = 64


def get_state(serial, timeout_sec=5, *, _port=PORT):
    # _port仅供模块内构造的测试fixture；生产worker配置不会从JSON接受它。
    if not isinstance(serial, str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', serial):
        raise ValueError('phone_adb_server_protocol')
    if not isinstance(_port, int) or isinstance(_port, bool) or not 0 < _port <= 65535 or not isinstance(timeout_sec, (int, float)) or not math.isfinite(timeout_sec) or not 0 < timeout_sec <= 10:
        raise ValueError('phone_adb_server_protocol')
    request = ('host-serial:' + serial + ':get-state').encode('ascii')
    deadline = time.monotonic() + timeout_sec

    def remaining(conn):
        budget = deadline - time.monotonic()
        if budget <= 0:
            raise ValueError('phone_adb_server_timeout')
        conn.settimeout(budget)

    def exact(conn, size):
        body = bytearray()
        while len(body) < size:
            remaining(conn)
            part = conn.recv(size - len(body))
            if not part:
                raise ValueError('phone_adb_server_eof')
            body.extend(part)
        return bytes(body)

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as conn:
            remaining(conn)
            conn.connect((HOST, _port))
            remaining(conn)
            conn.sendall(('{:04x}'.format(len(request))).encode('ascii') + request)
            status = exact(conn, 4)
            if status == b'FAIL':
                # daemon诊断可能含路径/敏感信息；不读取、不暴露、不执行补救命令。
                raise ValueError('phone_adb_server_fail')
            if status != b'OKAY':
                raise ValueError('phone_adb_server_protocol')
            raw_length = exact(conn, 4)
            if not re.fullmatch(b'[0-9A-Fa-f]{4}', raw_length):
                raise ValueError('phone_adb_server_protocol')
            size = int(raw_length, 16)
            if not 0 < size <= MAX_STATE_BYTES:
                raise ValueError('phone_adb_server_protocol')
            body = exact(conn, size)
            remaining(conn)
            if conn.recv(1) != b'':
                raise ValueError('phone_adb_server_protocol')
            try:
                return body.decode('ascii')
            except UnicodeDecodeError as error:
                raise ValueError('phone_adb_server_protocol') from error
    except socket.timeout as error:
        raise ValueError('phone_adb_server_timeout') from error
    except OSError as error:
        raise ValueError('phone_adb_server_unavailable') from error
