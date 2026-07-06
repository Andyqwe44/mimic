"""
示例: Python 连接 TCP :9999 → 接收帧 → 保存为 PNG

使用 canonical protocol/ 格式 (12字节头 + type_tag).

运行:
    # 终端1: ./cpp_tcp_send.exe
    # 终端2: python examples/python_tcp_recv.py

依赖: 无 (纯标准库). 可选: numpy + PIL 保存图片.
"""
import sys
import os
import socket
import struct

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from protocol.protocol import MAGIC, FRAME_HEADER_SIZE, PayloadType, HEADER_STRUCT, parse_header
from model.payload.bgra import BgraFrame, unpack as bgra_unpack

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def recv_exact(sock: socket.socket, n: int) -> bytes | None:
    buf = b""
    while len(buf) < n:
        try:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        except (ConnectionError, OSError):
            return None
    return buf


def main():
    host = "127.0.0.1"
    port = 9999

    print(f"Connecting to {host}:{port}...")
    sock = socket.create_connection((host, port), timeout=5.0)

    frame_count = 0
    while True:
        # Read 12-byte protocol header
        hdr = recv_exact(sock, FRAME_HEADER_SIZE)
        if not hdr:
            break

        result = parse_header(hdr)
        if result is None:
            print(f"Bad magic or unknown type_tag in header: {hdr.hex()}")
            break
        size, type_tag = result

        if size == 0:
            continue  # unchanged signal

        # Read payload body
        payload = recv_exact(sock, size)
        if not payload:
            break

        if type_tag == PayloadType.BGRA_FRAME:
            frame = bgra_unpack(payload)
            if frame:
                frame_count += 1
                print(f"[python] frame {frame_count}: {frame.width}x{frame.height} "
                      f"ch={frame.channels} {len(frame.pixels)//1024}KB")

                if frame_count % 25 == 0 and HAS_NUMPY and HAS_PIL:
                    img = frame.to_numpy()
                    rgba = img[:, :, [2, 1, 0, 3]]  # BGRA → RGBA
                    Image.fromarray(rgba).save(f"frame_{frame_count:04d}.png")
                    print(f"  -> saved frame_{frame_count:04d}.png")
        else:
            print(f"[python] frame {frame_count+1}: type_tag={type_tag} (skipped)")

    sock.close()
    print(f"Done: {frame_count} frames received")


if __name__ == "__main__":
    main()
