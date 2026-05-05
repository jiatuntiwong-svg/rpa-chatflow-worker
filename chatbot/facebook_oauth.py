from __future__ import annotations

import json
from typing import Any
from urllib import parse, request


class FacebookOAuth:
    def __init__(self, app_id: str, app_secret: str, graph_api_version: str):
        self.app_id = app_id
        self.app_secret = app_secret
        self.graph_api_version = graph_api_version

    def authorization_url(self, redirect_uri: str, state: str) -> str:
        params = {
            "client_id": self.app_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "response_type": "code",
            "scope": ",".join(
                [
                    "pages_show_list",
                    "pages_manage_metadata",
                    "pages_messaging",
                    "pages_read_engagement",
                ]
            ),
        }
        return f"https://www.facebook.com/{self.graph_api_version}/dialog/oauth?{parse.urlencode(params)}"

    def exchange_code(self, redirect_uri: str, code: str) -> str:
        params = {
            "client_id": self.app_id,
            "client_secret": self.app_secret,
            "redirect_uri": redirect_uri,
            "code": code,
        }
        url = f"https://graph.facebook.com/{self.graph_api_version}/oauth/access_token?{parse.urlencode(params)}"
        return self.get_json(url)["access_token"]

    def list_pages(self, user_access_token: str) -> list[dict[str, Any]]:
        params = {
            "fields": "id,name,access_token,tasks",
            "access_token": user_access_token,
        }
        url = f"https://graph.facebook.com/{self.graph_api_version}/me/accounts?{parse.urlencode(params)}"
        return self.get_json(url).get("data", [])

    def subscribe_page(self, page_id: str, page_access_token: str) -> dict[str, Any]:
        url = f"https://graph.facebook.com/{self.graph_api_version}/{page_id}/subscribed_apps"
        body = parse.urlencode(
            {
                "subscribed_fields": "messages,messaging_postbacks,standby,messaging_handovers,message_echoes",
                "access_token": page_access_token,
            }
        ).encode("utf-8")
        http_request = request.Request(url, data=body, method="POST")
        with request.urlopen(http_request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))

    def get_json(self, url: str) -> dict[str, Any]:
        with request.urlopen(url, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
