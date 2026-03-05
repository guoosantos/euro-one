#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Kit de diagnóstico MQTT para Xirgo IoTM.

Requisitos atendidos:
- Assina BCE/D, BCE/E, BCE/R e BCE/# (fallback)
- TLS opcional, user/pass opcionais
- Loga JSON Lines com timestamp, tópico, payload raw (base64 se binário), payload decodificado (JSON), tamanho
- Métricas: mensagens/min por tópico, maior gap entre mensagens, conexões/reconexões
- CLI: --host --port --username --password --tls --cafile --topics --outfile --duration --qos

Exemplos:
  python3 diag_iotm_mqtt.py --host broker.exemplo.com --port 1883 --username USER --password PASS
  python3 diag_iotm_mqtt.py --host broker.exemplo.com --port 8883 --tls --cafile /path/ca.crt
  python3 diag_iotm_mqtt.py --host broker.exemplo.com --topics BCE/D,BCE/E --duration 600 --outfile diag.jsonl

"""

import argparse
import base64
import json
import signal
import sys
import time
from collections import defaultdict
from datetime import datetime

try:
    import paho.mqtt.client as mqtt
except Exception as exc:  # pragma: no cover
    print("Erro: biblioteca paho-mqtt não instalada.")
    print("Instale com: pip install paho-mqtt")
    raise


def now_iso():
    return datetime.now().astimezone().isoformat()


def is_probably_text(data: bytes) -> bool:
    if not data:
        return True
    try:
        text = data.decode("utf-8")
    except Exception:
        return False
    # Se tiver muitos caracteres de controle, não tratar como texto.
    control = sum(1 for ch in text if ord(ch) < 9 or (13 < ord(ch) < 32))
    return control <= max(1, len(text) // 20)


def decode_payload(data: bytes):
    if data is None:
        return None, None, None
    if is_probably_text(data):
        text = data.decode("utf-8", errors="replace")
        decoded = None
        try:
            decoded = json.loads(text)
        except Exception:
            decoded = None
        return text, "utf-8", decoded
    encoded = base64.b64encode(data).decode("ascii")
    return encoded, "base64", None


def build_arg_parser():
    parser = argparse.ArgumentParser(description="Diagnóstico MQTT para Xirgo IoTM")
    parser.add_argument("--host", required=True, help="Host do broker MQTT")
    parser.add_argument("--port", type=int, default=1883, help="Porta do broker MQTT")
    parser.add_argument("--username", default=None, help="Usuário MQTT")
    parser.add_argument("--password", default=None, help="Senha MQTT")
    parser.add_argument("--tls", action="store_true", help="Habilitar TLS")
    parser.add_argument("--cafile", default=None, help="CA file (TLS)")
    parser.add_argument(
        "--topics",
        default="BCE/D,BCE/E,BCE/R",
        help="Lista de tópicos separados por vírgula (default: BCE/D,BCE/E,BCE/R)",
    )
    parser.add_argument("--outfile", default="diag.jsonl", help="Arquivo de saída JSONL")
    parser.add_argument("--duration", type=int, default=300, help="Duração em segundos")
    parser.add_argument("--qos", type=int, default=0, choices=[0, 1], help="QoS para subscribe")
    return parser


def main():
    args = build_arg_parser().parse_args()

    topics = [t.strip() for t in args.topics.split(",") if t.strip()]
    if "BCE/#" not in topics:
        topics.append("BCE/#")

    start_ts = time.time()
    stop_ts = start_ts + args.duration
    stats = {
        "count": defaultdict(int),
        "last_ts": {},
        "max_gap": defaultdict(float),
        "connects": 0,
        "disconnects": 0,
        "reconnects": 0,
    }
    stop_requested = False

    def log_event(entry):
        with open(args.outfile, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def on_connect(client, userdata, flags, rc):
        stats["connects"] += 1
        if stats["connects"] > 1:
            stats["reconnects"] += 1
        log_event({
            "ts": now_iso(),
            "type": "connect",
            "rc": rc,
            "flags": flags,
        })
        for topic in topics:
            client.subscribe(topic, qos=args.qos)

    def on_disconnect(client, userdata, rc):
        stats["disconnects"] += 1
        log_event({
            "ts": now_iso(),
            "type": "disconnect",
            "rc": rc,
        })

    def on_message(client, userdata, msg):
        received_ts = time.time()
        payload_raw, payload_encoding, payload_decoded = decode_payload(msg.payload)
        topic = msg.topic
        stats["count"][topic] += 1
        last = stats["last_ts"].get(topic)
        if last is not None:
            gap = received_ts - last
            if gap > stats["max_gap"][topic]:
                stats["max_gap"][topic] = gap
        stats["last_ts"][topic] = received_ts

        log_event({
            "ts": now_iso(),
            "type": "message",
            "topic": topic,
            "qos": msg.qos,
            "retain": msg.retain,
            "payload_size": len(msg.payload) if msg.payload is not None else 0,
            "payload_raw": payload_raw,
            "payload_raw_encoding": payload_encoding,
            "payload_decoded": payload_decoded,
        })

    def handle_signal(sig, frame):
        nonlocal stop_requested
        stop_requested = True

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    client = mqtt.Client()
    if args.username:
        client.username_pw_set(args.username, args.password or "")
    if args.tls or args.cafile:
        client.tls_set(ca_certs=args.cafile)

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message

    try:
        client.connect(args.host, args.port, keepalive=60)
    except Exception as exc:
        print(f"Falha ao conectar no broker: {exc}")
        sys.exit(1)

    client.loop_start()

    try:
        while time.time() < stop_ts and not stop_requested:
            time.sleep(0.2)
    finally:
        try:
            client.disconnect()
        except Exception:
            pass
        client.loop_stop()

    elapsed = max(1, int(time.time() - start_ts))
    minutes = elapsed / 60.0

    print("\nResumo MQTT:")
    print(f"- Duração: {elapsed}s")
    print(f"- Conexões: {stats['connects']} (reconexões: {stats['reconnects']})")
    print(f"- Desconexões: {stats['disconnects']}")

    def topic_summary(label):
        total = 0
        for t, count in stats["count"].items():
            if t == label or t.startswith(label.replace("#", "")):
                total += count
        return total

    for base in ["BCE/D", "BCE/E", "BCE/R"]:
        total = topic_summary(base)
        rate = total / minutes if minutes > 0 else 0
        gaps = [stats["max_gap"].get(t, 0.0) for t in stats["max_gap"] if t.startswith(base)]
        max_gap = max(gaps) if gaps else 0.0
        status = "OK" if total > 0 else "NÃO CHEGOU"
        print(f"- {base}: {status} | msgs={total} | msgs/min={rate:.2f} | maior_gap={max_gap:.1f}s")

    total_all = sum(stats["count"].values())
    print(f"- Total (todos os tópicos): {total_all} mensagens")
    print(f"- Log salvo em: {args.outfile}")


if __name__ == "__main__":
    main()
