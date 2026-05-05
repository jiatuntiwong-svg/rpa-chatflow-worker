const DEFAULT_GRAPH_VERSION = "v25.0";

const DEFAULT_FLOW = {
  name: "RPA Chatflow",
  first_time: "start",
  start: "start",
  fallback: "fallback",
  nodes: {
    start: {
      message:
        "สวัสดีครับ 😊 ขอบคุณที่ทักมานะครับ\nเรามีสินค้าอยู่ 3 อย่างครับ\n\n📘 คู่มือ Forex ฉบับจับมือทำ เล่ม 1 — 199 ฿\n📗 คู่มือ Forex ฉบับจับมือทำ เล่ม 2 — 299 ฿\n⚡ ProTradingPanel (โปรแกรมเทรด MT5) — 990 ฿\n\nหรือซื้อแบบ Full Bundle ครบทุกอย่าง 1,290 ฿ ประหยัด 198 ฿ ทันทีครับ\nทักถามรายละเอียดเพิ่มเติมได้เลยนะครับ 🙏",
      keywords: [],
      quick_replies: [
        { title: "ดูสินค้า", payload: "PRODUCTS", next: "products" },
        { title: "คุยกับแอดมิน", payload: "HUMAN", next: "human" },
      ],
      next: "start",
    },
    products: {
      message:
        "สวัสดีครับ 😊 ขอบคุณที่ทักมานะครับ\nเรามีสินค้าอยู่ 3 อย่างครับ\n\n📘 คู่มือ Forex ฉบับจับมือทำ เล่ม 1 — 199 ฿\n📗 คู่มือ Forex ฉบับจับมือทำ เล่ม 2 — 299 ฿\n⚡ ProTradingPanel (โปรแกรมเทรด MT5) — 990 ฿\n\nหรือซื้อแบบ Full Bundle ครบทุกอย่าง 1,290 ฿ ประหยัด 198 ฿ ทันทีครับ\nทักถามรายละเอียดเพิ่มเติมได้เลยนะครับ 🙏",
      keywords: ["สินค้า", "ราคา", "product", "products", "price", "pricing", "PRODUCTS"],
      next: "products",
    },
    human: {
      message: "รับทราบครับ เดี๋ยวแอดมินเข้ามาดูแลต่อ ฝากรายละเอียดไว้ได้เลยครับ",
      keywords: ["แอดมิน", "admin", "human", "HUMAN"],
      next: "human",
    },
    fallback: {
      message: "ขออภัยครับ ผมยังไม่เข้าใจ ลองพิมพ์ สินค้า, ราคา หรือ แอดมิน ได้ครับ",
      next: "start",
    },
  },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      await ensureSeed(env);

      if (url.pathname === "/webhook" && request.method === "GET") {
        await recordWebhookRequest(env, request, "");
        return verifyWebhook(url, env);
      }
      if (url.pathname === "/webhook" && request.method === "POST") {
        const body = await request.text();
        await recordWebhookRequest(env, request, body);
        return handleWebhook(body, env);
      }

      if (url.pathname === "/api/flows" && request.method === "GET") return json(await getFlow(env, url.searchParams.get("page_id")));
      if (url.pathname === "/api/flows" && request.method === "PUT") return saveFlow(request, url, env);
      if (url.pathname === "/api/subscribers" && request.method === "GET") return listSubscribers(env);
      if (url.pathname === "/api/events" && request.method === "GET") return listEvents(env);
      if (url.pathname === "/api/webhook-requests" && request.method === "GET") return listWebhookRequests(env);
      if (url.pathname === "/api/connected-pages" && request.method === "GET") return listConnectedPages(env);
      if (url.pathname === "/api/page-conversations" && request.method === "GET") return pageConversations(url, env);
      if (url.pathname === "/api/test-send" && request.method === "POST") return testSend(request, env);
      if (url.pathname === "/api/broadcast" && request.method === "POST") return broadcast(request, env);
      if (url.pathname === "/api/uploads" && request.method === "POST") return uploadAsset(request, env);
      if (url.pathname.startsWith("/uploads/") && request.method === "GET") return serveUpload(url, env);
      if (url.pathname === "/connect-facebook" && request.method === "GET") return connectFacebookPage(env);
      if (url.pathname === "/auth/facebook/start" && request.method === "GET") return facebookStart(env);
      if (url.pathname === "/auth/facebook/callback" && request.method === "GET") return facebookCallback(url, env);

      if (env.ASSETS) return env.ASSETS.fetch(request);
      return text("Not found", 404);
    } catch (error) {
      await recordEvent(env, "system", "error", error.message, { stack: error.stack });
      return json({ error: error.message }, 500);
    }
  },
};

