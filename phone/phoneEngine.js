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
    syncContactsFromPromptCfg();
    migrateMissingTurnIds();
    notifyChange('reload', { source: 'storage' });
    return true;
  }

  // ✅ 同步联系人名字：以 YBM_PROMPT_CFG_V1 为准（用于“自定义联系人”/改名）
  function syncContactsFromPromptCfg() {
    try {
      const cfg = loadPromptCfg();
      const arr = Array.isArray(cfg?.contacts) ? cfg.contacts : [];
      let changed = false;

      // 老版本兜底：确保 custom 存在
      const list = arr.slice();
      const DEF_CUSTOM = (window.DEFAULT_CUSTOM_AVATAR_KEY || 'ybm');
      if (!list.some(c => c && c.id === 'custom')) list.push({ id: 'custom', name: '联系人', avatarKey: DEF_CUSTOM });

      list.forEach((c) => {
        if (!c || !c.id) return;
        const id = String(c.id);
        const name = String(c.name || id);
        const avatarKeyRaw = (c && typeof c === 'object') ? c.avatarKey : '';
        const avatarKey = String(avatarKeyRaw || '').trim() || (id === 'custom' ? DEF_CUSTOM : id);
        ensureContact(id);
        if (!state.contacts[id]) state.contacts[id] = { id, name, avatarKey };
        if (state.contacts[id].name !== name) {
          state.contacts[id].name = name;
          changed = true;
        }
        if (state.contacts[id].avatarKey !== avatarKey) {
          state.contacts[id].avatarKey = avatarKey;
          changed = true;
        }
      });

      if (changed) save();
    } catch { }
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
  syncContactsFromPromptCfg();
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

    // ✅ 只改内容，不改 ts；否则会按时间排序被挪到最底
    m.content = (content ?? '').toString();

    // 可选：记录编辑时间（不参与排序）
    if (!m.meta || typeof m.meta !== 'object') m.meta = {};
    m.meta.editedAt = nowTs();

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
      maxChars: maxChars || 40000,
      channel
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
      maxChars: maxChars || 40000,
      channel
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

      // main(chat)：先做“API 异常文本”判定，再正常后处理
      if (isApiAbnormalReply(reply || '')) {
        const p = buildErrorAssistantPayload(ERROR_SOURCE.API_ABNORMAL);
        assistantMsg.content = p.content;
        assistantMsg.meta = p.meta;
        save();
        return assistantMsg;
      }

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

  // ✅ 给模型看的上下文：按 channel 过滤；摘要为空=全量；摘要有=最近N轮
  function buildContext({ contactId, systemPrompt, maxChars, channel = 'chat' } = {}) {
    contactId = ensureContact(contactId || getActiveContact());
    const all = state.messages[contactId] || [];

    // 1) 只取对应 channel 的消息
    const wantChannel = (channel === 'phone') ? 'phone' : 'main';
    const sorted = all
      .filter(m => m && m.channel === wantChannel)
      .slice()
      .sort((a, b) => a.ts - b.ts);

    // 2) 判断是否已有摘要：有摘要就“过滤已摘要轮次”，只保留未摘要段（不会断档）
    let sliced = sorted;

    try {
      const enabled = window.__YBM_FEATURE_FLAGS__?.memoryEnabled !== false;
      const store = window.__YBM_MEMORY_STORE__;
      const sum = (store?.getSummary?.(contactId) || '').trim();
      const last = store?.getLastRange?.(contactId);
      const summarizedTo = last?.to || 0;

      // ✅ 仅 main/chat 使用“摘要过滤”，phone/sms 不动
      if (enabled && sum && wantChannel === 'main' && summarizedTo > 0) {
        const targetTurn = summarizedTo + 1; // 从下一轮开始保留
        let uCount = 0;
        let startIdx = 0;

        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i].role === 'user') uCount++;
          if (uCount >= targetTurn) { startIdx = i; break; }
        }

        sliced = sorted.slice(startIdx);

        // ✅ 可选兜底：如果未摘要段太长（比如 > 20轮），只保留“未摘要段的最后20轮”
        // 但不会产生中间空洞，因为裁的是“连续尾部”
        const MAX_UNSUM_TURNS = 20;
        let turns = 0;
        for (let i = sliced.length - 1; i >= 0; i--) {
          if (sliced[i].role === 'user') turns++;
          if (turns >= MAX_UNSUM_TURNS) { sliced = sliced.slice(i); break; }
        }
      }
    } catch { }


    // 4) 拼 messages：system + sliced
    const messages = [];
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() });
    }
    for (const m of sliced) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      messages.push({ role: m.role, content: m.content || '' });
    }

    // 5) 最后再按 maxChars 兜底裁剪
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

  function buildSystemPromptFromCfg(contactId, channel = 'chat') {
    const cfg = loadPromptCfg();
    const parts = [];

    const scope = channel === 'phone' ? 'sms' : 'chat';

    // ===== 1️⃣ 预设（最高优先级）=====
    let presetArr = null;
    if (cfg?.presets) {
      presetArr = scope === 'sms' ? cfg.presets.sms : cfg.presets.global;
    }
    if (Array.isArray(presetArr)) {
      presetArr.forEach(p => {
        if (p && p.enabled && p.content && String(p.content).trim()) {
          parts.push(p.content.trim());
        }
      });
    }

    // ===== 2️⃣ 当前联系人世界书（强绑定角色）=====
    if (
      contactId &&
      cfg?.worldbook?.contact &&
      Array.isArray(cfg.worldbook.contact[contactId])
    ) {
      cfg.worldbook.contact[contactId].forEach(wb => {
        if (wb && wb.enabled && wb.content && String(wb.content).trim()) {
          parts.push(wb.content.trim());
        }
      });
    }

    // ===== 3️⃣ 全局世界书（环境）=====
    if (Array.isArray(cfg?.worldbook?.global)) {
      cfg.worldbook.global.forEach(wb => {
        if (wb && wb.enabled && wb.content && String(wb.content).trim()) {
          parts.push(wb.content.trim());
        }
      });
    }

    // ===== 4️⃣ 用户人设（最低权重）=====
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

    // ✅ 注入长期摘要（放在系统提示末尾，避免抢优先级）
    try {
      const store = window.__YBM_MEMORY_STORE__;
      const sum = (store?.getSummary(contactId) || '').trim();
      const last = store?.getLastRange(contactId);
      if (sum) {
        parts.push(
          [
            '【长期摘要】' + (last ? `（最近总结范围：${last.from}-${last.to}）` : ''),
            sum
          ].join('\n')
        );
      }
    } catch { }

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

  function detectProvider({ model, baseUrl } = {}) {
    const m = String(model || '').toLowerCase();
    const u = String(baseUrl || '').toLowerCase();

    // 只靠 model 名识别最稳（你的 UI 就是填 model）
    if (m.includes('claude') || m.includes('anthropic')) return 'anthropic';
    if (m.includes('gemini')) return 'google';
    if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('openai')) return 'openai';

    // 兜底：看域名
    if (u.includes('anthropic')) return 'anthropic';
    if (u.includes('google')) return 'google';

    return 'openai';
  }

  function splitSystemAndOthers(messages = []) {
    const sys = [];
    const rest = [];
    for (const m of (messages || [])) {
      if (!m) continue;
      if (m.role === 'system') sys.push(String(m.content || ''));
      else rest.push({ role: m.role, content: String(m.content || '') });
    }
    return { systemText: sys.join('\n\n').trim(), rest };
  }

  /**
   * 统一把提示词喂进去：
   * - 大部分 OpenAI-compat 会吃 role=system
   * - 但一些 Claude 代理/网关会忽略 system => 需要把 system 再塞进第一条 user（双保险）
   */
  function normalizeMessagesForAllModels({ provider, messages }) {
    const { systemText, rest } = splitSystemAndOthers(messages);

    // 没有 system 就不折腾
    if (!systemText) return rest;

    // 对 Claude：双保险，把 system 再注入第一条 user
    // 注意：不删 system（因为我们已经 split 掉了 system role，这里返回的是 “无 system role” 的 rest）
    if (provider === 'anthropic') {
      const tag = '【系统提示】';
      const injected = `${tag}\n${systemText}\n\n---\n\n`;

      const out = rest.slice();
      const firstUserIdx = out.findIndex(x => x && x.role === 'user');

      if (firstUserIdx >= 0) {
        out[firstUserIdx] = {
          role: 'user',
          content: injected + String(out[firstUserIdx].content || '')
        };
        return out;
      }

      // 没有 user（极少），就造一条
      return [{ role: 'user', content: injected }, ...out];
    }

    // 其它模型：保留 system role 更标准
    // 但我们这里 split 掉了 system，所以需要把 system 作为第一条 system 插回去
    return [{ role: 'system', content: systemText }, ...rest];
  }

  async function callChatCompletions({ baseUrl, apiKey, model, messages, stream, signal, max_tokens }) {
    if (!baseUrl) throw new Error('Base URL 为空');
    if (!model) throw new Error('Model 为空');

    const url = buildChatCompletionsUrl(baseUrl);

    const headers = { 'Content-Type': 'application/json' };
    Object.assign(headers, buildAuthHeader(baseUrl, apiKey));

    const provider = detectProvider({ model, baseUrl });
    const normalizedMessages = normalizeMessagesForAllModels({ provider, messages });
    // ✅ Claude/某些反代要求：除最后一条可选的 assistant 外，所有消息 content 必须非空
    const sanitizeMessages = (msgs) => {
      if (!Array.isArray(msgs)) return [];

      // 统一把 content 转成字符串（兼容 content 是数组/对象的情况）
      const toText = (c) => {
        if (c == null) return '';
        if (typeof c === 'string') return c;
        try {
          return JSON.stringify(c);
        } catch {
          return String(c);
        }
      };

      // 先做浅拷贝并标准化 content
      let m = msgs.map(x => ({ ...x, content: toText(x.content) }));

      // 找到最后一条“assistant”消息的位置（如果它在最后，允许为空）
      const lastIdx = m.length - 1;
      const lastIsEmptyAssistant =
        lastIdx >= 0 &&
        m[lastIdx]?.role === 'assistant' &&
        (m[lastIdx]?.content ?? '').trim() === '';

      // 过滤规则：content 为空的消息全部删掉；但如果“最后一条 assistant 为空”，保留它
      m = m.filter((msg, idx) => {
        const empty = (msg.content ?? '').trim() === '';
        if (!empty) return true;
        if (lastIsEmptyAssistant && idx === lastIdx) return true;
        return false;
      });

      return m;
    };

    const safeMessages = sanitizeMessages(normalizedMessages);


    const body = {
      model,
      messages: safeMessages,
      temperature: 0.8,
      stream: false
    };

    // ✅ Claude/Anthropic：永远带 >=1 的 max_tokens（彻底规避网关缺失->0 的坑）
    const toPosInt = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      const i = Math.floor(n);
      return i >= 1 ? i : null;
    };
    const mt = toPosInt(max_tokens);
    if (provider === 'anthropic') body.max_tokens = mt ?? 520;
    else if (mt != null) body.max_tokens = mt;

    // ✅ Debug：把“实际发出去的 payload”也打印（不含 key）
    try {
      const enabled =
        (localStorage.getItem('YBM_DEBUG_LLM') === '1') ||
        (location.search.includes('debugllm=1'));
      if (enabled) {
        console.groupCollapsed(
          `%c[LLM:payload] ${provider} ${model}`,
          'color:#2b6cb0;font-weight:700;'
        );
        console.log('url:', url);
        console.log('body:', body);
        console.groupEnd();
      }
    } catch { }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });

    // ✅ 关键：400/401/… 时把“完整响应体”留在 console，并把 status 带到 error 上层
    if (!res.ok) {
      const t = await res.text().catch(() => '');

      // console 打完整（不要 slice）
      console.error('[LLM] HTTP error', {
        status: res.status,
        url,
        responseText: t
      });

      const err = new Error(`API 错误 ${res.status}: ${t.slice(0, 800)}`); // UI 里仍然别太长
      err.status = res.status;
      err.url = url;
      err.responseText = t;
      err.provider = provider;
      throw err;
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
  // ===== Memory: summary generator (used by MemoryManager) =====
  function buildTurnsFromMessages(allMessages) {
    const main = Array.isArray(allMessages)
      ? allMessages.filter(m => m?.channel === 'main' && (m.role === 'user' || m.role === 'assistant'))
      : [];

    const turns = [];
    let cur = null;

    for (const m of main) {
      if (m.role === 'user') {
        cur = { u: String(m.content || ''), a: '' };
        turns.push(cur);
      } else {
        if (!cur) { cur = { u: '', a: '' }; turns.push(cur); }
        cur.a = String(m.content || '');
      }
    }
    return turns;
  }

  function clampCnChars(s, target = 1200, slack = 50) {
    const t = String(s || '').trim();
    if (t.length <= target + slack) return t;

    const hard = target + slack;
    const cut = t.slice(0, hard);
    const m = cut.match(/[\s\S]*[。！？；]\s*/);
    return (m ? m[0] : cut).trim();
  }

  // ✅ 关键：必须是函数，不能写在顶层
  window.__YBM_SUMMARY_GENERATOR__ = async function ({ contactId, range, allMessages, extraInstruction } = {}) {
    const api = loadApiCfg();
    const from = range?.from ?? 1;
    const to = range?.to ?? from;

    const turns = buildTurnsFromMessages(allMessages);
    const slice = turns.slice(Math.max(0, from - 1), Math.min(turns.length, to));

    const transcript = slice.map((t, i) => {
      const idx = from + i;
      return `第${idx}轮\n用户：${t.u || '(空)'}\n助手：${t.a || '(空)'}`;
    }).join('\n\n');

    const store = window.__YBM_MEMORY_STORE__;
    const prevSummary = (store?.getSummary?.(contactId) || '').trim();

    const sys = [
      '你是一个【长期记忆摘要】助手。',
      '你的职责不是复述剧情，而是为后续对话生成“可被调用的记忆索引”。',
      '',
      '什么是长期记忆摘要：',
      '- 不是故事回放',
      '- 不是人物设定说明',
      '- 不是情节细节堆砌',
      '- 而是“未来对话时，模型应该记住的事情”',
      '',
      '【重要规则】',
      '1. 不要重复世界书或既有人设中已有的身份、背景、性格设定',
      '2. 不要详细描写亲密或性行为过程，只保留结果与关系变化（如“发生了肉体关系 / 关系进入亲密阶段”）',
      '3. 能用一句话说清的，不要写成一段',
      '4. 重点记录“变化”和“结果”，而不是过程',
      '5. 所有内容都应服务于后续对话的连续性与一致性',
      '',
      '【内容抽象与中立规则】',
      '6. 若出现露骨、亲密或性行为等内容：不得复述细节与过程，必须抽象为“事实性结果 + 关系变化 + 后续影响”。',
      '7. 需要优先提取并保留：是否产生新的约定/承诺/要求；是否形成排他/绑定/依赖/主导等关系结构变化；以及对双方情绪与后续决策的影响。',
      '8. 禁止对故事内容进行任何道德、价值或安全评价；禁止劝导、提醒、审查式措辞；只做客观总结与状态维护。',
      '9. 不要替任何一方给出“应该如何看待或如何处理”的判断。',
      '',
      '【推荐抽象表述（可直接使用）】',
      '- 发生了肉体关系',
      '- 关系进入亲密阶段',
      '- 双方建立了明确的身体/情感绑定',
      '- 亲密行为引发了关系层级变化'
    ].join('\n');

    const user = [
      '你将维护一份【阶段性长期记忆摘要】（一种可持续继承的“故事状态”）。',
      '你将收到两部分信息：',
      'A）【上一次阶段性记忆摘要】——描述已发生且仍然有效的事实状态',
      'B）【新增对话内容】——在 A 的基础上发生的新内容',
      '',
      '你的任务：生成一份【新的阶段性记忆摘要】，它必须覆盖 A + B 的全部关键信息，并用于替换旧摘要。',
      '',
      '【强制规则（必须遵守）】',
      '1. 当提供 A 时：A 中的关键信息不得丢失。允许更精炼，但不能删除核心事件、关系结论、约定与重要线索。',
      '1.1 若 A 中已明确出现以下内容，新摘要中必须至少保留一次提及：',
      '- 已确认的关系性质（如：亲密/排他/暧昧/对立）',
      '- 已发生的关键转折事件',
      '- 已存在的约定、承诺或未解决的要求',
      '2. B 只能用于补充、推进或修正 A；禁止只总结新增内容导致旧内容消失。',
      '3. 若 A 与 B 存在冲突或更新：必须在摘要中明确标注“更新/变化”，不得静默覆盖。',
      '4. 若在字数限制下无法同时保留 A 与 B 的关键信息：输出 “NEED_MORE_SPACE”。',
      '5. 注意：A 与 B 的重要性权重相同，不因“更新”而自动降低 A 的保留优先级。',
      '',
      '【摘要应重点关注以下内容】',
      '- 本阶段发生了哪些关键事件（1–3 条即可；露骨内容必须抽象为结果）',
      '- 这些事件对双方关系造成了什么变化（确认、加深、缓和、裂痕、排他/绑定/依赖/主导等）',
      '- 是否出现新的约定、承诺或要求（后续需要履行、兑现或追问的点）',
      '- 本阶段结束时双方的主要情绪/状态，以及仍可延续的矛盾或线索',
      '',
      '【明确不要做的事情】',
      '- 不要复述完整剧情',
      '- 不要罗列细节描写（尤其禁止亲密或性行为过程细节）',
      '- 不要总结人物身份、外貌、固定性格',
      '- 不要进行任何评价、劝告或审查式表述',
      '',
      prevSummary ? `【上一次阶段性记忆摘要】\n${prevSummary}` : '',
      '',
      `【新增对话内容（第${from}-${to}轮）】`,
      transcript,
      '',
      '【输出格式（必须严格遵守）】',
      '',
      '【阶段性记忆摘要】',
      '- 事件：',
      '  - （高度概括发生了什么；露骨内容只写结果）',
      '- 关系变化：',
      '  - （关系是否确认/加深/缓和/动摇；是否出现排他/绑定/依赖/主导等结构变化）',
      '- 情绪与状态：',
      '  - （本阶段结束时双方的主要情绪或状态）',
      '- 约定与要求（如有）：',
      '  - （本阶段产生的承诺、条件或“之后要做什么”）',
      '- 待延续线索（仅在对话中已实际出现未解决点时填写）：',
      '  - （后续可继续展开的点；没有则写“无”）',
      '',
      '【字数要求】',
      '- 总字数控制在 800–1200 字之间',
      '- 宁可偏短，也不要冗余',
      '',
      '在生成最终摘要前，请先自检：是否完整保留了上一次摘要中的关键状态；若发现遗漏，请修正后再输出。'
    ].join('\n');



    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ];

    let text = await callChatCompletions({
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
      model: api.model,
      messages,
      stream: false
    });

    text = clampCnChars(text, 1200, 50);
    return String(text || '').trim();
  };


  function postProcessAssistantText(text, channel = 'main') {
    let out = String(text || '').trim();
    if (!out) return out;

    // ✅ phone（短信）不做硬截断：靠 max_tokens + SMS改写器 + UI拆行控制长度
    if (channel === 'phone') return out;

    // main 保留原逻辑（避免主界面爆长）
    const HARD_LIMIT = 8000;
    if (out.length <= HARD_LIMIT) return out;

    const cut = out.slice(0, HARD_LIMIT);
    const safeIdx = Math.max(
      cut.lastIndexOf('。'),
      cut.lastIndexOf('！'),
      cut.lastIndexOf('？'),
      cut.lastIndexOf('\n')
    );

    return (safeIdx > 100 ? cut.slice(0, safeIdx + 1) : cut)
      + '\n\n（内容较长，已截断。需要继续请回复“继续”。）';
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

    // 6) grok 的工具标记（完整块 + 残片兜底）
    out = out.replace(/<grok:render\b[\s\S]*?<\/grok:render>/gi, '');
    out = out.replace(/^\s*<\/?grok:[^>\n]*>\s*$/gim, '');
    out = out.replace(/^\s*<\/?argument[^>\n]*>\s*$/gim, '');

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

  // ===== error source detect (api vs project) =====
  const ERROR_SOURCE = {
    PROJECT: 'project',
    API: 'api',
    API_ABNORMAL: 'api_abnormal',
  };

  function isApiAbnormalReply(text) {
    const t = String(text || '').trim();
    if (!t) return false;

    // 拒答说明书
    const patterns = [
      /silently apologize/i,
      /refuse to answer/i,
      /unable to create/i,
      /\bpolicy\b/i,
      /\bsafety\b/i,
      /content (is|was) not allowed/i,
      /i am unable/i,
    ];

    return patterns.some((re) => re.test(t));
  }

  function buildErrorAssistantPayload(source, extraMsg) {
    // 给用户看的文案：短、明确、可甩给接口方
    if (source === ERROR_SOURCE.API_ABNORMAL) {
      return {
        content: '⚠ AI 回复异常\n来源：外部 AI 服务\n本次未生成有效内容，请联系接口服务提供方或稍后重试。',
        meta: { error: true, errorSource: ERROR_SOURCE.API_ABNORMAL }
      };
    }
    if (source === ERROR_SOURCE.API) {
      return {
        content: '⚠ AI 服务不可用\n来源：外部 AI 服务\n请求失败，请检查接口配置/额度，或联系接口服务提供方。',
        meta: { error: true, errorSource: ERROR_SOURCE.API, detail: extraMsg || '' }
      };
    }
    // PROJECT
    return {
      content: '⚠ 系统异常\n来源：项目本身\n页面功能出现异常，请刷新后再试。',
      meta: { error: true, errorSource: ERROR_SOURCE.PROJECT, detail: extraMsg || '' }
    };
  }

  async function send({ text, channel, contactId, systemPrompt, maxChars, turnId, max_tokens } = {}) {
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
      maxChars: maxChars || 40000,
    });


    // ===== Memory prompt UI (v1, with global switch) =====
    try {
      const flags = window.__YBM_FEATURE_FLAGS__;
      const store = window.__YBM_MEMORY_STORE__;
      const modal = window.__YBM_MEMORY_MODAL__;
      const result = __memoryResult;

      if (
        flags?.memoryEnabled !== false &&
        result?.shouldPrompt &&
        modal &&
        store &&
        !store.hasSkipped(contactId, result.turnCount)
      ) {
        const confirmModal = window.__YBM_MEMORY_CONFIRM_MODAL__;

        confirmModal?.show({
          summaryRangeText: `将生成第 ${result.summaryRange.from}–${result.summaryRange.to} 轮的长期摘要`,
          onConfirm() {
            console.log('[Memory] user confirmed, start generating summary');

            // 👉 这里只做一件事：开始生成摘要
            window.__YBM_MEMORY__?.MemoryManager.generateSummary({
              contactId,
              range: result.summaryRange
            });
          },
          onSkip() {
            store.markSkipped(contactId, result.turnCount);
            console.log('[Memory] user skipped at turn', result.turnCount);
          }
        });

      }
    } catch (e) {
      console.warn('[Memory] modal error:', e);
    }


    // ✅ assistant 也必须写 turnId
    const assistantMsg = appendMessage({ contactId, channel, role: 'assistant', content: '', turnId: tid });

    try {
      // ✅ F12 查看本次真实发送给模型的 messages（含 system/worldbook/preset/历史）
      debugDumpLLMRequest({ tag: `send:${channel}`, api, messages: ctx });

      let reply = '';
      try {
        reply = await callChatCompletions({
          baseUrl: api.baseUrl,
          apiKey: api.apiKey,
          model: api.model,
          messages: ctx,
          stream: false,
          max_tokens,
        });
      } catch (e) {
        // ✅ chat 端最常见的 400：反代网关对“上下文/体积”更敏感
        // 直接自动降上下文重试两档：8000 -> 4000
        const status = e?.status;
        const provider = detectProvider({ model: api.model, baseUrl: api.baseUrl });

        if (channel === 'main' && status === 400 && provider === 'anthropic') {
          console.warn('[LLM] 400 on main, retry with shorter context…');

          const sys2 = buildSystemPromptFromCfg(contactId, channel);

          const ctx8000 = buildContext({
            contactId,
            systemPrompt: sys2,
            maxChars: 8000,
          });

          try {
            reply = await callChatCompletions({
              baseUrl: api.baseUrl,
              apiKey: api.apiKey,
              model: api.model,
              messages: ctx8000,
              stream: false,
              max_tokens,
            });
          } catch (e2) {
            const status2 = e2?.status;
            if (status2 === 400) {
              const ctx4000 = buildContext({
                contactId,
                systemPrompt: sys2,
                maxChars: 4000,
              });
              reply = await callChatCompletions({
                baseUrl: api.baseUrl,
                apiKey: api.apiKey,
                model: api.model,
                messages: ctx4000,
                stream: false,
                max_tokens,
              });
            } else {
              throw e2;
            }
          }
        } else {
          throw e;
        }
      }


      // ===========================
      // ✅ 关键：phone 先剃 think，再截断，再判不合规改写
      // ===========================
      if (channel === 'phone') {
        // 1) 先剃 think，避免 think 抢占 600 截断配额
        let out = stripThinking(reply || '');

        // 2) 再截断（对剃过 think 的正文截断更稳定）
        out = postProcessAssistantText(out, channel);

        // 3) 不合规就走改写器（永远回到短信格式）
        if (needSmsRewrite(out)) {
          try {
            const repaired = await rewriteToSms({
              api,
              userText: text,
              badAssistantText: reply || out
            });
            if (repaired) out = repaired;
          } catch {
            // 改写失败也至少保证不出 think
            out = stripThinking(out);
          }
        }

        assistantMsg.content = out;
        save();
        return assistantMsg;
      }

      const cleaned = stripThinking(reply || '');
      assistantMsg.content = postProcessAssistantText(cleaned, channel);
      save();

      // ===== Memory prompt AFTER assistant reply (v2) =====
      try {
        const flags = window.__YBM_FEATURE_FLAGS__;
        const mem = window.__YBM_MEMORY__?.MemoryManager;
        const store = window.__YBM_MEMORY_STORE__;
        const confirmModal = window.__YBM_MEMORY_CONFIRM_MODAL__;

        if (flags?.memoryEnabled !== false && mem && channel === 'main') {
          const result = mem.checkShouldPrompt({
            allMessages: state.messages[contactId],
            contactId
          });
          console.log('[Memory]', result);

          if (
            result?.shouldPrompt &&
            result?.summaryRange?.from != null &&
            result?.summaryRange?.to != null &&
            confirmModal &&
            store &&
            !store.hasSkipped(contactId, result.turnCount)
          ) {
            // 给 UI 一点时间先把 assistant 渲染出来
            setTimeout(() => {
              confirmModal.show({
                summaryRangeText: `将生成第 ${result.summaryRange.from}–${result.summaryRange.to} 轮的长期摘要（触发点：第 ${result.turnCount} 轮）`,
                onConfirm() {
                  console.log('[Memory] user confirmed, start generating summary');
                  mem.generateSummary({
                    contactId,
                    range: result.summaryRange,
                    allMessages: state.messages[contactId]
                  });
                },
                onSkip() {
                  store.markSkipped(contactId, result.turnCount);
                  console.log('[Memory] user skipped at turn', result.turnCount);
                }
              });
            }, 50);
          }
        }
      } catch (e) {
        console.warn('[Memory] after-reply hook error:', e);
      }

      return assistantMsg;


      // ===== Memory auto flow (v1 minimal) =====
      try {
        const flags = window.__YBM_FEATURE_FLAGS__;
        const mem = window.__YBM_MEMORY__?.MemoryManager;

        if (flags?.memoryEnabled !== false && mem && channel === 'main') {
          const result = mem.checkShouldPrompt({
            allMessages: messages,
            contactId
          });

          if (result?.shouldPrompt && result?.summaryRange?.from && result?.summaryRange?.to) {
            const store = window.__YBM_SUMMARY_STORE__;
            const turnKey = result.turnCount;

            // 有 store 就用 store 记 skip；没有也不影响流程
            const skipped = store?.hasSkipped?.(contactId, turnKey);

            if (!skipped) {
              const ok = window.confirm(
                `需要生成长期摘要吗？\n` +
                `本次将总结第 ${result.summaryRange.from}-${result.summaryRange.to} 轮（触发点：第 ${result.turnCount} 轮）`
              );

              if (ok) {
                console.log('[Memory] user confirmed, generating summary (fake)...');

                // ✅ 先用假生成跑通流程（下一步再接真实 LLM）
                const fakeSummary =
                  `【测试摘要】\n` +
                  `总结范围：${result.summaryRange.from}-${result.summaryRange.to}\n` +
                  `触发轮次：${result.turnCount}\n` +
                  `（下一步接真实模型生成）`;

                // 保存
                store?.setSummary?.(contactId, fakeSummary);
                console.log('[Memory] summary generated & saved (fake)');

                // 如果你想弹出你那个编辑弹窗（你本地已经有 __YBM_MEMORY_MODAL__）
                window.__YBM_MEMORY_MODAL__?.show?.({
                  initialText: fakeSummary,
                  onSave(text) {
                    store?.setSummary?.(contactId, text);
                    console.log('[Memory] summary saved');
                  },
                  onSkip() {
                    store?.markSkipped?.(contactId, turnKey);
                    console.log('[Memory] edit skipped');
                  },
                  onRegenerate(prev) {
                    return prev + '\n\n【重新生成】（测试）';
                  }
                });

              } else {
                store?.markSkipped?.(contactId, turnKey);
                console.log('[Memory] user skipped at turn', turnKey);
              }
            }
          }
        }
      } catch (e) {
        console.warn('[Memory] modal error:', e);
      }

      return assistantMsg;


    } catch (e) {
      const p = buildErrorAssistantPayload(ERROR_SOURCE.API, e?.message || String(e));
      assistantMsg.content = p.content;
      assistantMsg.meta = p.meta;
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
