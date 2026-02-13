#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servidor TCP simples para diagnóstico de pacotes (Traccar TCP).

- Abre uma porta TCP e imprime hexdump + ASCII de cada pacote recebido
- Grava JSON Lines com timestamp, cliente e bytes

Exemplos:
  python3 diag_traccar_tcp.py --port 5055
  python3 diag_traccar_tcp.py --host 0.0.0.0 --port 5055 --outfile diag_tcp.jsonl
"""

import argparse
import json
import socket
import threading
import time
from datetime import datetime


def now_iso():
    return datetime.now().astimezone().isoformat()


def hexdump(data: bytes, width: int = 16):
    lines = []
    for offset in range(0, len(data), width):
        chunk = data[offset:offset + width]
        hex_part = " ".join(f"{b:02x}" for b in chunk)
        ascii_part = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append(f"{offset:04x}  {hex_part:<{width*3}}  {ascii_part}")
    return "\n".join(lines)


def build_arg_parser():
    parser = argparse.ArgumentParser(description="Diagnóstico TCP para Traccar")
    parser.add_argument("--host", default="0.0.0.0", help="Host de bind")
    parser.add_argument("--port", type=int, default=5055, help="Porta TCP")
    parser.add_argument("--outfile", default="diag_tcp.jsonl", help="Arquivo JSONL de saída")
    return parser


def main():
    args = build_arg_parser().parse_args()
    lock = threading.Lock()

    def log_event(entry):
        with lock:
            with open(args.outfile, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def handle_client(conn, addr):
        client = f"{addr[0]}:{addr[1]}"
        log_event({"ts": now_iso(), "type": "connect", "client": client})
        try:
            while True:
                data = conn.recv(4096)
                if not data:
                    break
                dump = hexdump(data)
                print(f"\n[{now_iso()}] {client} - {len(data)} bytes\n{dump}")
                log_event({
                    "ts": now_iso(),
                    "type": "packet",
                    "client": client,
                    "size": len(data),
                    "hex": data.hex(),
                })
        finally:
            log_event({"ts": now_iso(), "type": "disconnect", "client": client})
            try:
                conn.close()
            except Exception:
                pass

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((args.host, args.port))
    server.listen(50)
    print(f"TCP diagnóstico escutando em {args.host}:{args.port}")

    try:
        while True:
            conn, addr = server.accept()
            thread = threading.Thread(target=handle_client, args=(conn, addr), daemon=True)
            thread.start()
    except KeyboardInterrupt:
        print("Encerrando...")
    finally:
        server.close()


if __name__ == "__main__":
    main()