async function ensureSeed(env) {
  const flow = await env.DB.prepare("select value from app_kv where key = ?").bind("flow").first();
  if (!flow) {
    await env.DB.prepare("insert into app_kv (key, value, updated_at) values (?, ?, ?)")
      .bind("flow", JSON.stringify(DEFAULT_FLOW), now())
      .run();
  }
}

function verifyWebhook(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") || "";
  if (mode === "subscribe" && token === env.VERIFY_TOKEN) return text(challenge);
  return text("Webhook verification failed", 403);
}

async function handleWebhook(rawBody, env) {
  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch (error) {
    await recordEvent(env, "unknown", "webhook_error", "Invalid JSON", { body: rawBody, error: error.message });
    return json({ status: "invalid_json" }, 400);
  }

  await recordEvent(env, "webhook", "webhook_post", eventTypes(payload).join(",") || "unknown", payload);
  const flowCache = {};

  for (const event of extractMessagingEvents(payload)) {
    const senderId = event.sender?.id;
    if (!senderId) continue;

    const pageId = event.recipient?.id || "";
    const messageText = event.message?.text || event.postback?.payload || "";
    const isFirstTime = await upsertSubscriber(env, senderId);
    await recordEvent(env, senderId, "inbound", messageText, event);

    if (!flowCache[pageId]) {
      flowCache[pageId] = await getFlow(env, pageId);
    }
    const flow = flowCache[pageId];

    const currentState = await getSubscriberState(env, senderId);
    const [responses, nextState] = reply(flow, messageText, currentState, isFirstTime);
    await setSubscriberState(env, senderId, nextState);

    for (const outgoing of responses) {
      try {
        const pageToken = await getPageToken(env, pageId);
        const result = await sendMessenger(env, senderId, outgoing, pageToken);
        await recordEvent(env, senderId, "outbound", outgoing.text || outgoing.url || "", result);
      } catch (error) {
        await recordEvent(env, senderId, "outbound_error", outgoing.text || outgoing.url || "", {
          error: error.message,
          outgoing,
        });
      }
    }
  }

  return json({ status: "ok" });
}

async function getFlow(env, pageId) {
  if (pageId) {
    const row = await env.DB.prepare("select value from app_kv where key = ?").bind(`flow_${pageId}`).first();
    if (row) return JSON.parse(row.value);
  }
  // Fallback to global flow if page-specific flow is not found
  const fallbackRow = await env.DB.prepare("select value from app_kv where key = ?").bind("flow").first();
  return fallbackRow ? JSON.parse(fallbackRow.value) : DEFAULT_FLOW;
}

