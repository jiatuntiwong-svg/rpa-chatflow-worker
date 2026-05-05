create table if not exists app_kv (
  key text primary key,
  value text not null,
  updated_at text not null
);

create table if not exists subscribers (
  psid text primary key,
  state text not null default 'start',
  first_seen_at text not null,
  last_seen_at text not null
);

create table if not exists events (
  id integer primary key autoincrement,
  psid text not null,
  direction text not null,
  message text not null default '',
  payload text not null default '{}',
  created_at text not null
);

create index if not exists idx_events_created_at on events(created_at);
create index if not exists idx_events_psid on events(psid);

create table if not exists webhook_requests (
  id integer primary key autoincrement,
  method text not null,
  path text not null,
  query text not null default '',
  headers text not null default '{}',
  body text not null default '',
  created_at text not null
);

create index if not exists idx_webhook_requests_created_at on webhook_requests(created_at);

create table if not exists oauth_states (
  state text primary key,
  created_at text not null
);

create table if not exists connected_pages (
  page_id text primary key,
  name text not null,
  access_token text not null,
  tasks text not null default '[]',
  created_at text not null,
  updated_at text not null
);
