/* phone/phoneEngine.js
 * 共享记忆、分离显示：main/phone 两个 channel 都参与上下文，但各自只在自己的 UI 渲染
 * 多联系人：每个 contactId 一套历史
 */
(function () {
  const LS_KEY = 'YBM_ENGINE_V1';
  const API_LS_KEY = 'YBM_API_CFG_V1';

  function loadApiCfgFromLS() {
    try { return JSON.parse(localStorage.getItem(API_LS_KEY) || '{}'); } catch { return {}; }
  }

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

  function getMessages({ contactId, channel } = {}) {
    contactId = ensureContact(contactId || getActiveContact());
    const all = state.messages[contactId] || [];
    if (!channel) return all.slice();
    return all.filter(m => m.channel === channel);
  }

  // 把 main + phone 合并成给模型看的上下文（但 UI 不串）
  function buildContext({ contactId, systemPrompt, maxChars } = {}) {
    contactId = ensureContact(contactId || getActiveContact());
    const all = state.messages[contactId] || [];

    // system prompt（可选）
    const messages = [];
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() });
    }

    // 合并：保留顺序（按时间）
    const sorted = all.slice().sort((a, b) => a.ts - b.ts);

    for (const m of sorted) {
      if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') continue;
      messages.push({ role: m.role, content: m.content || '' });
    }

    // 粗暴截断：按字符数从尾部裁（先简单，够用；后面可做 token 截断）
    if (maxChars && maxChars > 0) {
      let total = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        total += (messages[i].content || '').length;
        if (total > maxChars) {
          // 保留从 i+1 到末尾
          return messages.slice(i + 1);
        }
      }
    }
    return messages;
  }

  // 从设置面板读 API（输入框没 id 时也尽量兜底）
function readApiFromDOM() {
  // ✅ 统一从 localStorage 读取
  const cfg = loadApiCfgFromLS();
  if (cfg && typeof cfg === 'object') {
    if (typeof cfg.baseUrl === 'string') state.api.baseUrl = cfg.baseUrl.trim();
    if (typeof cfg.apiKey === 'string')  state.api.apiKey  = cfg.apiKey.trim();
    if (typeof cfg.model === 'string')   state.api.model   = cfg.model.trim();
    save();
  }
  return { ...state.api };
}

  function setApiConfig({ baseUrl, apiKey, model }) {
    if (typeof baseUrl === 'string') state.api.baseUrl = baseUrl.trim();
    if (typeof apiKey === 'string') state.api.apiKey = apiKey.trim();
    if (typeof model === 'string') state.api.model = model.trim();
    save();
  }

  // OpenAI 兼容：POST {baseUrl}/chat/completions
  async function callChatCompletions({ baseUrl, apiKey, model, messages, stream, signal, onToken }) {
    if (!baseUrl) throw new Error('Base URL 为空');
    if (!model) throw new Error('Model 为空');

    const url = baseUrl.replace(/\/$/, '') + '/chat/completions';

    const headers = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = {
      model,
      messages,
      temperature: 0.8,
      stream: !!stream
    };

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`API 错误 ${res.status}: ${t.slice(0, 200)}`);
    }

    if (!stream) {
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      return text;
    }

    // stream: SSE-ish (data: ...)
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let full = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按行处理
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        if (s === 'data: [DONE]') continue;
        if (!s.startsWith('data:')) continue;

        const jsonStr = s.replace(/^data:\s*/, '');
        try {
          const chunk = JSON.parse(jsonStr);
          const delta = chunk?.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            full += delta;
            onToken?.(delta, full);
          }
        } catch {
          // ignore chunk parse errors
        }
      }
    }

    return full;
  }

  // 发送：会把 user 写入对应 channel；assistant 回复也写入同 channel
  // 但上下文总是 main+phone 合并（共享记忆）
  async function send({ text, channel, contactId, systemPrompt, stream, onToken, maxChars } = {}) {
    if (!text || !text.trim()) return null;
    channel = channel === 'phone' ? 'phone' : 'main';
    contactId = ensureContact(contactId || getActiveContact());

    // 读 API 配置（从 DOM / state）
    const api = readApiFromDOM();

    // 写入 user
    appendMessage({ contactId, channel, role: 'user', content: text.trim() });

    // 构造给模型看的 context（共享记忆）
    const ctx = buildContext({
      contactId,
      systemPrompt: systemPrompt || '',
      maxChars: maxChars || 16000, // 先按字符截断，后面再换 token 截断
    });

    // 先占位 assistant（用于流式/更新 UI）
    const assistantMsg = appendMessage({ contactId, channel, role: 'assistant', content: '' });

    try {
      const reply = await callChatCompletions({
        baseUrl: api.baseUrl,
        apiKey: api.apiKey,
        model: api.model,
        messages: ctx,
        stream: !!stream,
        onToken: (delta, full) => {
          assistantMsg.content = full;
          save();
          onToken?.(delta, full);
        }
      });

      // 非流式时补回
      if (!stream) {
        assistantMsg.content = reply || '';
        save();
      }

      return assistantMsg;
    } catch (e) {
      assistantMsg.content = `（错误）${e?.message || e}`;
      assistantMsg.meta = { error: true };
      save();
      return assistantMsg;
    }
  }

  window.PhoneEngine = {
    // state
    listContacts,
    addContact,
    setActiveContact,
    getActiveContact,

    // messages
    appendMessage,
    getMessages,
    buildContext,

    // api
    readApiFromDOM,
    setApiConfig,

    // send
    send,
  };
})();