async function saveFlow(request, url, env) {
  const pageId = url.searchParams.get("page_id");
  if (!pageId) return json({ error: "page_id is required" }, 400);

  const flow = await request.json();
  validateFlow(flow);
  await env.DB.prepare(
    "insert into app_kv (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(`flow_${pageId}`, JSON.stringify(flow), now())
    .run();
  return json(flow);
}

function validateFlow(flow) {
  if (!flow || typeof flow !== "object" || !flow.nodes || typeof flow.nodes !== "object") throw new Error("Flow must contain nodes");
  for (const key of ["start", "fallback"]) {
    if (!flow.nodes[flow[key]]) throw new Error(`Flow ${key} must point to an existing node`);
  }
  if (flow.first_time && !flow.nodes[flow.first_time]) throw new Error("Flow first_time must point to an existing node");
}

function reply(flow, incomingText, currentState, isFirstTime) {
  const nodes = flow.nodes || {};
  const normalized = String(incomingText || "").trim().toLowerCase();
  const matchedKey = isFirstTime ? flow.first_time || flow.start : matchNode(nodes, normalized, currentState);
  const node = nodes[matchedKey] || nodes[flow.fallback];
  let nextState = node.next || matchedKey;
  if (!nodes[nextState]) nextState = flow.start;
  return [nodeToMessages(node), nextState];
}

function matchNode(nodes, text, currentState) {
  for (const [key, node] of Object.entries(nodes)) {
    const keywords = (node.keywords || []).map((item) => String(item).toLowerCase());
    const payloads = (node.quick_replies || []).map((item) => String(item.payload || "").toLowerCase());
    if (keywords.includes(text) || payloads.includes(text)) return key;
  }

  const current = nodes[currentState];
  if (current) {
    for (const item of current.quick_replies || []) {
      if (text === String(item.payload || "").toLowerCase() || text === String(item.title || "").toLowerCase()) {
        return item.next || currentState;
      }
    }
  }
  return "fallback";
}

function nodeToMessages(node) {
  const blocks = node.blocks?.length ? node.blocks : [{ type: "text", text: node.message || "" }];
  const outgoing = [];

  for (const block of blocks) {
    if (block.type === "image" && block.url) outgoing.push({ type: "image", url: block.url });
    else if (block.text) outgoing.push({ type: "text", text: block.text });
  }

  if (!outgoing.length) outgoing.push({ type: "text", text: node.message || "" });

  if (node.quick_replies?.length) {
    let target = [...outgoing].reverse().find((item) => item.type === "text");
    if (!target) {
      outgoing.push({ type: "text", text: "เลือกตัวเลือกด้านล่างได้เลยครับ" });
      target = outgoing[outgoing.length - 1];
    }
    target.quick_replies = node.quick_replies.map((item) => ({
      content_type: "text",
      title: item.title,
      payload: item.payload,
    }));
  }
  return outgoing;
}

async function sendMessenger(env, psid, outgoing, overrideToken) {
  const accessToken = overrideToken || env.PAGE_ACCESS_TOKEN;
  if (!accessToken) throw new Error("Missing Page Access Token");

  const message =
    outgoing.type === "image"
      ? { attachment: { type: "image", payload: { url: outgoing.url, is_reusable: true } } }
      : { text: outgoing.text || "" };
  if (outgoing.quick_replies) message.quick_replies = outgoing.quick_replies;

  const graphVersion = env.GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/me/messages?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: psid }, message }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Messenger API failed: ${response.status}`);
  return data;
}

async function listSubscribers(env) {
  const rows = await env.DB.prepare("select psid, state, first_seen_at, last_seen_at from subscribers order by last_seen_at desc limit 200").all();
  return json({ subscribers: rows.results || [] });
}

async function listEvents(env) {
  const rows = await env.DB.prepare("select id, psid, direction, message, payload, created_at from events order by id desc limit 100").all();
  return json({ events: (rows.results || []).map(parsePayloadRow) });
}

async function listWebhookRequests(env) {
  const rows = await env.DB.prepare("select id, method, path, query, headers, body, created_at from webhook_requests order by id desc limit 100").all();
  return json({ requests: (rows.results || []).map(parsePayloadRow) });
}

async function listConnectedPages(env) {
  const rows = await env.DB.prepare("select page_id, name, tasks, created_at, updated_at from connected_pages order by updated_at desc").all();
  return json({ pages: (rows.results || []).map(parsePayloadRow) });
}

async function pageConversations(url, env) {
  const page = await getConnectedPage(env, url.searchParams.get("page_id"));
  if (!page) return json({ error: "No connected page" }, 404);

  const graphVersion = env.GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
  const params = new URLSearchParams({
    fields: "id,updated_time,participants,snippet",
    limit: url.searchParams.get("limit") || "10",
    access_token: page.access_token,
  });
  const data = await graphJson(`https://graph.facebook.com/${graphVersion}/${page.page_id}/conversations?${params}`);
  const conversations = (data.data || []).map((item) => {
    const participants = item.participants?.data || [];
    const customer = participants.find((p) => String(p.id) !== String(page.page_id));
    return {
      id: item.id,
      updated_time: item.updated_time,
      snippet: item.snippet || "",
      customer: { id: customer?.id || "", name: customer?.name || "Unknown" },
    };
  });
  return json({ page: { page_id: page.page_id, name: page.name }, conversations });
}

async function testSend(request, env) {
  const payload = await request.json();
  const psid = String(payload.psid || "").trim();
  const message = String(payload.message || "").trim();
  const page = await getConnectedPage(env, String(payload.page_id || "").trim() || null);
  if (!page) return json({ error: "No connected page" }, 404);
  if (!psid || !message) return json({ error: "psid and message are required" }, 400);

  const result = await sendMessenger(env, psid, { type: "text", text: message }, page.access_token);
  await recordEvent(env, psid, "test_send", message, result);
  return json({ status: "ok", result });
}

async function broadcast(request, env) {
  const payload = await request.json();
  const message = String(payload.message || "").trim();
  if (!message) return json({ error: "message is required" }, 400);

  const rows = await env.DB.prepare("select psid from subscribers order by last_seen_at desc limit 500").all();
  let sent = 0;
  for (const subscriber of rows.results || []) {
    const result = await sendMessenger(env, subscriber.psid, { type: "text", text: message });
    await recordEvent(env, subscriber.psid, "broadcast", message, result);
    sent += 1;
  }
  return json({ status: "ok", sent });
}

