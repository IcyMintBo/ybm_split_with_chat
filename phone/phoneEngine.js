/* =========================================================
 * PhoneEngine.js
 * ========================================================= */

(function () {
  const ENGINE_KEY = 'YBM_ENGINE_V1';
  const API_KEY = 'YBM_API_CFG_V1';
  const PROMPT_KEY = 'YBM_PROMPT_CFG_V1';

  /* =========================
   * 基础工具
   * ========================= */
  function loadLS(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveLS(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  /* =========================
   * Engine State
   * ========================= */
  const state = loadLS(ENGINE_KEY, {
    activeContactId: null,
    contacts: [],           // [{id, name}]
    messages: {},           // { contactId: [ {id, ts, role, content, channel} ] }
    api: {
      baseUrl: '',
      apiKey: '',
      model: ''
    }
  });

  function save() {
    saveLS(ENGINE_KEY, state);
  }

  /* =========================
   * API Config
   * ========================= */
  function loadApiCfgFromLS() {
    return loadLS(API_KEY, {});
  }

  function readApiFromDOM() {
    // 🚫 不再从 DOM 读，统一从 localStorage
    const cfg = loadApiCfgFromLS();
    if (cfg) {
      if (typeof cfg.baseUrl === 'string') state.api.baseUrl = cfg.baseUrl.trim();
      if (typeof cfg.apiKey === 'string') state.api.apiKey = cfg.apiKey.trim();
      if (typeof cfg.model === 'string') state.api.model = cfg.model.trim();
      save();
    }
    return { ...state.api };
  }

  /* =========================
   * Prompt Config / 世界书
   * ========================= */
  function loadPromptCfg() {
    return loadLS(PROMPT_KEY, null);
  }

  function syncContactsFromPromptCfg() {
    const cfg = loadPromptCfg();
    if (!cfg || !Array.isArray(cfg.contacts)) return;

    state.contacts = cfg.contacts.map(c => ({ id: c.id, name: c.name }));
    if (!state.activeContactId && state.contacts.length) {
      state.activeContactId = state.contacts[0].id;
    }
    save();
  }

  function buildSystemPrompt() {
    const cfg = loadPromptCfg();
    if (!cfg || !cfg.worldbook) return '';

    const parts = [];

    // Global / ALWAYS
    if (Array.isArray(cfg.worldbook.global)) {
      cfg.worldbook.global.forEach(wb => {
        if (wb.enabled && wb.content) {
          parts.push(wb.content);
        }
      });
    }

    // Contact / ACTIVE_CONTACT
    const cid = state.activeContactId;
    if (cid && cfg.worldbook.contact && Array.isArray(cfg.worldbook.contact[cid])) {
      cfg.worldbook.contact[cid].forEach(wb => {
        if (wb.enabled && wb.content) {
          parts.push(wb.content);
        }
      });
    }

    return parts.join('\n\n');
  }

  /* =========================
   * Contacts
   * ========================= */
  function listContacts() {
    return state.contacts || [];
  }

  function getActiveContact() {
    return state.activeContactId;
  }

  function setActiveContact(id) {
    if (!id) return;
    state.activeContactId = id;
    if (!state.messages[id]) state.messages[id] = [];
    save();
  }

  /* =========================
   * Messages
   * ========================= */
  function getMessages({ contactId, channel } = {}) {
    const cid = contactId || state.activeContactId;
    const list = state.messages[cid] || [];
    if (!channel) return list;
    return list.filter(m => m.channel === channel);
  }

  function pushMessage({ role, content, channel }) {
    const cid = state.activeContactId;
    if (!cid) return;

    if (!state.messages[cid]) state.messages[cid] = [];
    state.messages[cid].push({
      id: uid(),
      ts: Date.now(),
      role,
      content,
      channel
    });
    save();
  }

  /* =========================
   * Context Builder
   * ========================= */
  function buildContext() {
    const cid = state.activeContactId;
    const msgs = (state.messages[cid] || []).slice().sort((a, b) => a.ts - b.ts);

    const context = [];

    const systemPrompt = buildSystemPrompt();
    if (systemPrompt) {
      context.push({
        role: 'system',
        content: systemPrompt
      });
    }

    msgs.forEach(m => {
      context.push({
        role: m.role,
        content: m.content
      });
    });

    return context;
  }

  /* =========================
   * Send
   * ========================= */
  async function send({ text, channel = 'main', onChunk, onDone, onError }) {
    try {
      const api = readApiFromDOM();
      if (!api.baseUrl || !api.apiKey || !api.model) {
        throw new Error('API 未配置');
      }

      pushMessage({ role: 'user', content: text, channel });

      const messages = buildContext();

      const res = await fetch(api.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api.apiKey}`
        },
        body: JSON.stringify({
          model: api.model,
          messages,
          stream: true
        })
      });

      if (!res.ok || !res.body) {
        throw new Error(`API 错误：${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(Boolean);

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.replace(/^data:\s*/, '');
          if (data === '[DONE]') break;

          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            assistantText += delta;
            onChunk && onChunk(delta);
          }
        }
      }

      pushMessage({ role: 'assistant', content: assistantText, channel });
      onDone && onDone(assistantText);

    } catch (err) {
      console.error(err);
      onError && onError(err);
    }
  }

  /* =========================
   * Init
   * ========================= */
  syncContactsFromPromptCfg();
  if (!state.activeContactId && state.contacts.length) {
    setActiveContact(state.contacts[0].id);
  }

  /* =========================
   * Expose
   * ========================= */
  window.PhoneEngine = {
    send,
    listContacts,
    getActiveContact,
    setActiveContact,
    getMessages
  };

})();
