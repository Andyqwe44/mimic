"""
hello_python_recv.py — Python connects to TCP, receives "hello world".

运行:
  终端1: ./hello_tcp_send.exe
  终端2: python examples/hello_python_recv.py

流程:
  连接 :9999 → 读 header → 读 type_tag → type=3 → 打印字符串
"""
import sys, os, socket, struct
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ── 使用 protocol 模块 ──
from protocol.protocol import MAGIC, FRAME_HEADER_SIZE, PayloadType
HEADER = struct.Struct("<III")

def recv_frame(sock):
    hdr = b""
    while len(hdr) < FRAME_HEADER_SIZE:
        chunk = sock.recv(FRAME_HEADER_SIZE - len(hdr))
        if not chunk: return None
        hdr += chunk
    magic, size, tag = HEADER.unpack(hdr)
    if magic != MAGIC:
        print(f"Bad magic: 0x{magic:08X}")
        return None
    payload = b""
    while len(payload) < size:
        chunk = sock.recv(size - len(payload))
        if not chunk: break
        payload += chunk
    return tag, payload

def main():
    sock = socket.create_connection(("127.0.0.1", 9999))
    print(f"[python] connected to :9999")

    while True:
        frame = recv_frame(sock)
        if frame is None: break
        tag, payload = frame
        type_name = PayloadType(tag).name if tag in PayloadType.__members__.values() else f"UNKNOWN({tag})"
        text = payload.decode("utf-8", errors="replace")
        print(f"[python] type={type_name} payload={len(payload)}B \"{text}\"")

    print("[python] done")

if __name__ == "__main__":
    main()