async function uploadAsset(request, env) {
  if (!env.UPLOADS) return json({ error: "R2 binding UPLOADS is not configured" }, 500);

  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "file is required" }, 400);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-90) || "upload.bin";
  const key = `${crypto.randomUUID()}-${safeName}`;
  await env.UPLOADS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  const baseUrl = env.PUBLIC_BASE_URL || new URL(request.url).origin;
  return json({ url: `${baseUrl.replace(/\/$/, "")}/uploads/${key}`, key });
}

async function serveUpload(url, env) {
  if (!env.UPLOADS) return text("R2 binding UPLOADS is not configured", 500);
  const key = decodeURIComponent(url.pathname.replace("/uploads/", ""));
  const object = await env.UPLOADS.get(key);
  if (!object) return text("Not found", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

async function connectFacebookPage(env) {
  const rows = await env.DB.prepare("select page_id, name from connected_pages order by updated_at desc").all();
  const items = (rows.results || [])
    .map((page) => `<li><strong>${escapeHtml(page.name)}</strong><br><span>${escapeHtml(page.page_id)}</span></li>`)
    .join("");
  const missing = ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "PUBLIC_BASE_URL"].filter((key) => !env[key]);
  return html(`<!doctype html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Facebook Page</title><link rel="stylesheet" href="/static/styles.css"></head>
<body><main class="connect-page"><section class="connect-card">
<h1>Connect Facebook Page</h1>
<p>ให้เจ้าของเพจกดเชื่อมต่อ เพื่ออนุญาตให้ระบบรับและตอบข้อความผ่าน Messenger</p>
${missing.length ? `<p class="warning">ต้องตั้งค่า Worker ก่อน: ${missing.join(", ")}</p>` : ""}
<a class="primary-link" href="/auth/facebook/start">Connect Facebook</a>
<h2>Connected Pages</h2><ul class="connected-list">${items || "<li>ยังไม่มีเพจที่เชื่อมต่อ</li>"}</ul>
</section></main></body></html>`);
}

async function facebookStart(env) {
  requireEnv(env, ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "PUBLIC_BASE_URL"]);
  const state = crypto.randomUUID();
  await env.DB.prepare("insert into oauth_states (state, created_at) values (?, ?)").bind(state, now()).run();
  const params = new URLSearchParams({
    client_id: env.FACEBOOK_APP_ID,
    redirect_uri: oauthRedirectUri(env),
    state,
    response_type: "code",
    scope: "pages_show_list,pages_manage_metadata,pages_messaging,pages_read_engagement",
  });
  return Response.redirect(`https://www.facebook.com/${env.GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION}/dialog/oauth?${params}`, 302);
}

async function facebookCallback(url, env) {
  const error = url.searchParams.get("error_message") || url.searchParams.get("error");
  if (error) return text(`Facebook authorization failed: ${error}`, 400);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return text("Invalid OAuth callback: missing code or state", 400);
  if (!(await consumeOauthState(env, state))) return text("Invalid OAuth callback: state was not found or was already used", 400);

  const graphVersion = env.GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
  const tokenParams = new URLSearchParams({
    client_id: env.FACEBOOK_APP_ID,
    client_secret: env.FACEBOOK_APP_SECRET,
    redirect_uri: oauthRedirectUri(env),
    code,
  });
  const tokenData = await graphJson(`https://graph.facebook.com/${graphVersion}/oauth/access_token?${tokenParams}`);
  const pages = await graphJson(
    `https://graph.facebook.com/${graphVersion}/me/accounts?fields=id,name,access_token,tasks&access_token=${encodeURIComponent(tokenData.access_token)}`,
  );

  const connected = [];
  for (const page of pages.data || []) {
    if (!page.id || !page.access_token) continue;
    await saveConnectedPage(env, page);
    const subscribeResult = await subscribePage(env, page.id, page.access_token);
    connected.push({ ...page, subscribeResult });
  }

  const items = connected
    .map((page) => `<li><strong>${escapeHtml(page.name || "Untitled Page")}</strong><br><span>${escapeHtml(page.id)}</span></li>`)
    .join("");
  return html(`<!doctype html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Facebook Connected</title><link rel="stylesheet" href="/static/styles.css"></head>
<body><main class="connect-page"><section class="connect-card">
<h1>เชื่อมต่อสำเร็จ</h1>
<p>ระบบบันทึก Page Access Token และ subscribe webhook fields ให้แล้ว</p>
<ul class="connected-list">${items || "<li>ไม่พบเพจที่มีสิทธิ์เชื่อมต่อ</li>"}</ul>
<a class="primary-link" href="/">กลับหน้า Admin</a>
</section></main></body></html>`);
}

