"""仅测试使用的既有ADB daemon模拟器；生产runner从不启动此文件。"""
import json
from pathlib import Path
import socket
import subprocess
import sys
import time


def serve(policy_file, count_file):
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen(16)
        print(listener.getsockname()[1], flush=True)
        while True:
            conn, _ = listener.accept()
            with conn:
                header = exact(conn, 4)
                request = exact(conn, int(header, 16))
                if request != b'host-serial:fixture-serial:get-state':
                    conn.sendall(b'FAIL000einvalid query!')
                    continue
                with open(count_file, 'a') as handle:
                    handle.write('launch\n')
                policy = json.loads(Path(policy_file).read_text())
                time.sleep(policy.get('sleep', 0))
                response = bytes.fromhex(policy.get('wire', '4f4b415930303036646576696365'))
                step = policy.get('fragment', len(response) or 1)
                try:
                    for offset in range(0, len(response), step):
                        conn.sendall(response[offset:offset + step])
                        time.sleep(policy.get('fragment_delay', 0))
                    time.sleep(policy.get('hold', 0))
                except (BrokenPipeError, ConnectionResetError):
                    pass


def exact(conn, size):
    chunks = bytearray()
    while len(chunks) < size:
        part = conn.recv(size - len(chunks))
        if not part:
            raise ValueError('fixture eof')
        chunks.extend(part)
    return bytes(chunks)


class SocketFixture:
    def __init__(self, root, count_file):
        self.policy = Path(root) / 'daemon-policy.json'
        self.set()
        self.child = subprocess.Popen([sys.executable, '-B', __file__, str(self.policy), str(count_file)],
                                      stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.port = int(self.child.stdout.readline().strip())

    def set(self, **policy):
        self.policy.write_text(json.dumps(policy))

    def close(self):
        self.child.terminate()
        self.child.wait(timeout=2)
        self.child.stdout.close()


if __name__ == '__main__':
    serve(sys.argv[1], sys.argv[2])
