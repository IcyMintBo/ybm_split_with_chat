/* phone/phoneEngine.js
 * 共享记忆、分离显示：main/phone 两个 channel 都参与上下文，但各自只在自己的 UI 渲染
 * 多联系人：每个 contactId 一套历史
 */
// ===== Debug switches =====
window.__YBM_DEBUG_PROMPT__ = window.__YBM_DEBUG_PROMPT__ ?? true;

(function () {
  const LS_KEY = 'YBM_ENGINE_V1';
  const API_LS_KEY = 'YBM_API_CFG_V1';
  const PROMPT_LS_KEY = 'YBM_PROMPT_CFG_V1';
  const VERSION = 1;

  let state = load() || {
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

  // ===== data migration: ensure assistant messages have turnId (for "last turn" ops) =====
  // 旧版本 send() 给 user 写了 turnId，但 assistant 没写 turnId，导致：
  // - mini_phone: “最后一轮”重roll/删除总是灰
  // - deleteTurn/rerollLastTurn 无法按轮工作
  function migrateMissingTurnIds() {
    try {
      let changed = false;
      const byContact = state.messages || {};

      for (const cid of Object.keys(byContact)) {
        const arr = (byContact[cid] || []).slice().sort((a, b) => (a?.ts || 0) - (b?.ts || 0));

        // 每个 channel 记住“最近一次 user 的 turnId”
        const lastUserTid = { main: '', phone: '' };

        for (const m of arr) {
          if (!m || !m.channel) continue;
          const ch = (m.channel === 'phone') ? 'phone' : 'main';

          if (m.role === 'user') {
            if (m.turnId) lastUserTid[ch] = String(m.turnId);
            continue;
          }

          if (m.role === 'assistant') {
            // ✅ 补齐缺失的 turnId：优先用 meta 里的，再用最近 user 的
            const tid = m.turnId || m.meta?.turnId || lastUserTid[ch];
            if (tid && !m.turnId) {
              m.turnId = String(tid);
              m.meta = m.meta || {};
              m.meta.turnId = String(tid);
              changed = true;
            }
          }
        }
      }

      // 只在真的修复过时落盘
      if (changed) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { }
        notifyChange('save', { source: 'migration' });
      }
    } catch {
      // ignore migration errors
    }
  }

  const listeners = new Set();
  function notifyChange(type, payload) {
    listeners.forEach((fn) => {
      try { fn(type, payload); } catch { /* ignore listener errors */ }
    });
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return () => { };
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function uid() {
    return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function nowTs() { return Date.now(); }

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    notifyChange('save', { source: 'local' });
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function reloadFromStorage() {
    const next = load();
    if (!next || typeof next !== 'object') return false;

    const base = {
      version: VERSION,
      activeContactId: 'ybm',
      contacts: {},
      messages: {},
      api: { baseUrl: '', apiKey: '', model: '' }
    };

    state = {
      ...base,
      ...next,
      contacts: { ...base.contacts, ...(next.contacts || {}) },
      messages: { ...base.messages, ...(next.messages || {}) },
      api: { ...base.api, ...(next.api || {}) }
    };

    ensureContact(state.activeContactId || 'ybm');
    migrateMissingTurnIds();
    notifyChange('reload', { source: 'storage' });
    return true;
  }

  function ensureContact(contactId) {
    if (!contactId) contactId = state.activeContactId || 'ybm';
    if (!state.contacts[contactId]) {
      state.contacts[contactId] = { id: contactId, name: contactId };
    }
    if (!state.messages[contactId]) state.messages[contactId] = [];
    return contactId;
  }

  // 初次加载后：保证 activeContact 存在，再修复 turnId
  ensureContact(state.activeContactId || 'ybm');
  migrateMissingTurnIds();

  function listContacts() {
    return Object.values(state.contacts);
  }
  function getContact(contactId) {
    contactId = ensureContact(contactId || getActiveContact());
    return state.contacts[contactId] || null;
  }


  function addContact(contact) {
    const id = contact?.id;
    if (!id) return false;
    if (state.contacts[id]) return true;

    // 允许传入 avatar/title 等扩展字段
    const name = (contact?.name || contact?.title || id);

    state.contacts[id] = {
      ...contact,
      id,
      name,
    };

    state.messages[id] = state.messages[id] || [];
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

  function newTurnId() {
    return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function newTurnId() {
    return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function appendMessage({ contactId, channel, role, content, meta, turnId } = {}) {
    contactId = ensureContact(contactId);
    const msg = {
      id: uid(),
      ts: nowTs(),
      contactId,
      channel,            // 'main' | 'phone'
      role,               // 'user' | 'assistant' | 'system'
      content: content || '',
      meta: meta || {},
      turnId: turnId || '', // ✅ 关键：存 turnId
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

  function clearMessages({ contactId, channel } = {}) {
    contactId = ensureContact(contactId || getActiveContact());

    // channel 为空：清空该联系人的全部消息（包含 main + phone）
    if (!channel) {
      state.messages[contactId] = [];
      save();
      return true;
    }

    // 指定 channel：只清掉该 channel 的消息
    const arr = state.messages[contactId] || [];
    state.messages[contactId] = arr.filter(m => m && m.channel !== channel);
    save();
    return true;
  }

  function clearAllMessages({ channel } = {}) {
    // 遍历所有联系人
    Object.keys(state.contacts || {}).forEach((cid) => {
      clearMessages({ contactId: cid, channel });
    });
    save();
    return true;
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

    const sys = buildSystemPromptFromCfg(contactId, channel);

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
  function getLastAssistantTurnId({ contactId, channel } = {}) {
    channel = channel === 'phone' ? 'phone' : 'main';
    contactId = ensureContact(contactId || getActiveContact());

    const all = (state.messages[contactId] || []).slice().sort((a, b) => a.ts - b.ts);
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i];
      if (m && m.channel === channel && m.role === 'assistant') {
        return m.turnId || m.meta?.turnId || null;
      }
    }
    return null;
  }
  function getLastAssistantTurnId({ contactId, channel } = {}) {
    channel = channel === 'phone' ? 'phone' : 'main';
    contactId = ensureContact(contactId || getActiveContact());
    const arr = (state.messages[contactId] || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i];
      if (m && m.channel === channel && m.role === 'assistant') return m.turnId || '';
    }
    return '';
  }

  function deleteTurn({ contactId, channel, turnId } = {}) {
    if (!turnId) return false;
    channel = channel === 'phone' ? 'phone' : 'main';
    contactId = ensureContact(contactId || getActiveContact());
    const arr = state.messages[contactId] || [];
    state.messages[contactId] = arr.filter(m => !(m && m.channel === channel && (m.turnId || '') === turnId));
    save();
    return true;
  }

  // ✅ 只重roll“最后一轮”的 assistant（符合你规则）
  // 逻辑：找到 turnId 对应的最后一条 user 作为触发，清空该轮 assistant 内容 -> 重新请求 -> 写回同一条 assistant
  async function rerollLastTurn({ contactId, channel, turnId, maxChars } = {}) {
    channel = channel === 'phone' ? 'phone' : 'main';
    contactId = ensureContact(contactId || getActiveContact());
    if (!turnId) return null;

    const all = (state.messages[contactId] || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const inTurn = all.filter(m => m && m.channel === channel && (m.turnId || '') === turnId && (m.role === 'user' || m.role === 'assistant'));
    if (!inTurn.length) return null;

    // 找这轮的最后 user（触发点）
    let lastU = null;
    for (let i = inTurn.length - 1; i >= 0; i--) {
      if (inTurn[i].role === 'user') { lastU = inTurn[i]; break; }
    }
    if (!lastU || !lastU.content || !lastU.content.trim()) return null;

    // 找这轮的 assistant（通常一条）
    let aMsg = null;
    for (let i = inTurn.length - 1; i >= 0; i--) {
      if (inTurn[i].role === 'assistant') { aMsg = inTurn[i]; break; }
    }
    if (!aMsg) return null;

    const api = readApiFromDOM();
    const sys = buildSystemPromptFromCfg(contactId, channel);
    const ctxAll = buildContext({
      contactId,
      systemPrompt: sys,
      maxChars: maxChars || 16000
    });

    // 截断到 lastU（避免把旧 assistant 喂回去）
    const ctx = [];
    for (const item of ctxAll) {
      ctx.push(item);
      if (item.role === 'user' && (item.content || '') === (lastU.content || '')) break;
    }

    aMsg.content = '';
    aMsg.ts = nowTs();
    save();

    try {
      const reply = await callChatCompletions({
        baseUrl: api.baseUrl,
        apiKey: api.apiKey,
        model: api.model,
        messages: ctx,
        stream: false
      });
      aMsg.content = postProcessAssistantText(reply || '', channel);
      aMsg.ts = nowTs();
      save();
      return aMsg;
    } catch (e) {
      aMsg.content = `（错误）${e?.message || e}`;
      aMsg.meta = { error: true };
      aMsg.ts = nowTs();
      save();
      return aMsg;
    }
  }

  function deleteTurn({ contactId, channel, turnId } = {}) {
    channel = channel === 'phone' ? 'phone' : 'main';
    contactId = ensureContact(contactId || getActiveContact());
    if (!turnId) return false;

    const arr = state.messages[contactId] || [];
    const before = arr.length;

    state.messages[contactId] = arr.filter(m => {
      if (!m) return false;
      const tid = m.turnId || m.meta?.turnId || null;
      if (m.channel !== channel) return true;
      if (m.role !== 'user' && m.role !== 'assistant') return true;
      return tid !== turnId;
    });

    if (state.messages[contactId].length !== before) {
      save();
      return true;
    }
    return false;
  }

  async function rerollLastTurn({ contactId, channel, maxChars } = {}) {
    channel = channel === 'phone' ? 'phone' : 'main';
    contactId = ensureContact(contactId || getActiveContact());

    const tid = getLastAssistantTurnId({ contactId, channel });
    if (!tid) return null;

    // 找该 turn 的最后一条 user（用它作为 reroll 的触发点）
    const sorted = (state.messages[contactId] || []).slice().sort((a, b) => a.ts - b.ts);
    const inTurn = sorted.filter(m => {
      const mt = m?.turnId || m?.meta?.turnId || null;
      return m && m.channel === channel && mt === tid && (m.role === 'user' || m.role === 'assistant');
    });

    if (!inTurn.length) return null;

    let lastUser = null;
    for (let i = inTurn.length - 1; i >= 0; i--) {
      if (inTurn[i].role === 'user' && (inTurn[i].content || '').trim()) {
        lastUser = inTurn[i];
        break;
      }
    }
    if (!lastUser) return null;

    // 删除该 turn 下所有 assistant（保留 user）
    state.messages[contactId] = (state.messages[contactId] || []).filter(m => {
      const mt = m?.turnId || m?.meta?.turnId || null;
      if (!m) return false;
      if (m.channel !== channel) return true;
      if (mt !== tid) return true;
      return m.role !== 'assistant';
    });
    save();

    // 重新构建上下文：从 buildContext 取，但截断到 lastUser（按 id 截断更稳）
    const api = readApiFromDOM();
    const sys = buildSystemPromptFromCfg(contactId, channel);

    const ctx = [];
    if (sys && sys.trim()) ctx.push({ role: 'system', content: sys.trim() });

    for (const m of sorted) {
      if (!m) continue;
      if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') continue;
      ctx.push({ role: m.role, content: m.content || '' });
      if (m.id === lastUser.id) break;
    }

    const assistantMsg = appendMessage({ contactId, channel, role: 'assistant', content: '', turnId: tid });

    try {
      const reply = await callChatCompletions({
        baseUrl: api.baseUrl,
        apiKey: api.apiKey,
        model: api.model,
        messages: ctx,
        stream: false
      });

      assistantMsg.content = postProcessAssistantText(reply || '', channel);
      save();
      return assistantMsg;
    } catch (e) {
      assistantMsg.content = `（错误）${e?.message || e}`;
      assistantMsg.meta = { error: true, turnId: tid };
      save();
      return assistantMsg;
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

  function buildSystemPromptFromCfg(contactId, opts = {}) {
    const cfg = loadPromptCfg();
    const parts = [];
    const scope = (opts && opts.scope) ? String(opts.scope).trim() : 'chat';

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

    // 预设：按 scope 注入
    // chat -> cfg.presets.global（你开始界面/Chat 目前就是这个）
    // sms  -> cfg.presets.sms（miniPhone 短信专用）
    let presetArr = null;
    if (cfg?.presets) {
      if (scope === 'sms') presetArr = cfg.presets.sms;
      else presetArr = cfg.presets.global;
    }
    if (Array.isArray(presetArr)) {
      presetArr.forEach(p => {
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
  function postProcessAssistantText(text, channel = 'main') {
    let out = String(text || '').trim();
    if (!out) return out;

    const HARD_LIMIT = channel === 'phone' ? 600 : 1200;

    if (out.length <= HARD_LIMIT) return out;

    // 找安全切点
    const cut = out.slice(0, HARD_LIMIT);
    const safeIdx = Math.max(
      cut.lastIndexOf('。'),
      cut.lastIndexOf('！'),
      cut.lastIndexOf('？'),
      cut.lastIndexOf('\n')
    );

    const finalText = (safeIdx > 100 ? cut.slice(0, safeIdx + 1) : cut)
      + '\n\n（内容较长，已截断。需要继续请回复“继续”。）';

    return finalText;
  }
  function stripThinking(text) {
    let out = String(text || '');

    // 1) 成对 <think>...</think>
    out = out.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // 2) 无闭合 <think>：只删掉从 <think> 起到第一个空行（双换行）为止
    //    （常见格式：<think>...思考...\n\n最终回答...）
    out = out.replace(/<think>[\s\S]*?(?:\n\s*\n)/gi, '');

    // 3) 去掉残留标记
    out = out.replace(/<\/?think>/gi, '');

    // 4) ```think ...``` / ```thinking ...```
    out = out.replace(/```(?:think|thinking)[\s\S]*?```/gi, '');

    // 5) [thinking] / (thinking) 这类段落
    out = out.replace(/^\s*(?:\[\s*thinking\s*\]|\(\s*thinking\s*\))[\s\S]*?(?:\n{2,}|$)/gim, '');

    return out.trim();
  }
  function needSmsRewrite(text) {
    const t = String(text || '').trim();
    if (!t) return true;

    // think / reasoning / analysis 统统不允许
    if (/<think>|<\/think>|reasoning|analysis|思考过程/i.test(t)) return true;

    // ✅ 至少要有一行“短信行”
    // 允许两类：
    // 1) 普通短信：对方：xxxx  或 对方:xxxx
    // 2) 撤回动作： [撤回]原消息内容 / 【撤回】原消息内容
    //    也允许带“对方：”前缀：对方：[撤回]... / 对方：【撤回】...
const hasReplyLine =
  /^\s*对方[:：]/m.test(t) ||

  // 撤回动作
  /^\s*\[撤回\]/m.test(t) ||
  /^\s*【撤回】/m.test(t) ||
  /^\s*对方[:：]\s*\[撤回\]/m.test(t) ||
  /^\s*对方[:：]\s*【撤回】/m.test(t) ||

  // 转账动作
  /^\s*【转账\|/m.test(t) ||
  /^\s*对方[:：]\s*【转账\|/m.test(t);

    if (!hasReplyLine) return true;

    // 禁止 markdown 标题/列表
    if (/^\s*[*#]{1,3}\s+/m.test(t)) return true;
    if (/^\s*[-*]\s+/m.test(t)) return true;

    // 英文占比过高也判为不合规（短信语境不能是英文）
    const latin = (t.match(/[A-Za-z]/g) || []).length;
    const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    if (latin >= 20 && cjk < 5) return true;

    return false;
  }


  async function rewriteToSms({ api, userText, badAssistantText }) {
    const sys = [
      '你是“短信改写器”，只负责把输入内容改写成中文短信。',
      '严格遵守：',
      '1) 只输出 1~4 行；每行以“对方：”开头。',
      '2) 每行 10~40 字，最长不超过 60 字；不够就分行。',
      '3) 禁止任何 <think>/reasoning/analysis/解释/标题/Markdown。',
      '4) 只输出短信正文，不要任何前后缀。',
      '5) 如果要表达“撤回”，用这一行格式：对方：[撤回]原消息内容（只写这一行即可）。'
    ].join('\n');

    const u = [
      `用户短信：${String(userText || '').trim()}`,
      '',
      '需要改写的模型输出（可能含英文/think/长段）：',
      String(badAssistantText || '').trim()
    ].join('\n');

    const ctx = [
      { role: 'system', content: sys },
      { role: 'user', content: u }
    ];

    // 注意：复用同一个模型/同一个 API
    const repaired = await callChatCompletions({
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
      model: api.model,
      messages: ctx,
      stream: false
    });

    return String(repaired || '').trim();
  }

  // ===== debug: dump prompt/messages to console (F12) =====
  function debugDumpLLMRequest({ tag, api, messages }) {
    try {
      const enabled =
        (localStorage.getItem('YBM_DEBUG_LLM') === '1') ||
        (location.search.includes('debugllm=1'));
      if (!enabled) return;

      const safeApi = {
        baseUrl: api?.baseUrl || '',
        model: api?.model || '',
        apiKey: api?.apiKey ? (String(api.apiKey).slice(0, 6) + '…' + String(api.apiKey).slice(-4)) : ''
      };

      console.groupCollapsed(`%c[LLM:${tag}] model=${safeApi.model}`, 'color:#8a2be2;font-weight:700;');
      console.log('api:', safeApi);
      console.log('messages(full):', messages);

      // 额外给一个“便于看”的纯文本串（system+最后几条）
      const lines = (messages || []).map((m, i) => {
        const role = m?.role || 'unknown';
        const c = String(m?.content || '');
        return `#${i} [${role}]\n${c}`;
      });
      console.log('messages(text):\n' + lines.join('\n\n---\n\n'));
      console.groupEnd();
    } catch (e) {
      console.warn('[LLM] debugDump failed:', e);
    }
  }


  async function send({ text, channel, contactId, systemPrompt, maxChars, turnId } = {}) {
    if (!text || !text.trim()) return null;
    channel = channel === 'phone' ? 'phone' : 'main';
    contactId = ensureContact(contactId || getActiveContact());

    const api = readApiFromDOM();

    // ✅ 如果外部没传，就自动生成一轮
    const tid = turnId || newTurnId();

    appendMessage({ contactId, channel, role: 'user', content: text.trim(), turnId: tid });

    const sys = (systemPrompt && systemPrompt.trim())
      ? systemPrompt.trim()
      : buildSystemPromptFromCfg(contactId, channel);

    const ctx = buildContext({
      contactId,
      systemPrompt: sys,
      maxChars: maxChars || 16000,
    });

    // ✅ assistant 也必须写 turnId，否则“最后一轮”删除/重roll 没法判定
    const assistantMsg = appendMessage({ contactId, channel, role: 'assistant', content: '', turnId: tid });

    try {
      // ✅ F12 查看本次真实发送给模型的 messages（含 system/worldbook/preset/历史）
      debugDumpLLMRequest({ tag: `send:${channel}`, api, messages: ctx });

      const reply = await callChatCompletions({
        baseUrl: api.baseUrl,
        apiKey: api.apiKey,
        model: api.model,
        messages: ctx,
        stream: false
      });


      let out = postProcessAssistantText(reply || '', channel);

      if (channel === 'phone') {
        // 先剃 think（保证 UI/历史不污染）
        out = stripThinking(out);

        // 不合规就走改写器：保证“永远像短信、永远中文、永远对方：”
        if (needSmsRewrite(out)) {
          try {
            const repaired = await rewriteToSms({
              api,
              userText: text,
              badAssistantText: reply || out
            });
            if (repaired) out = repaired;
          } catch (e) {
            // 改写失败也至少保证不出 think
            out = stripThinking(out);
          }
        }
      }

      assistantMsg.content = out;
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
    getContact,
    addContact,
    setActiveContact,
    getActiveContact,
    newTurnId,
    getLastAssistantTurnId,
    deleteTurn,
    rerollLastTurn,

    appendMessage,
    getMessages,       // ✅ 已定义
    buildContext,
    deleteTurn,
    rerollLastTurn,
    getLastAssistantTurnId,
    newTurnId,

    updateMessage,
    deleteMessage,
    clearMessages,
    clearAllMessages,

    rerollLastAssistant,

    readApiFromDOM,
    setApiConfig,

    send,

    onChange,
    reloadFromStorage,
  };

  window.ChatEngine = window.PhoneEngine;

  let storageDebounce = null;
  window.addEventListener('storage', (e) => {
    if (!e || (e.key !== LS_KEY && e.key !== API_LS_KEY && e.key !== PROMPT_LS_KEY)) return;
    clearTimeout(storageDebounce);
    storageDebounce = setTimeout(() => reloadFromStorage(), 60);
  });
})();