async function saveConnectedPage(env, page) {
  await env.DB.prepare(
    `insert into connected_pages (page_id, name, access_token, tasks, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict(page_id) do update set name = excluded.name, access_token = excluded.access_token, tasks = excluded.tasks, updated_at = excluded.updated_at`,
  )
    .bind(String(page.id), page.name || "Untitled Page", page.access_token, JSON.stringify(page.tasks || []), now(), now())
    .run();
}

async function subscribePage(env, pageId, pageToken) {
  const graphVersion = env.GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
  const params = new URLSearchParams({
    subscribed_fields: "messages,messaging_postbacks,message_echoes,standby,messaging_handovers",
    access_token: pageToken,
  });
  return graphJson(`https://graph.facebook.com/${graphVersion}/${pageId}/subscribed_apps`, {
    method: "POST",
    body: params,
  });
}

async function consumeOauthState(env, state) {
  const row = await env.DB.prepare("select state from oauth_states where state = ?").bind(state).first();
  if (!row) return false;
  await env.DB.prepare("delete from oauth_states where state = ?").bind(state).run();
  return true;
}

async function getConnectedPage(env, pageId) {
  if (pageId) return env.DB.prepare("select * from connected_pages where page_id = ?").bind(pageId).first();
  return env.DB.prepare("select * from connected_pages order by updated_at desc limit 1").first();
}

async function getPageToken(env, pageId) {
  const page = await getConnectedPage(env, pageId);
  return page?.access_token || env.PAGE_ACCESS_TOKEN || "";
}

async function upsertSubscriber(env, psid) {
  const existing = await env.DB.prepare("select psid from subscribers where psid = ?").bind(psid).first();
  if (existing) {
    await env.DB.prepare("update subscribers set last_seen_at = ? where psid = ?").bind(now(), psid).run();
    return false;
  }
  await env.DB.prepare("insert into subscribers (psid, state, first_seen_at, last_seen_at) values (?, ?, ?, ?)")
    .bind(psid, "start", now(), now())
    .run();
  return true;
}

async function getSubscriberState(env, psid) {
  const row = await env.DB.prepare("select state from subscribers where psid = ?").bind(psid).first();
  return row?.state || "start";
}

async function setSubscriberState(env, psid, state) {
  await env.DB.prepare("update subscribers set state = ?, last_seen_at = ? where psid = ?").bind(state, now(), psid).run();
}

async function recordEvent(env, psid, direction, message, payload) {
  await env.DB.prepare("insert into events (psid, direction, message, payload, created_at) values (?, ?, ?, ?, ?)")
    .bind(psid, direction, message || "", JSON.stringify(payload || {}), now())
    .run();
}

async function recordWebhookRequest(env, request, body) {
  const url = new URL(request.url);
  await env.DB.prepare("insert into webhook_requests (method, path, query, headers, body, created_at) values (?, ?, ?, ?, ?, ?)")
    .bind(request.method, url.pathname, url.search.slice(1), JSON.stringify(Object.fromEntries(request.headers)), body || "", now())
    .run();
}

function extractMessagingEvents(payload) {
  const events = [];
  for (const entry of payload.entry || []) events.push(...(entry.messaging || []), ...(entry.standby || []));
  return events;
}

function eventTypes(payload) {
  const names = [];
  for (const entry of payload.entry || []) {
    for (const key of ["messaging", "standby", "messaging_handovers"]) {
      if (entry[key]) names.push(key);
    }
  }
  return names;
}

async function graphJson(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Graph API failed: ${response.status}`);
  return data;
}

function parsePayloadRow(row) {
  const parsed = { ...row };
  for (const key of ["payload", "headers", "tasks"]) {
    if (typeof parsed[key] === "string") {
      try {
        parsed[key] = JSON.parse(parsed[key]);
      } catch {
        parsed[key] = key === "tasks" ? [] : parsed[key];
      }
    }
  }
  return parsed;
}

function oauthRedirectUri(env) {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/auth/facebook/callback`;
}

function requireEnv(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing Worker vars/secrets: ${missing.join(", ")}`);
}

function now() {
  return new Date().toISOString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function text(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
