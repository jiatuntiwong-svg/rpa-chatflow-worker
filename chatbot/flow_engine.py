from __future__ import annotations

import json
from pathlib import Path
from typing import Any


DEFAULT_FLOW = {
    "name": "Demo Messenger Flow",
    "first_time": "start",
    "start": "start",
    "fallback": "fallback",
    "nodes": {
        "start": {
            "message": "สวัสดีครับ สนใจเรื่องไหนเลือกได้เลยครับ",
            "quick_replies": [
                {"title": "ดูสินค้า", "payload": "PRODUCTS", "next": "products"},
                {"title": "คุยกับแอดมิน", "payload": "HUMAN", "next": "human"},
            ],
            "next": "start",
        },
        "products": {
            "message": "ตอนนี้เรามีแพ็กเกจ Chatbot Starter และ Automation Pro ครับ พิมพ์ ราคา เพื่อดูราคาได้เลย",
            "keywords": ["สินค้า", "product", "products", "PRODUCTS"],
            "next": "products",
        },
        "pricing": {
            "message": "แพ็กเกจเริ่มต้น 2,900 บาท ตั้งค่า Flow + เชื่อม Facebook Page ให้พร้อมใช้งานครับ",
            "keywords": ["ราคา", "price", "pricing"],
            "next": "pricing",
        },
        "human": {
            "message": "รับทราบครับ เดี๋ยวแอดมินเข้ามาดูแลต่อ กรุณาฝากเบอร์โทรหรือรายละเอียดไว้ได้เลย",
            "keywords": ["แอดมิน", "admin", "human", "HUMAN"],
            "next": "human",
        },
        "fallback": {
            "message": "ขออภัยครับ ผมยังไม่เข้าใจ ลองพิมพ์ สินค้า, ราคา หรือ แอดมิน ได้ครับ",
            "next": "start",
        },
    },
}


class FlowEngine:
    def __init__(self, path: Path):
        self.path = path
        self._flow: dict[str, Any] | None = None

    def ensure_seed(self) -> None:
        self.path.parent.mkdir(exist_ok=True)
        if not self.path.exists():
            self.save(DEFAULT_FLOW)

    def reload(self) -> dict[str, Any]:
        self.ensure_seed()
        self._flow = json.loads(self.path.read_text(encoding="utf-8"))
        return self._flow

    def save(self, flow: dict[str, Any]) -> dict[str, Any]:
        self.validate(flow)
        self.path.parent.mkdir(exist_ok=True)
        self.path.write_text(json.dumps(flow, ensure_ascii=False, indent=2), encoding="utf-8")
        self._flow = flow
        return flow

    def reply(self, incoming_text: str, current_state: str, is_first_time: bool = False) -> tuple[list[dict[str, Any]], str]:
        flow = self._flow or self.reload()
        nodes = flow["nodes"]
        normalized = incoming_text.strip().lower()

        if is_first_time:
            matched_key = flow.get("first_time") or flow["start"]
        else:
            matched_key = self.match_node(nodes, normalized, current_state)
        node = nodes.get(matched_key) or nodes[flow["fallback"]]

        messages = self.node_to_messages(node)
        next_state = node.get("next") or matched_key
        if next_state not in nodes:
            next_state = flow["start"]
        return messages, next_state

    def match_node(self, nodes: dict[str, Any], text: str, current_state: str) -> str:
        for key, node in nodes.items():
            keywords = [str(item).lower() for item in node.get("keywords", [])]
            quick_payloads = [str(item.get("payload", "")).lower() for item in node.get("quick_replies", [])]
            if text in keywords or text in quick_payloads:
                return key

        current = nodes.get(current_state)
        if current:
            for reply in current.get("quick_replies", []):
                if text == str(reply.get("payload", "")).lower() or text == str(reply.get("title", "")).lower():
                    return str(reply.get("next") or current_state)

        return "fallback"

    def node_to_messages(self, node: dict[str, Any]) -> list[dict[str, Any]]:
        blocks = node.get("blocks")
        if not blocks:
            blocks = [{"type": "text", "text": node.get("message", "")}]

        outgoing: list[dict[str, Any]] = []
        for block in blocks:
            block_type = block.get("type", "text")
            if block_type == "image" and block.get("url"):
                outgoing.append({"type": "image", "url": block["url"]})
            elif block.get("text"):
                outgoing.append({"type": "text", "text": block["text"]})

        if not outgoing:
            outgoing.append({"type": "text", "text": node.get("message", "")})

        if node.get("quick_replies"):
            target = next((item for item in reversed(outgoing) if item["type"] == "text"), outgoing[-1])
            if target["type"] != "text":
                outgoing.append({"type": "text", "text": "เลือกตัวเลือกด้านล่างได้เลยครับ"})
                target = outgoing[-1]
            target["quick_replies"] = [
                {
                    "content_type": "text",
                    "title": item["title"],
                    "payload": item["payload"],
                }
                for item in node["quick_replies"]
            ]
        return outgoing

    def validate(self, flow: dict[str, Any]) -> None:
        if not isinstance(flow, dict):
            raise ValueError("Flow must be a JSON object")
        nodes = flow.get("nodes")
        if not isinstance(nodes, dict) or not nodes:
            raise ValueError("Flow must contain nodes")
        for required in ("start", "fallback"):
            if flow.get(required) not in nodes:
                raise ValueError(f"Flow {required} must point to an existing node")
        if flow.get("first_time") and flow.get("first_time") not in nodes:
            raise ValueError("Flow first_time must point to an existing node")
        for key, node in nodes.items():
            if not isinstance(node, dict):
                raise ValueError(f"Node {key} must be an object")
            if not node.get("message") and not node.get("blocks"):
                raise ValueError(f"Node {key} must contain message or blocks")
