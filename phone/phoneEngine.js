/* phone/phoneEngine.js
 * 共享记忆、分离显示：main/phone 两个 channel 都参与上下文，但各自只在自己的 UI 渲染
 * 多联系人：每个 contactId 一套历史
 */
(function () {
  const LS_KEY = 'YBM_ENGINE_V1';
  const API_LS_KEY = 'YBM_API_CFG_V1';
  const PROMPT_LS_KEY = 'YBM_PROMPT_CFG_V1';
  const VERSION = 1;

  const state = load() || {
    version: VERSION,
    activeContactId: 'ybm',
    contacts: {
      ybm: { id: 'ybm', name: '岩白眉' },
    },
    // messages[contactId] = Array<Message>
    messages: {
      ybm: [],
    },
    api: {
      baseUrl: '',
      apiKey: '',
      model: '',
    }
  };

  function uid() {
    return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function nowTs() { return Date.now(); }

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function ensureContact(contactId) {
    if (!contactId) contactId = state.activeContactId || 'ybm';
    if (!state.contacts[contactId]) {
      state.contacts[contactId] = { id: contactId, name: contactId };
    }
    if (!state.messages[contactId]) state.messages[contactId] = [];
    return contactId;
  }

  function listContacts() {
    return Object.values(state.contacts);
  }

  function addContact({ id, name }) {
    if (!id) return false;
    if (state.contacts[id]) return true;
    state.contacts[id] = { id, name: name || id };
    state.messages[id] = [];
    save();
    return true;
  }

  function setActiveContact(contactId) {
    contactId = ensureContact(contactId);
    state.activeContactId = contactId;
    save();
    return contactId;
  }

  function getActiveContact() {
    return ensureContact(state.activeContactId);
  }

  function appendMessage({ contactId, channel, role, content, meta }) {
    contactId = ensureContact(contactId);
    const msg = {
      id: uid(),
      ts: nowTs(),
      contactId,
      channel,            // 'main' | 'phone'
      role,               // 'user' | 'assistant' | 'system'
      content: content || '',
      meta: meta || {},
    };
    state.messages[contactId].push(msg);
    save();
    return msg;
  }

  // ✅ 你缺的就是这个：给 UI 用的取消息接口
  // 支持两种调用方式：
  // 1) getMessages({ contactId, channel })
  // 2) getMessages(contactId, channel)
  function getMessages(arg1, arg2) {
    let contactId = null;
    let channel = null;

    if (typeof arg1 === 'object' && arg1) {
      contactId = arg1.contactId || null;
      channel = arg1.channel || null;
    } else {
      contactId = arg1 || null;
      channel = arg2 || null;
    }

    contactId = ensureContact(contactId || getActiveContact());

    const arr = (state.messages[contactId] || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));

    // channel 为空：返回全部（main + phone + system）
    if (!channel) return arr;

    // channel = 'main' / 'phone'
    return arr.filter(m => m && m.channel === channel);
  }

  // ====== mutate messages (edit/delete/clear) ======
  function updateMessage({ contactId, msgId, content } = {}) {
    if (!msgId) return false;
    contactId = ensureContact(contactId || getActiveContact());
    const arr = state.messages[contactId] || [];
    const m = arr.find(x => x && x.id === msgId);
    if (!m) return false;
    m.content = (content ?? '').toString();
    m.ts = nowTs();
    save();
    return true;
  }

  function deleteMessage({ contactId, msgId } = {}) {
    if (!msgId) return false;
    contactId = ensureContact(contactId || getActiveContact());
    const arr = state.messages[contactId] || [];
    const idx = arr.findIndex(x => x && x.id === msgId);
    if (idx < 0) return false;
    arr.splice(idx, 1);
    save();
    return true;
  }

function clearMessages({ contactId }) {
  const messages = getMessages({ contactId });
  if (messages) {
    messages.length = 0; // 清空数组
    saveMessages({ contactId, messages }); // 保存清空后的状态
  }
}

function clearAllMessages() {
  const allContacts = getContacts(); // 获取所有联系人
  allContacts.forEach(contact => {
    clearMessages({ contactId: contact.id }); // 清空每个联系人的消息
  });
}


  // ====== reroll: only last assistant in a channel ======
  async function rerollLastAssistant({ contactId, channel, maxChars } = {}) {
    channel = channel === 'phone' ? 'phone' : 'main';
    contactId = ensureContact(contactId || getActiveContact());

    const all = (state.messages[contactId] || []).slice().sort((a, b) => a.ts - b.ts);
    const inCh = all.filter(m => m.channel === channel && (m.role === 'user' || m.role === 'assistant'));
    if (!inCh.length) return null;

    // 最后一条 assistant
    let lastA = null;
    for (let i = inCh.length - 1; i >= 0; i--) {
      if (inCh[i].role === 'assistant') { lastA = inCh[i]; break; }
    }
    if (!lastA) return null;

    // lastA 之前最近一条 user（用存档最新内容，保证“编辑后 reroll 生效”）
    let lastU = null;
    for (let i = inCh.indexOf(lastA) - 1; i >= 0; i--) {
      if (inCh[i].role === 'user') { lastU = inCh[i]; break; }
    }
    if (!lastU || !lastU.content || !lastU.content.trim()) return null;

    const api = readApiFromDOM();

    const sys = buildSystemPromptFromCfg(contactId);
    const ctxAll = buildContext({
      contactId,
      systemPrompt: sys,
      maxChars: maxChars || 16000
    });

    // 截断到 lastU（避免把旧 lastA 喂回去）
    const ctx = [];
    for (const item of ctxAll) {
      ctx.push(item);
      if (item.role === 'user' && (item.content || '') === (lastU.content || '')) break;
    }

    lastA.content = '';
    save();

    try {
      const reply = await callChatCompletions({
        baseUrl: api.baseUrl,
        apiKey: api.apiKey,
        model: api.model,
        messages: ctx,
        stream: false
      });

      lastA.content = reply || '';
      lastA.ts = nowTs();
      save();
      return lastA;
    } catch (e) {
      lastA.content = `（错误）${e?.message || e}`;
      lastA.meta = { error: true };
      save();
      return lastA;
    }
  }

  // 把 main + phone 合并成给模型看的上下文（但 UI 不串）
  function buildContext({ contactId, systemPrompt, maxChars } = {}) {
    contactId = ensureContact(contactId || getActiveContact());
    const all = state.messages[contactId] || [];

    const messages = [];
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() });
    }

    const sorted = all.slice().sort((a, b) => a.ts - b.ts);
    for (const m of sorted) {
      if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') continue;
      messages.push({ role: m.role, content: m.content || '' });
    }

    if (maxChars && maxChars > 0) {
      let total = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        total += (messages[i].content || '').length;
        if (total > maxChars) return messages.slice(i + 1);
      }
    }
    return messages;
  }

  // ====== API cfg: prefer localStorage (Start 页配置) ======
  function loadApiCfg() {
    try { return JSON.parse(localStorage.getItem(API_LS_KEY) || '{}'); } catch { return {}; }
  }

  // ====== Prompt cfg: worldbook + presets ======
  function loadPromptCfg() {
    try { return JSON.parse(localStorage.getItem(PROMPT_LS_KEY) || 'null'); } catch { return null; }
  }

  function buildSystemPromptFromCfg(contactId) {
    const cfg = loadPromptCfg();
    const parts = [];

    // 用户人设
    try {
      const personaRaw = localStorage.getItem('YBM_PERSONA_V1');
      const persona = personaRaw ? JSON.parse(personaRaw) : null;
      if (persona && persona.enabled) {
        const n = (persona.name || '').trim();
        const b = (persona.bio || '').trim();
        if (n || b) {
          parts.push(
            [
              '【用户人设】',
              n ? `名字：${n}` : '',
              b ? `基础信息：\n${b}` : ''
            ].filter(Boolean).join('\n')
          );
        }
      }
    } catch { }

    // 世界书：全局
    if (cfg?.worldbook && Array.isArray(cfg.worldbook.global)) {
      cfg.worldbook.global.forEach(wb => {
        if (wb && wb.enabled && wb.content) parts.push(wb.content);
      });
    }

    // 世界书：联系人
    if (contactId && cfg?.worldbook?.contact && Array.isArray(cfg.worldbook.contact[contactId])) {
      cfg.worldbook.contact[contactId].forEach(wb => {
        if (wb && wb.enabled && wb.content) parts.push(wb.content);
      });
    }

    // 预设：全局（开关即注入）
    if (cfg?.presets && Array.isArray(cfg.presets.global)) {
      cfg.presets.global.forEach(p => {
        if (p && p.enabled && p.content) parts.push(p.content);
      });
    }

    return parts.join('\n\n');
  }

  function buildAuthHeader(baseUrl, apiKey) {
    if (!apiKey) return {};
    const key = apiKey.trim();
    if (!key) return {};
    const lower = (baseUrl || '').toLowerCase();
    if (lower.includes('tiantianai.pro')) return { Authorization: key };
    let auth = key;
    if (!/^bearer\s+/i.test(auth)) auth = `Bearer ${auth}`;
    return { Authorization: auth };
  }

  function buildChatCompletionsUrl(baseUrl) {
    let u = (baseUrl || '').trim();
    if (!u) return '';
    u = u.replace(/\s+/g, '').replace(/\/+$/, '');
    u = u.replace(/\/chat\/completions$/i, '');
    if (!/\/v1$/i.test(u)) {
      const m = u.match(/^(.*?\/v1)\b/i);
      if (m && m[1]) u = m[1];
      else u = u + '/v1';
    }
    return u.replace(/\/+$/, '') + '/chat/completions';
  }

  function readApiFromDOM() {
    const saved = loadApiCfg();
    if (saved && typeof saved === 'object') {
      if (typeof saved.baseUrl === 'string' && saved.baseUrl.trim()) state.api.baseUrl = saved.baseUrl.trim();
      if (typeof saved.apiKey === 'string' && saved.apiKey.trim()) state.api.apiKey = saved.apiKey.trim();
      if (typeof saved.model === 'string' && saved.model.trim()) state.api.model = saved.model.trim();
    }

    const byId = (id) => document.getElementById(id)?.value?.trim() || '';
    let baseUrl = byId('apiBaseUrl');
    let apiKey = byId('apiKey');
    let model = byId('apiModel');

    if (!baseUrl) {
      const el = Array.from(document.querySelectorAll('.deviceField')).find(x => x.innerText.includes('Base URL'));
      baseUrl = el?.querySelector('input')?.value?.trim() || '';
    }
    if (!apiKey) {
      const el = Array.from(document.querySelectorAll('.deviceField')).find(x => x.innerText.includes('API Key'));
      apiKey = el?.querySelector('input')?.value?.trim() || '';
    }
    if (!model) {
      const el = Array.from(document.querySelectorAll('.deviceField')).find(x => x.innerText.includes('Model'));
      model = el?.querySelector('input')?.value?.trim() || '';
    }

    if (baseUrl) state.api.baseUrl = baseUrl;
    if (apiKey) state.api.apiKey = apiKey;
    if (model) state.api.model = model;
    save();

    return { baseUrl: state.api.baseUrl, apiKey: state.api.apiKey, model: state.api.model };
  }

  function setApiConfig({ baseUrl, apiKey, model }) {
    if (typeof baseUrl === 'string') state.api.baseUrl = baseUrl.trim();
    if (typeof apiKey === 'string') state.api.apiKey = apiKey.trim();
    if (typeof model === 'string') state.api.model = model.trim();
    save();
  }

  async function callChatCompletions({ baseUrl, apiKey, model, messages, stream, signal }) {
    if (!baseUrl) throw new Error('Base URL 为空');
    if (!model) throw new Error('Model 为空');

    const url = buildChatCompletionsUrl(baseUrl);

    const headers = { 'Content-Type': 'application/json' };
    Object.assign(headers, buildAuthHeader(baseUrl, apiKey));

    const body = { model, messages, temperature: 0.8, stream: false };

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`API 错误 ${res.status}: ${t.slice(0, 200)}`);
    }

    const data = await res.json().catch(() => null);

    let text = data?.choices?.[0]?.message?.content;
    if (typeof text === 'string' && text.trim()) return text;

    text = data?.choices?.[0]?.text;
    if (typeof text === 'string' && text.trim()) return text;

    const parts = data?.candidates?.[0]?.content?.parts || data?.candidates?.[0]?.parts;
    if (Array.isArray(parts)) {
      const t = parts.map(p => (typeof p?.text === 'string' ? p.text : '')).join('\n').trim();
      if (t) return t;
    }

    throw new Error(`API 返回无法解析：${JSON.stringify(data).slice(0, 500)}`);
  }

  async function send({ text, channel, contactId, systemPrompt, maxChars } = {}) {
    if (!text || !text.trim()) return null;
    channel = channel === 'phone' ? 'phone' : 'main';
    contactId = ensureContact(contactId || getActiveContact());

    const api = readApiFromDOM();

    appendMessage({ contactId, channel, role: 'user', content: text.trim() });

    const sys = (systemPrompt && systemPrompt.trim())
      ? systemPrompt.trim()
      : buildSystemPromptFromCfg(contactId);

    const ctx = buildContext({
      contactId,
      systemPrompt: sys,
      maxChars: maxChars || 16000,
    });

    const assistantMsg = appendMessage({ contactId, channel, role: 'assistant', content: '' });

    try {
      const reply = await callChatCompletions({
        baseUrl: api.baseUrl,
        apiKey: api.apiKey,
        model: api.model,
        messages: ctx,
        stream: false
      });

      assistantMsg.content = reply || '';
      save();
      return assistantMsg;
    } catch (e) {
      assistantMsg.content = `（错误）${e?.message || e}`;
      assistantMsg.meta = { error: true };
      save();
      return assistantMsg;
    }
  }

  // ✅ 导出：这里现在不会再引用未定义的 getMessages 了
  window.PhoneEngine = {
    listContacts,
    addContact,
    setActiveContact,
    getActiveContact,

    appendMessage,
    getMessages,       // ✅ 已定义
    buildContext,

    updateMessage,
    deleteMessage,
    clearMessages,
    clearAllMessages,

    rerollLastAssistant,

    readApiFromDOM,
    setApiConfig,

    send,
  };

  window.ChatEngine = window.PhoneEngine;
})();
