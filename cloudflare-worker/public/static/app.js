const views = {
  flow: {
    title: "Flow Builder",
    subtitle: "จัดการข้อความตอบกลับและเงื่อนไขของบอท",
    element: document.querySelector("#flowView"),
  },
  subscribers: {
    title: "Subscribers",
    subtitle: "รายชื่อ PSID ที่เคยทักเข้ามา",
    element: document.querySelector("#subscribersView"),
  },
  testChat: {
    title: "Test Chat",
    subtitle: "อ่านแชทจากเพจและส่งข้อความทดสอบกลับไปยัง PSID ที่เลือก",
    element: document.querySelector("#testChatView"),
  },
  broadcast: {
    title: "Broadcast",
    subtitle: "ส่งข้อความหาผู้ติดตามทั้งหมดที่เก็บไว้",
    element: document.querySelector("#broadcastView"),
  },
  events: {
    title: "Events",
    subtitle: "ประวัติข้อความเข้า ออก และ webhook",
    element: document.querySelector("#eventsView"),
  },
  media: {
    title: "Media Library",
    subtitle: "จัดการรูปภาพที่อัปโหลดไว้ในระบบ",
    element: document.querySelector("#mediaView"),
  },
};

let currentView = "flow";
let currentFlow = null;
let currentPageId = null;
let selectedNodeId = "";

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    currentView = button.dataset.view;
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    for (const view of Object.values(views)) view.element.classList.remove("active");
    views[currentView].element.classList.add("active");
    document.querySelector("#pageTitle").textContent = views[currentView].title;
    document.querySelector("#pageSubtitle").textContent = views[currentView].subtitle;
    loadCurrentView();
  });
});

document.querySelector("#refreshBtn").addEventListener("click", () => {
  loadConnectedPages();
  loadCurrentView();
});
document.querySelector("#saveFlowBtn").addEventListener("click", saveJsonFlow);
document.querySelector("#saveVisualFlowBtn").addEventListener("click", saveVisualFlow);
document.querySelector("#addNodeBtn").addEventListener("click", addNode);
document.querySelector("#deleteNodeBtn").addEventListener("click", deleteSelectedNode);
document.querySelector("#addQuickReplyBtn").addEventListener("click", addQuickReplyRow);
document.querySelector("#addTextBlockBtn").addEventListener("click", () => addMessageBlock({ type: "text", text: "" }));
document.querySelector("#addImageBlockBtn").addEventListener("click", () => addMessageBlock({ type: "image", url: "" }));
document.querySelector("#broadcastBtn").addEventListener("click", sendBroadcast);
document.querySelector("#loadConversationsBtn").addEventListener("click", loadConversations);
document.querySelector("#sendTestMessageBtn").addEventListener("click", sendTestMessage);
document.querySelector("#firstTimeSelect").addEventListener("change", (event) => {
  currentFlow.first_time = event.target.value;
  syncJsonEditor();
  renderFlowchart();
});
document.querySelector("#startNodeSelect").addEventListener("change", (event) => {
  currentFlow.start = event.target.value;
  syncJsonEditor();
  renderFlowchart();
});
document.querySelector("#pageSelect").addEventListener("change", (event) => {
  currentPageId = event.target.value;
  loadCurrentView();
});

async function loadCurrentView() {
  if (currentView === "flow") await loadFlow();
  if (currentView === "testChat") await loadConversations();
  if (currentView === "subscribers") await loadSubscribers();
  if (currentView === "events") await loadEvents();
  if (currentView === "media") await loadMediaLibrary();
}

async function loadConnectedPages() {
  try {
    const data = await getJson("/api/connected-pages");
    const select = document.querySelector("#pageSelect");
    select.innerHTML = "";
    if (data.pages && data.pages.length > 0) {
      data.pages.forEach(page => {
        const option = document.createElement("option");
        option.value = page.page_id;
        option.textContent = page.name;
        select.appendChild(option);
      });
      if (!currentPageId || !data.pages.find(p => p.page_id === currentPageId)) {
        currentPageId = data.pages[0].page_id;
      }
      select.value = currentPageId;
      const page = data.pages.find(p => p.page_id === currentPageId);
      document.querySelector("#connectedPageMeta").textContent = page ? `Page ID ${page.page_id}` : "";
    } else {
      select.innerHTML = `<option value="">ยังไม่มีเพจที่เชื่อมต่อ</option>`;
      document.querySelector("#connectedPageMeta").textContent = "";
      currentPageId = null;
    }
  } catch (error) {
    document.querySelector("#connectedPageMeta").textContent = "โหลดข้อมูลเพจไม่สำเร็จ: " + error.message;
  }
}

