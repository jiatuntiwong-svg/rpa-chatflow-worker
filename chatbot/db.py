from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


class Database:
    def __init__(self, path: Path):
        self.path = path

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        self.path.parent.mkdir(exist_ok=True)
        with self.connect() as db:
            db.executescript(
                """
                create table if not exists subscribers (
                  psid text primary key,
                  state text not null default 'start',
                  first_seen_at text not null default current_timestamp,
                  last_seen_at text not null default current_timestamp
                );

                create table if not exists events (
                  id integer primary key autoincrement,
                  psid text not null,
                  direction text not null,
                  text text not null,
                  payload text not null,
                  created_at text not null default current_timestamp
                );

                create table if not exists webhook_requests (
                  id integer primary key autoincrement,
                  method text not null,
                  path text not null,
                  query text not null,
                  headers text not null,
                  body text not null,
                  created_at text not null default current_timestamp
                );

                create table if not exists oauth_states (
                  state text primary key,
                  created_at text not null default current_timestamp
                );

                create table if not exists connected_pages (
                  page_id text primary key,
                  name text not null,
                  access_token text not null,
                  tasks text not null,
                  connected_at text not null default current_timestamp,
                  updated_at text not null default current_timestamp
                );
                """
            )

    def upsert_subscriber(self, psid: str) -> bool:
        with self.connect() as db:
            exists = db.execute("select 1 from subscribers where psid = ?", (psid,)).fetchone() is not None
            db.execute(
                """
                insert into subscribers (psid) values (?)
                on conflict(psid) do update set last_seen_at = current_timestamp
                """,
                (psid,),
            )
            return not exists

    def get_state(self, psid: str) -> str:
        with self.connect() as db:
            row = db.execute("select state from subscribers where psid = ?", (psid,)).fetchone()
            return row["state"] if row else "start"

    def set_state(self, psid: str, state: str) -> None:
        with self.connect() as db:
            db.execute(
                "update subscribers set state = ?, last_seen_at = current_timestamp where psid = ?",
                (state, psid),
            )

    def list_subscribers(self) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                "select psid, state, first_seen_at, last_seen_at from subscribers order by last_seen_at desc"
            ).fetchall()
            return [dict(row) for row in rows]

    def record_event(self, psid: str, direction: str, text: str, payload: Any) -> None:
        with self.connect() as db:
            db.execute(
                "insert into events (psid, direction, text, payload) values (?, ?, ?, ?)",
                (psid, direction, text, json.dumps(payload, ensure_ascii=False)),
            )

    def list_events(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                """
                select id, psid, direction, text, payload, created_at
                from events
                order by id desc
                limit ?
                """,
                (limit,),
            ).fetchall()
            return [dict(row) for row in rows]

    def record_webhook_request(
        self,
        method: str,
        path: str,
        query: str,
        headers: dict[str, str],
        body: str = "",
    ) -> None:
        with self.connect() as db:
            db.execute(
                """
                insert into webhook_requests (method, path, query, headers, body)
                values (?, ?, ?, ?, ?)
                """,
                (
                    method,
                    path,
                    query,
                    json.dumps(headers, ensure_ascii=False),
                    body,
                ),
            )

    def list_webhook_requests(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                """
                select id, method, path, query, headers, body, created_at
                from webhook_requests
                order by id desc
                limit ?
                """,
                (limit,),
            ).fetchall()
            return [dict(row) for row in rows]

    def save_oauth_state(self, state: str) -> None:
        with self.connect() as db:
            db.execute("insert into oauth_states (state) values (?)", (state,))

    def consume_oauth_state(self, state: str) -> bool:
        with self.connect() as db:
            row = db.execute("select state from oauth_states where state = ?", (state,)).fetchone()
            if not row:
                return False
            db.execute("delete from oauth_states where state = ?", (state,))
            return True

    def save_connected_page(self, page_id: str, name: str, access_token: str, tasks: list[str]) -> None:
        with self.connect() as db:
            db.execute(
                """
                insert into connected_pages (page_id, name, access_token, tasks)
                values (?, ?, ?, ?)
                on conflict(page_id) do update set
                  name = excluded.name,
                  access_token = excluded.access_token,
                  tasks = excluded.tasks,
                  updated_at = current_timestamp
                """,
                (page_id, name, access_token, json.dumps(tasks, ensure_ascii=False)),
            )

    def list_connected_pages(self) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                """
                select page_id, name, tasks, connected_at, updated_at
                from connected_pages
                order by updated_at desc
                """
            ).fetchall()
            pages = []
            for row in rows:
                page = dict(row)
                page["tasks"] = json.loads(page["tasks"])
                pages.append(page)
            return pages

    def get_page_token(self, page_id: str | None) -> str | None:
        if not page_id:
            return None
        with self.connect() as db:
            row = db.execute("select access_token from connected_pages where page_id = ?", (page_id,)).fetchone()
            return row["access_token"] if row else None

    def get_connected_page(self, page_id: str | None = None) -> dict[str, Any] | None:
        with self.connect() as db:
            if page_id:
                row = db.execute(
                    "select page_id, name, access_token, tasks from connected_pages where page_id = ?",
                    (page_id,),
                ).fetchone()
            else:
                row = db.execute(
                    """
                    select page_id, name, access_token, tasks
                    from connected_pages
                    order by updated_at desc
                    limit 1
                    """
                ).fetchone()
            if not row:
                return None
            page = dict(row)
            page["tasks"] = json.loads(page["tasks"])
            return page
