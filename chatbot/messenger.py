from __future__ import annotations

import json
from typing import Any
from urllib import request


class MessengerClient:
    def __init__(self, page_access_token: str, graph_api_version: str):
        self.page_access_token = page_access_token
        self.graph_api_version = graph_api_version

    def send(self, psid: str, message: dict[str, Any], page_access_token: str | None = None) -> dict[str, Any]:
        access_token = page_access_token or self.page_access_token
        payload = {
            "recipient": {"id": psid},
            "message": self.to_graph_message(message),
        }
        if not access_token:
            return {"status": "dry_run", "payload": payload}

        url = f"https://graph.facebook.com/{self.graph_api_version}/me/messages?access_token={access_token}"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        http_request = request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(http_request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))

    def to_graph_message(self, message: dict[str, Any]) -> dict[str, Any]:
        if message.get("type") == "image":
            return {
                "attachment": {
                    "type": "image",
                    "payload": {
                        "url": message.get("url", ""),
                        "is_reusable": True,
                    },
                }
            }

        graph_message: dict[str, Any] = {"text": message.get("text", "")}
        if message.get("quick_replies"):
            graph_message["quick_replies"] = message["quick_replies"]
        return graph_message
