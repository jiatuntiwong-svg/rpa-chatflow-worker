from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    verify_token: str
    page_access_token: str
    graph_api_version: str
    facebook_app_id: str
    facebook_app_secret: str
    public_base_url: str
    data_dir: str
    flow_path: str

    @classmethod
    def from_env(cls) -> "Settings":
        load_env_file(Path(__file__).resolve().parents[1] / ".env")
        return cls(
            host=os.getenv("HOST", "127.0.0.1"),
            port=int(os.getenv("PORT", "8000")),
            verify_token=os.getenv("VERIFY_TOKEN", "change-me-verify-token"),
            page_access_token=os.getenv("PAGE_ACCESS_TOKEN", ""),
            graph_api_version=os.getenv("GRAPH_API_VERSION", "v19.0"),
            facebook_app_id=os.getenv("FACEBOOK_APP_ID", ""),
            facebook_app_secret=os.getenv("FACEBOOK_APP_SECRET", ""),
            public_base_url=os.getenv("PUBLIC_BASE_URL", ""),
            data_dir=os.getenv("DATA_DIR", "data"),
            flow_path=os.getenv("FLOW_PATH", "data/flows.json"),
        )

    @property
    def oauth_redirect_uri(self) -> str:
        return f"{self.public_base_url.rstrip('/')}/auth/facebook/callback"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