async function loadFlow() {
  if (!currentPageId) return;
  currentFlow = await getJson(`/api/flows?page_id=${currentPageId}`);
  if (!selectedNodeId || !currentFlow.nodes[selectedNodeId]) selectedNodeId = currentFlow.start;
  syncJsonEditor();
  renderEntrySettings();
  renderNodes();
  renderFlowchart();
  renderNodeEditor();
  setText("#flowStatus", "Loaded", "ok");
}

function syncJsonEditor() {
  document.querySelector("#flowEditor").value = JSON.stringify(currentFlow, null, 2);
}

function renderNodes() {
  const container = document.querySelector("#nodeList");
  container.innerHTML = "";
  Object.entries(currentFlow.nodes || {}).forEach(([key, node]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `node-card node-button ${key === selectedNodeId ? "selected" : ""}`;
    const keywords = [...(node.keywords || []), ...(node.quick_replies || []).map((item) => item.title)];
    button.innerHTML = `
      <span class="node-title">${escapeHtml(key)}</span>
      <span class="node-preview">${escapeHtml(nodePreview(node))}</span>
      <span class="chips">${keywords.slice(0, 4).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</span>
    `;
    button.addEventListener("click", () => {
      saveEditorToMemory();
      selectedNodeId = key;
      renderNodes();
      renderNodeEditor();
    });
    container.appendChild(button);
  });
}

function renderEntrySettings() {
  document.querySelector("#firstTimeSelect").innerHTML = nodeOptions(currentFlow.first_time || currentFlow.start);
  document.querySelector("#startNodeSelect").innerHTML = nodeOptions(currentFlow.start);
}

