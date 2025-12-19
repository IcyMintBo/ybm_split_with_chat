/* =========================================================
 * PhoneEngine.js
 * - 非流式（stream:false）稳定版
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
   * Prompt Config / 世界书 / 预设
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
    if (!cfg) return '';

    const parts = [];

    // Worldbook: Global / ALWAYS
    if (cfg.worldbook && Array.isArray(cfg.worldbook.global)) {
      cfg.worldbook.global.forEach(wb => {
        if (wb && wb.enabled && wb.content) parts.push(wb.content);
      });
    }

    // Worldbook: Contact / ACTIVE_CONTACT
    const cid = state.activeContactId;
    if (cid && cfg.worldbook && cfg.worldbook.contact && Array.isArray(cfg.worldbook.contact[cid])) {
      cfg.worldbook.contact[cid].forEach(wb => {
        if (wb && wb.enabled && wb.content) parts.push(wb.content);
      });
    }

    // Presets: global（拼在世界书后面）
    if (cfg.presets && Array.isArray(cfg.presets.global)) {
      cfg.presets.global.forEach(p => {
        if (p && p.enabled && p.content) parts.push(p.content);
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
   * URL Helper
   * ========================= */
  function buildChatCompletionsUrl(baseUrl) {
    const u = (baseUrl || '').trim().replace(/\/+$/, '');

    // 用户填的是 .../v1
    if (u.endsWith('/v1')) return u + '/chat/completions';

    // 用户填的是根域名（不含 /v1）
    return u + '/v1/chat/completions';
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
      context.push({ role: 'system', content: systemPrompt });
    }

    msgs.forEach(m => {
      context.push({ role: m.role, content: m.content });
    });

    return context;
  }

  /* =========================
   * Response extract (兼容)
   * ========================= */
  function extractAssistantText(data) {
    // OpenAI compatible: choices[0].message.content
    const t1 = data?.choices?.[0]?.message?.content;
    if (typeof t1 === 'string' && t1.trim()) return t1;

    // 某些兼容：choices[0].text
    const t2 = data?.choices?.[0]?.text;
    if (typeof t2 === 'string' && t2.trim()) return t2;

    // 兜底：把整个对象 stringify（方便你排查）
    return '';
  }

  /* =========================
   * Send（非流式）
   * ========================= */
  async function send({ text, channel = 'main', onChunk, onDone, onError }) {
    try {
      const api = readApiFromDOM();
      if (!api.baseUrl || !api.model) {
        throw new Error('API 未配置（缺少 BaseURL 或 模型）');
      }

      // 记录用户消息
      pushMessage({ role: 'user', content: text, channel });

      const messages = buildContext();
      const url = buildChatCompletionsUrl(api.baseUrl);

      // headers：跟你的“测试”逻辑一致（有 key 才加 Authorization）
      const headers = { 'Content-Type': 'application/json' };
      if (api.apiKey) headers['Authorization'] = `Bearer ${api.apiKey}`;

      const payload = {
        model: api.model,
        messages,
        stream: false
      };

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`API 错误：${res.status}${t ? ` | ${t.slice(0, 300)}` : ''}`);
      }

      const data = await res.json();
      const assistantText = extractAssistantText(data);

      if (!assistantText) {
        // 把原始返回塞到错误里，方便你截图给我看
        throw new Error(`API 返回无法解析：${JSON.stringify(data).slice(0, 500)}`);
      }

      // 非流式：一次性吐出
      onChunk && onChunk(assistantText);
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