function renderFlowchart() {
  const canvas = document.querySelector("#flowchartCanvas");
  const entries = Object.entries(currentFlow.nodes || {});
  const nodeWidth = 170;
  const nodeHeight = 86;
  const top = 96;
  const positions = {};

  // 1. Build adjacency list and calculate in-degrees
  const inDegree = {};
  const adjList = {};
  entries.forEach(([key]) => {
    inDegree[key] = 0;
    adjList[key] = new Set();
  });

  entries.forEach(([key, node]) => {
    const targets = new Set();
    if (node.next && currentFlow.nodes[node.next] && node.next !== key) targets.add(node.next);
    (node.quick_replies || []).forEach((reply) => {
      if (reply.next && currentFlow.nodes[reply.next] && reply.next !== key) targets.add(reply.next);
    });
    if (node.auto_next && currentFlow.nodes[node.auto_next]) targets.add(node.auto_next);
    targets.forEach(target => {
      adjList[key].add(target);
      inDegree[target] = (inDegree[target] || 0) + 1;
    });
  });

  // 2. Assign layers using BFS
  const layerAssignment = {};
  let queue = [];
  const roots = new Set();
  
  if (currentFlow.first_time && inDegree[currentFlow.first_time] !== undefined) roots.add(currentFlow.first_time);
  if (currentFlow.start && inDegree[currentFlow.start] !== undefined) roots.add(currentFlow.start);
  entries.forEach(([key]) => {
    if (inDegree[key] === 0) roots.add(key);
  });

  roots.forEach(root => {
    queue.push(root);
    layerAssignment[root] = 0;
  });

  while (queue.length > 0) {
    const current = queue.shift();
    const currentLayer = layerAssignment[current];
    
    adjList[current].forEach(neighbor => {
      if (layerAssignment[neighbor] === undefined || layerAssignment[neighbor] < currentLayer + 1) {
         const newLayer = currentLayer + 1;
         if (newLayer < entries.length) {
             layerAssignment[neighbor] = newLayer;
             queue.push(neighbor);
         }
      }
    });
  }

  entries.forEach(([key]) => {
    if (layerAssignment[key] === undefined) layerAssignment[key] = 0;
  });

  const layers = [];
  entries.forEach(([key]) => {
    const l = layerAssignment[key];
    if (!layers[l]) layers[l] = [];
    layers[l].push(key);
  });

  // 3. Assign X, Y positions based on layers
  const gapX = 70;
  const gapY = 40;
  const startX = 42;
  let maxColHeight = 0;

  layers.forEach((layerNodes, l) => {
    if (!layerNodes) return;
    layerNodes.forEach((key, index) => {
      positions[key] = {
        x: startX + l * (nodeWidth + gapX),
        y: top + index * (nodeHeight + gapY)
      };
      if (index > maxColHeight) maxColHeight = index;
    });
  });

  const width = Math.max(760, layers.length * (nodeWidth + gapX) + 80);
  const height = Math.max(310, top + (maxColHeight + 1) * (nodeHeight + gapY) + 40);

  const edgeData = [];
  entries.forEach(([key, node]) => {
    const from = positions[key];
    if (!from) return;

    const addEdge = (target, isAuto = false, delayText = "") => {
      const to = positions[target];
      if (to && target !== key) {
        edgeData.push({
          x1: from.x + nodeWidth, y1: from.y + nodeHeight / 2,
          x2: to.x, y2: to.y + nodeHeight / 2,
          isAuto, delayText
        });
      }
    };

    if (node.next) addEdge(node.next);
    (node.quick_replies || []).forEach((reply) => { if (reply.next) addEdge(reply.next); });
    if (node.auto_next && node.auto_delay) {
       let dText = "";
       if (node.auto_delay % 86400 === 0) dText = `⏱️ ${node.auto_delay / 86400} วัน`;
       else if (node.auto_delay % 3600 === 0) dText = `⏱️ ${node.auto_delay / 3600} ชม.`;
       else if (node.auto_delay % 60 === 0) dText = `⏱️ ${node.auto_delay / 60} นาที`;
       else dText = `⏱️ ${node.auto_delay} วิ.`;
       addEdge(node.auto_next, true, dText);
    }
  });

  const cards = entries
    .map(([key, node]) => {
      const pos = positions[key];
      const classes = [
        "flow-node",
        key === selectedNodeId ? "selected" : "",
        key === currentFlow.first_time ? "first" : "",
        key === currentFlow.start ? "start" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `
        <button class="${classes}" style="left:${pos.x}px;top:${pos.y}px;width:${nodeWidth}px;height:${nodeHeight}px" data-node="${escapeAttr(key)}">
          <span>${escapeHtml(key)}</span>
          <small>${escapeHtml(nodePreview(node))}</small>
        </button>
      `;
    })
    .join("");

  const edgeLines = edgeData.map((e) => {
    const dx = e.x2 - e.x1;
    const dy = e.y2 - e.y1;
    const midX = e.x1 + dx / 2;
    const midY = e.y1 + dy / 2;
    // Cubic bezier curve for smooth connections
    const path = `M ${e.x1} ${e.y1} C ${e.x1 + Math.max(34, Math.abs(dx)/2)} ${e.y1}, ${e.x2 - Math.max(34, Math.abs(dx)/2)} ${e.y2}, ${e.x2} ${e.y2}`;
    
    let color = "#cbd5e1";
    let marker = "url(#arrow)";
    let strokeDash = "";
    
    if (e.isAuto) {
      color = "#f59e0b";
      marker = "url(#arrow-auto)";
      strokeDash = 'stroke-dasharray="5,5"';
    }
    
    let lineStr = `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" ${strokeDash} marker-end="${marker}" />`;
    
    if (e.delayText) {
      lineStr += `
        <rect x="${midX - 35}" y="${midY - 10}" width="70" height="20" fill="white" rx="4" stroke="#f59e0b" stroke-width="1"></rect>
        <text x="${midX}" y="${midY + 3}" font-size="10" fill="#d97706" text-anchor="middle" font-family="sans-serif">${e.delayText}</text>
      `;
    }
    return lineStr;
  });

  canvas.style.minWidth = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.innerHTML = `
    <svg class="flow-lines" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="#cbd5e1"></path>
        </marker>
        <marker id="arrow-auto" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="#f59e0b"></path>
        </marker>
      </defs>
      ${edgeLines.join("")}
    </svg>
    <div class="flow-badge first-badge">First-time: ${escapeHtml(currentFlow.first_time || currentFlow.start)}</div>
    <div class="flow-badge start-badge">Returning: ${escapeHtml(currentFlow.start)}</div>
    ${cards}
  `;
  canvas.querySelectorAll(".flow-node").forEach((button) => {
    button.addEventListener("click", () => {
      saveEditorToMemory();
      selectedNodeId = button.dataset.node;
      renderNodes();
      renderFlowchart();
      renderNodeEditor();
    });
  });
}

function renderNodeEditor() {
  const node = currentFlow.nodes[selectedNodeId];
  if (!node) return;

  document.querySelector("#nodeEditorTitle").textContent = `Edit: ${selectedNodeId}`;
  document.querySelector("#nodeIdInput").value = selectedNodeId;
  document.querySelector("#nodeKeywordsInput").value = (node.keywords || []).join(", ");

  const nextSelect = document.querySelector("#nodeNextSelect");
  nextSelect.innerHTML = nodeOptions(node.next || selectedNodeId);

  const autoNextSelect = document.querySelector("#nodeAutoNextSelect");
  if (autoNextSelect) {
    autoNextSelect.innerHTML = '<option value="">-- ไม่มีการไหลอัตโนมัติ --</option>' + nodeOptions(node.auto_next || "");
    if (node.auto_delay) {
      if (node.auto_delay % 86400 === 0) {
        document.querySelector("#nodeAutoDelayValue").value = node.auto_delay / 86400;
        document.querySelector("#nodeAutoDelayUnit").value = "days";
      } else if (node.auto_delay % 3600 === 0) {
        document.querySelector("#nodeAutoDelayValue").value = node.auto_delay / 3600;
        document.querySelector("#nodeAutoDelayUnit").value = "hours";
      } else if (node.auto_delay % 60 === 0) {
        document.querySelector("#nodeAutoDelayValue").value = node.auto_delay / 60;
        document.querySelector("#nodeAutoDelayUnit").value = "minutes";
      } else {
        document.querySelector("#nodeAutoDelayValue").value = node.auto_delay;
        document.querySelector("#nodeAutoDelayUnit").value = "seconds";
      }
    } else {
      document.querySelector("#nodeAutoDelayValue").value = "";
      document.querySelector("#nodeAutoDelayUnit").value = "minutes";
    }
  }

  const rows = document.querySelector("#quickReplyRows");
  rows.innerHTML = "";
  (node.quick_replies || []).forEach((reply) => addQuickReplyRow(reply));

  const blocks = document.querySelector("#messageBlocks");
  blocks.innerHTML = "";
  normalizeBlocks(node).forEach((block) => addMessageBlock(block));
  syncJsonEditor();
}

function normalizeBlocks(node) {
  if (Array.isArray(node.blocks) && node.blocks.length) return node.blocks;
  return [{ type: "text", text: node.message || "" }];
}

function nodePreview(node) {
  const firstText = normalizeBlocks(node).find((block) => block.type === "text" && block.text);
  const firstImage = normalizeBlocks(node).find((block) => block.type === "image" && block.url);
  if (firstText) return firstText.text;
  if (firstImage) return `Image: ${firstImage.url}`;
  return "";
}

function addMessageBlock(block = { type: "text", text: "" }) {
  const row = document.createElement("div");
  row.className = "message-block";
  const type = block.type === "image" ? "image" : "text";
  row.dataset.type = type;
  
  if (type === "image") {
    row.innerHTML = `
      <div class="block-type">Image</div>
      <div style="display:flex; gap:8px; width:100%;">
         <input class="block-value" type="url" placeholder="https://example.com/image.jpg" value="${escapeAttr(block.url || "")}" style="flex:1;" />
         <button type="button" class="secondary-button upload-btn" style="padding: 0 10px;">Upload</button>
         <button type="button" class="secondary-button gallery-btn" style="padding: 0 10px;">Gallery</button>
         <input type="file" accept="image/*" style="display:none;" class="file-input" />
      </div>
      <button type="button" class="icon-danger" title="Remove">×</button>
    `;
    
    const uploadBtn = row.querySelector(".upload-btn");
    const galleryBtn = row.querySelector(".gallery-btn");
    const fileInput = row.querySelector(".file-input");
    const urlInput = row.querySelector(".block-value");
    
    uploadBtn.addEventListener("click", () => fileInput.click());
    galleryBtn.addEventListener("click", async () => {
      window.currentImageInput = urlInput;
      document.getElementById('galleryModal').style.display = 'flex';
      const grid = document.querySelector("#galleryGrid");
      grid.innerHTML = '<p class="meta-text">Loading...</p>';
      try {
        const data = await getJson("/api/uploads");
        renderMediaGrid(data.assets, grid, true);
      } catch (error) {
        grid.innerHTML = `<p class="status-text error">${escapeHtml(error.message)}</p>`;
      }
    });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      uploadBtn.textContent = "Uploading...";
      uploadBtn.disabled = true;
      const formData = new FormData();
      formData.append("file", file);
      try {
        const response = await fetch("/api/uploads", { method: "POST", body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Upload failed");
        urlInput.value = data.url;
        saveEditorToMemory();
        syncJsonEditor();
      } catch (error) {
        alert("Upload error: " + error.message);
      } finally {
        uploadBtn.textContent = "Upload";
        uploadBtn.disabled = false;
      }
    });
  } else {
    row.innerHTML = `
      <div class="block-type">Text</div>
      <textarea class="block-value message-box" rows="5" placeholder="พิมพ์ข้อความตอบกลับ">${escapeHtml(block.text || "")}</textarea>
      <button type="button" class="icon-danger" title="Remove">×</button>
    `;
  }
  
  row.querySelector(".icon-danger").addEventListener("click", () => row.remove());
  document.querySelector("#messageBlocks").appendChild(row);
}

function nodeOptions(selected) {
  return Object.keys(currentFlow.nodes)
    .map((key) => `<option value="${escapeHtml(key)}" ${key === selected ? "selected" : ""}>${escapeHtml(key)}</option>`)
    .join("");
}

function addQuickReplyRow(reply = {}) {
  const row = document.createElement("div");
  row.className = "reply-row";
  row.innerHTML = `
    <input class="reply-title" type="text" placeholder="Button text" value="${escapeAttr(reply.title || "")}" />
    <input class="reply-payload" type="text" placeholder="Payload" value="${escapeAttr(reply.payload || "")}" />
    <select class="reply-next">${nodeOptions(reply.next || selectedNodeId)}</select>
    <button type="button" class="icon-danger" title="Remove">×</button>
  `;
  row.querySelector(".icon-danger").addEventListener("click", () => row.remove());
  document.querySelector("#quickReplyRows").appendChild(row);
}

function saveEditorToMemory() {
  if (!currentFlow || !selectedNodeId || !currentFlow.nodes[selectedNodeId]) return;
  const node = currentFlow.nodes[selectedNodeId];
  node.next = document.querySelector("#nodeNextSelect").value;
  node.keywords = splitKeywords(document.querySelector("#nodeKeywordsInput").value);

  const autoNext = document.querySelector("#nodeAutoNextSelect")?.value;
  const delayValue = parseInt(document.querySelector("#nodeAutoDelayValue")?.value) || 0;
  const delayUnit = document.querySelector("#nodeAutoDelayUnit")?.value;
  if (autoNext && delayValue > 0) {
    node.auto_next = autoNext;
    let seconds = delayValue;
    if (delayUnit === "minutes") seconds = delayValue * 60;
    if (delayUnit === "hours") seconds = delayValue * 3600;
    if (delayUnit === "days") seconds = delayValue * 86400;
    node.auto_delay = seconds;
  } else {
    delete node.auto_next;
    delete node.auto_delay;
  }

  const blocks = [];
  document.querySelectorAll(".message-block").forEach((row) => {
    const type = row.dataset.type;
    const value = row.querySelector(".block-value").value.trim();
    if (!value) return;
    if (type === "image") blocks.push({ type: "image", url: value });
    else blocks.push({ type: "text", text: value });
  });
  node.blocks = blocks.length ? blocks : [{ type: "text", text: "" }];
  node.message = blocks.find((block) => block.type === "text")?.text || "";

  const replies = [];
  document.querySelectorAll(".reply-row").forEach((row) => {
    const title = row.querySelector(".reply-title").value.trim();
    const payload = row.querySelector(".reply-payload").value.trim();
    const next = row.querySelector(".reply-next").value;
    if (title || payload) replies.push({ title, payload: payload || title, next });
  });
  if (replies.length) node.quick_replies = replies;
  else delete node.quick_replies;
}

async function saveVisualFlow() {
  if (!currentPageId) {
    setText("#flowStatus", "Please select a page first", "error");
    return;
  }
  try {
    saveEditorToMemory();
    const saved = await requestJson(`/api/flows?page_id=${currentPageId}`, "PUT", currentFlow);
    currentFlow = saved;
    syncJsonEditor();
    renderNodes();
    renderEntrySettings();
    renderFlowchart();
    setText("#flowStatus", "Saved", "ok");
  } catch (error) {
    setText("#flowStatus", error.message, "error");
  }
}

async function saveJsonFlow() {
  if (!currentPageId) {
    setText("#flowStatus", "Please select a page first", "error");
    return;
  }
  try {
    currentFlow = JSON.parse(document.querySelector("#flowEditor").value);
    const saved = await requestJson(`/api/flows?page_id=${currentPageId}`, "PUT", currentFlow);
    currentFlow = saved;
    if (!currentFlow.nodes[selectedNodeId]) selectedNodeId = currentFlow.start;
    renderNodes();
    renderEntrySettings();
    renderFlowchart();
    renderNodeEditor();
    setText("#flowStatus", "Saved JSON", "ok");
  } catch (error) {
    setText("#flowStatus", error.message, "error");
  }
}

function addNode() {
  const key = prompt("Node ID เช่น followup หรือ product_detail");
  if (!key) return;
  const cleanKey = key.trim().replace(/\s+/g, "_");
  if (!cleanKey || currentFlow.nodes[cleanKey]) {
    setText("#flowStatus", "Node ID นี้ใช้ไม่ได้หรือมีอยู่แล้ว", "error");
    return;
  }
  saveEditorToMemory();
  currentFlow.nodes[cleanKey] = {
    message: "พิมพ์ข้อความตอบกลับที่นี่",
    blocks: [{ type: "text", text: "พิมพ์ข้อความตอบกลับที่นี่" }],
    keywords: [],
    next: cleanKey,
  };

  // Auto-link from the currently selected node to make it easier for users
  if (selectedNodeId && currentFlow.nodes[selectedNodeId]) {
    if (currentFlow.nodes[selectedNodeId].next === selectedNodeId) {
      currentFlow.nodes[selectedNodeId].next = cleanKey;
    }
  }

  selectedNodeId = cleanKey;
  renderNodes();
  renderEntrySettings();
  renderFlowchart();
  renderNodeEditor();
}

function deleteSelectedNode() {
  if (!selectedNodeId || selectedNodeId === currentFlow.start || selectedNodeId === currentFlow.fallback) {
    setText("#flowStatus", "ลบ start หรือ fallback ไม่ได้", "error");
    return;
  }
  if (!confirm(`Delete node "${selectedNodeId}"?`)) return;
  delete currentFlow.nodes[selectedNodeId];
  for (const node of Object.values(currentFlow.nodes)) {
    if (node.next === selectedNodeId) node.next = currentFlow.fallback;
    (node.quick_replies || []).forEach((reply) => {
      if (reply.next === selectedNodeId) reply.next = currentFlow.fallback;
    });
  }
  selectedNodeId = currentFlow.start;
  renderNodes();
  renderEntrySettings();
  renderFlowchart();
  renderNodeEditor();
}

function splitKeywords(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadSubscribers() {
  if (!currentPageId) return;
  const data = await getJson(`/api/subscribers?page_id=${currentPageId}`);
  const rows = document.querySelector("#subscriberRows");
  rows.innerHTML = "";
  document.querySelector("#subscriberCount").textContent = `${data.subscribers.length} people`;
  data.subscribers.forEach((subscriber) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(subscriber.psid)}</td>
      <td>${escapeHtml(subscriber.state)}</td>
      <td>${escapeHtml(subscriber.first_seen_at)}</td>
      <td>${escapeHtml(subscriber.last_seen_at)}</td>
    `;
    rows.appendChild(row);
  });
}

async function loadConversations() {
  const list = document.querySelector("#conversationList");
  list.innerHTML = `<p class="meta-text">Loading conversations...</p>`;
  if (!currentPageId) {
    list.innerHTML = `<p class="meta-text">กรุณาเลือกเพจก่อน</p>`;
    return;
  }
  try {
    const data = await getJson(`/api/page-conversations?page_id=${currentPageId}&limit=12`);
    if (!data.conversations.length) {
      list.innerHTML = `<p class="meta-text">ยังไม่พบแชทจากเพจนี้</p>`;
      return;
    }
    list.innerHTML = "";
    data.conversations.forEach((conversation) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "conversation-item";
      button.innerHTML = `
        <strong>${escapeHtml(conversation.customer.name || "Unknown")}</strong>
        <span>${escapeHtml(conversation.snippet || "")}</span>
        <small>PSID ${escapeHtml(conversation.customer.id || "-")} · ${escapeHtml(conversation.updated_time || "")}</small>
      `;
      button.addEventListener("click", () => {
        document.querySelector("#testPsidInput").value = conversation.customer.id || "";
        setText("#testChatStatus", `Selected ${conversation.customer.name}`, "ok");
      });
      list.appendChild(button);
    });
  } catch (error) {
    list.innerHTML = `<p class="status-text error">${escapeHtml(error.message)}</p>`;
  }
}

async function sendTestMessage() {
  const psid = document.querySelector("#testPsidInput").value.trim();
  const message = document.querySelector("#testMessageInput").value.trim();
  if (!psid || !message) {
    setText("#testChatStatus", "กรุณาเลือก PSID และพิมพ์ข้อความทดสอบ", "error");
    return;
  }
  const ok = confirm(`ส่งข้อความทดสอบไปยัง PSID ${psid} ใช่ไหม?`);
  if (!ok) return;
  try {
    const result = await requestJson("/api/test-send", "POST", { page_id: currentPageId, psid, message });
    setText("#testChatStatus", `Sent: ${result.status}`, "ok");
  } catch (error) {
    setText("#testChatStatus", error.message, "error");
  }
}

async function sendBroadcast() {
  const message = document.querySelector("#broadcastMessage").value.trim();
  if (!message) {
    setText("#broadcastStatus", "Message is required", "error");
    return;
  }
  try {
    const result = await requestJson("/api/broadcast", "POST", { page_id: currentPageId, message });
    setText("#broadcastStatus", `Sent to ${result.sent} subscribers`, "ok");
  } catch (error) {
    setText("#broadcastStatus", error.message, "error");
  }
}

async function loadEvents() {
  if (!currentPageId) return;
  const data = await getJson(`/api/events?page_id=${currentPageId}`);
  const list = document.querySelector("#eventList");
  list.innerHTML = "";
  data.events.forEach((event) => {
    const item = document.createElement("article");
    item.className = "event-item";
    item.innerHTML = `
      <strong>${escapeHtml(event.direction)} · ${escapeHtml(event.psid)}</strong>
      <div>${escapeHtml(event.text)}</div>
      <span>${escapeHtml(event.created_at)}</span>
    `;
    list.appendChild(item);
  });
}

async function loadMediaLibrary() {
  const grid = document.querySelector("#mediaGrid");
  if(!grid) return;
  grid.innerHTML = '<p class="meta-text">Loading...</p>';
  try {
    const data = await getJson("/api/uploads");
    renderMediaGrid(data.assets, grid, false);
  } catch (error) {
    grid.innerHTML = `<p class="status-text error">${escapeHtml(error.message)}</p>`;
  }
}

function renderMediaGrid(assets, container, isModal) {
  if (!assets || assets.length === 0) {
    container.innerHTML = '<p class="meta-text">ไม่มีรูปภาพในระบบ</p>';
    return;
  }
  container.innerHTML = "";
  assets.forEach((asset) => {
    const item = document.createElement("div");
    item.className = "media-item";
    
    const img = document.createElement("img");
    img.src = asset.url;
    img.loading = "lazy";
    
    if (isModal) {
      img.onclick = () => {
        if (window.currentImageInput) {
          window.currentImageInput.value = asset.url;
          saveEditorToMemory();
        }
        document.getElementById('galleryModal').style.display = 'none';
      };
      item.appendChild(img);
    } else {
      img.onclick = () => window.open(asset.url, '_blank');
      item.appendChild(img);
      
      const actions = document.createElement("div");
      actions.className = "media-actions";
      
      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-url-btn";
      copyBtn.textContent = "Copy URL";
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(asset.url);
        copyBtn.textContent = "Copied!";
        setTimeout(() => copyBtn.textContent = "Copy URL", 2000);
      };
      
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-media-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.onclick = async () => {
        if (!confirm("ลบรูปภาพนี้ใช่หรือไม่? (ถ้ามี Flow ไหนใช้อยู่ รูปจะหายไปนะ)")) return;
        try {
          deleteBtn.textContent = "...";
          await requestJson(`/api/uploads/${encodeURIComponent(asset.key)}`, "DELETE", {});
          await loadMediaLibrary();
        } catch(e) {
          alert("Delete failed: " + e.message);
          deleteBtn.textContent = "Delete";
        }
      };
      
      actions.appendChild(copyBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(actions);
    }
    container.appendChild(item);
  });
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function requestJson(url, method, payload) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setText(selector, text, className) {
  const element = document.querySelector(selector);
  element.textContent = text;
  element.className = `status-text ${className}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", "&#10;");
}

async function init() {
  try {
    await getJson("/api/me");
    await loadConnectedPages();
    await loadCurrentView();
    
    // Revoke Access
    document.querySelector("#btnRevokeAccess")?.addEventListener("click", async () => {
      if (!confirm("คุณต้องการ ลบสิทธิ์การเชื่อมต่อ Facebook ทั้งหมด และเริ่มใหม่ใช่ไหม?")) return;
      try {
        await requestJson("/api/auth/revoke", "POST", {});
        window.location.reload();
      } catch (error) {
        alert("Error: " + error.message);
      }
    });

    // Media Tab Upload
    document.querySelector("#btnUploadMediaTab")?.addEventListener("click", () => {
      document.querySelector("#mediaTabFileInput").click();
    });
    document.querySelector("#mediaTabFileInput")?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      const status = document.querySelector("#mediaTabStatus");
      status.textContent = "Uploading...";
      status.className = "status-text ok";
      try {
        const response = await fetch("/api/uploads", { method: "POST", body: formData });
        if (!response.ok) throw new Error("Upload failed");
        status.textContent = "Uploaded successfully!";
        await loadMediaLibrary();
      } catch (error) {
        status.textContent = error.message;
        status.className = "status-text error";
      }
      e.target.value = "";
    });

  } catch (error) {
    if (error.message.includes("Unauthorized") || error.message.includes("401")) {
      document.body.innerHTML = `
        <div style="display:flex; height:100vh; justify-content:center; align-items:center; flex-direction:column; background:#f4f4f5; font-family:sans-serif;">
          <div style="background:white; padding:48px; border-radius:16px; box-shadow:0 10px 25px rgba(0,0,0,0.05); text-align:center; max-width:400px; width:100%;">
            <div style="background:#1877F2; color:white; width:64px; height:64px; border-radius:16px; display:flex; align-items:center; justify-content:center; font-size:28px; font-weight:bold; margin:0 auto 24px;">RC</div>
            <h1 style="margin:0 0 8px; font-size:24px; color:#111;">RPA Chatflow</h1>
            <p style="color:#666; margin:0 0 32px; line-height:1.5;">ระบบจัดการแชทบอทอัตโนมัติ<br>กรุณาเข้าสู่ระบบเพื่อดำเนินการต่อ</p>
            <a href="/connect-facebook" class="primary-button" style="text-decoration:none; display:block; font-size:16px; padding:12px; background:#1877F2; width:100%; box-sizing:border-box;">Login with Facebook</a>
          </div>
        </div>
      `;
    } else {
      console.error(error);
      alert("System Error: " + error.message);
    }
  }
}

init();
