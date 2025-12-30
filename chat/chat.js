(() => {
  // ===== contacts =====
  const CONTACTS_DEF = [
    { id: 'ybm', name: '岩白眉' },
    { id: 'caishu', name: '猜叔' },
    { id: 'dantuo', name: '但拓' },
    { id: 'zhoubin', name: '州槟' },
  ];

  // ===== utils =====
  function qs(id) { return document.getElementById(id); }

  // 兼容：点在文字/emoji 上时 e.target 可能是 Text 节点，Text 没有 closest()
  function $closest(target, selector) {
    const el = (target && target.nodeType === 3) ? target.parentElement : target;
    return el && el.closest ? el.closest(selector) : null;
  }
  function autoGrow(el, maxH = 140) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
  }

  function sanitizeModelText(text) {
    let out = String(text ?? '');
    out = out.replace(/<think>[\s\S]*?<\/think>/gi, '');
    out = out.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '');
    out = out.replace(/^\s*<think>[\s\S]*$/i, '').trim();
    return out;
  }

  function applyRenderRegex(text) {
    let out = String(text ?? '');
    try {
      const raw = localStorage.getItem('YBM_REGEX_CFG_V1');
      if (!raw) return out;
      const cfg = JSON.parse(raw);
      if (!cfg || cfg.enabled === false) return out;
      const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
      for (const r of rules) {
        if (!r || !r.enabled || !r.pattern) continue;
        try {
          const re = new RegExp(r.pattern, r.flags || 'g');
          out = out.replace(re, r.replace ?? '');
        } catch { }
      }
    } catch { }
    return out;
  }

  function getUserDisplayName() {
    const keys = ['YBM_USER_PROFILE_V1', 'YBM_PERSONA_V1', 'YBM_PROFILE_V1', 'YBM_USER_V1'];
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const obj = JSON.parse(raw);
        const name = (obj?.name || obj?.username || obj?.userName || obj?.displayName || '').trim();
        if (name) return name;
      } catch { }
    }
    return 'user';
  }
// ===== avatar (upload + persist) =====
const AVA_KEY_PREFIX = 'YBM_AVATAR_V1_'; // e.g. YBM_AVATAR_V1_me / YBM_AVATAR_V1_caishu

function getAvatarKey(id){ return AVA_KEY_PREFIX + String(id || 'me'); }

function getStoredAvatar(id){
  try { return localStorage.getItem(getAvatarKey(id)) || ''; } catch { return ''; }
}

function setStoredAvatar(id, dataUrl){
  try {
    if (!dataUrl) localStorage.removeItem(getAvatarKey(id));
    else localStorage.setItem(getAvatarKey(id), dataUrl);
  } catch (e) {
    alert('头像保存失败：localStorage 空间不足。请换小一点的图片。');
    throw e;
  }
}

// 把任意图片压成方形 dataURL（默认 256x256，够清晰又不大）
async function fileToSquareDataURL(file, size = 256, quality = 0.86){
  const img = new Image();
  const url = URL.createObjectURL(file);

  await new Promise((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('image load failed'));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const side = Math.min(w, h);
  const sx = Math.floor((w - side) / 2);
  const sy = Math.floor((h - side) / 2);

  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  URL.revokeObjectURL(url);

  // png 会很大，优先 jpeg
  return canvas.toDataURL('image/jpeg', quality);
}

// 给 <img> 安全设置头像：优先使用用户上传，其次尝试静态文件，最后隐藏
function applyAvatarToImg(avaImg, role, cid){
  const id = (role === 'me') ? 'me' : (cid || 'ybm');
  const stored = getStoredAvatar(id);

  // 统一的 fallback：失败就隐藏并移除 src，避免 404 刷屏
  avaImg.onerror = () => {
    avaImg.removeAttribute('src');
    avaImg.style.display = 'none';
  };
  avaImg.onload = () => { avaImg.style.display = 'block'; };

  if (stored) {
    avaImg.src = stored;
    return;
  }

  // 没有上传头像：me 默认不显示；assistant 尝试 ./assets/avatars/${cid}.png
  if (role === 'me') {
    avaImg.removeAttribute('src');
    avaImg.style.display = 'none';
    return;
  }

  avaImg.src = `./assets/avatars/${cid || 'ybm'}.png`; // 不存在会走 onerror 自动隐藏
}

  function injectPolishOnce() {
    // 已迁移到 chat.css：避免 JS 注入样式覆盖 CSS，防止后续维护混乱
  }


  function setSendingState(isSending) {
    const send = qs('chatSend');
    const input = qs('chatInput');
    if (!send) return;
    send.disabled = !!isSending;
    if (input) input.disabled = !!isSending;

    if (isSending) {
      send.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"></rect>
        </svg>`;
      send.title = '正在等待回复…';
      return;
    }

    send.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.4 11.2 20.6 3.8c.8-.3 1.6.5 1.3 1.3l-7.4 17.2c-.3.8-1.5.8-1.8 0l-2.2-5.2-5.2-2.2c-.8-.3-.8-1.5 0-1.8Z"
          fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M10.6 13.4 20.2 4.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`;
    send.title = '发送';
  }

  function smartScrollToBottom(box, force = false) {
    if (!box) return;
    if (!force) {
      const dist = box.scrollHeight - box.scrollTop - box.clientHeight;
      if (dist > 160) return;
    }
    const doScroll = () => {
      const last = box.lastElementChild;
      if (last?.scrollIntoView) last.scrollIntoView({ block: 'end' });
      box.scrollTop = box.scrollHeight;
    };
    doScroll();
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 80);
  }

  // ===== phone overlay =====
  function setOpenByIdAll(id, open) {
    const nodes = document.querySelectorAll(`#${id}`);
    nodes.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.dataset.open = open ? 'true' : 'false';
      el.setAttribute('aria-hidden', open ? 'false' : 'true');
    });
  }
function ensurePhoneOverlayDOM() {
  // 遮罩
  if (!document.getElementById('phoneMask')) {
    const mask = document.createElement('div');
    mask.id = 'phoneMask';
    mask.className = 'phoneMask';
    mask.dataset.open = 'false';
    mask.setAttribute('aria-hidden', 'true');
    document.body.appendChild(mask);
  }

  // 容器
  if (!document.getElementById('phoneOverlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'phoneOverlay';
    overlay.className = 'phoneOverlay';
    overlay.dataset.open = 'false';
    overlay.setAttribute('aria-hidden', 'true');

    overlay.innerHTML = `<div id="miniPhoneMount" class="miniPhoneMount"></div>`;
    document.body.appendChild(overlay);

    // ✅ 新增：只在创建时绑定一次拖动
    enableOverlayDrag(overlay);
  }
}

function openPhone() {
  ensurePhoneOverlayDOM();
  setOpenByIdAll('phoneOverlay', true);
  setOpenByIdAll('phoneMask', true);
}

function closePhone() {
  setOpenByIdAll('phoneOverlay', false);
  setOpenByIdAll('phoneMask', false);
}
function enableOverlayDrag(overlay){
  if (!overlay) return;

  // 只在电脑端启用
  if (!window.matchMedia('(pointer: fine)').matches) return;

  if (overlay.dataset.dragBound) return;
  overlay.dataset.dragBound = '1';

  let dragging = false;
  let startX = 0, startY = 0;
  let baseLeft = 0, baseTop = 0;

  // 用 left/top 定位，方便拖动
  overlay.style.right = 'auto';
  overlay.style.bottom = 'auto';
  overlay.style.left = overlay.style.left || '16px';
  overlay.style.top  = overlay.style.top  || '64px';

  overlay.addEventListener('mousedown', (e) => {
    // 点在图标/按钮/输入框上不拖，避免影响 app 点击
if ($closest(e.target, 'img,button,input,textarea,select,a')) return;


    const r = overlay.getBoundingClientRect();
    baseLeft = r.left;
    baseTop = r.top;
    startX = e.clientX;
    startY = e.clientY;

    dragging = true;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    overlay.style.left = `${baseLeft + dx}px`;
    overlay.style.top  = `${baseTop + dy}px`;
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
  });
}

  // ===== load mini_phone module once =====
  function ensureMiniPhoneLoaded() {
    return new Promise((resolve) => {
      if (window.MiniPhone?.open) return resolve(true);

      const existed = document.querySelector('script[data-mini-phone="1"]');
      if (existed) {
        // 可能正在加载
        existed.addEventListener('load', () => resolve(true), { once: true });
        existed.addEventListener('error', () => resolve(false), { once: true });
        return;
      }

      const s = document.createElement('script');
      s.type = 'module';
      s.src = new URL('./mini_phone/mini_phone.js?v=2', document.baseURI).href;
      s.dataset.miniPhone = '1';
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.body.appendChild(s);
    });
  }

  // ===== engine helpers =====
  function ensureDefaultContacts(engine) {
    if (!engine?.listContacts || !engine?.addContact) return;
    const existing = engine.listContacts() || [];
    const have = new Set(existing.map(c => c.id));
    for (const c of CONTACTS_DEF) if (!have.has(c.id)) engine.addContact(c);
    if (!engine.getActiveContact?.()) engine.setActiveContact?.('ybm');
  }

  function getActiveContactName(engine) {
    const id = engine.getActiveContact?.() || 'ybm';
    const list = engine.listContacts?.() || [];
    const c = list.find(x => x.id === id) || CONTACTS_DEF.find(x => x.id === id) || { id, name: id };
    return c.name || c.id;
  }

  function mountContactBar(engine) {
    const titlebar = document.querySelector('.chatTitlebar');
    if (!titlebar) return;
    if (document.getElementById('chatContactBar')) return;

    const bar = document.createElement('div');
    bar.className = 'chatContactBar';
    bar.id = 'chatContactBar';

    const cur = engine.getActiveContact?.() || 'ybm';

    for (const c of CONTACTS_DEF) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chatChip' + (c.id === cur ? ' active' : '');
      btn.dataset.cid = c.id;

      const dot = document.createElement('span');
      dot.className = 'chatChipDot';
      const label = document.createElement('span');
      label.textContent = c.name;

      btn.appendChild(dot);
      btn.appendChild(label);

      btn.addEventListener('click', () => {
        engine.setActiveContact?.(c.id);
        bar.querySelectorAll('.chatChip').forEach(el => {
          el.classList.toggle('active', el.dataset.cid === c.id);
        });
        renderHistory(engine);
      });

      bar.appendChild(btn);
    }

    titlebar.insertAdjacentElement('afterend', bar);
  }

  
// ===== intro bubble (persist + editable/deletable) =====
const INTRO_KEY_PREFIX = 'YBM_CHAT_INTRO_V1_'; // per contact: YBM_CHAT_INTRO_V1_ybm
function getIntroKey(contactId){ return INTRO_KEY_PREFIX + String(contactId || 'default'); }

function loadIntro(contactId){
  try { return JSON.parse(localStorage.getItem(getIntroKey(contactId)) || 'null'); } catch { return null; }
}
function saveIntro(contactId, obj){
  try { localStorage.setItem(getIntroKey(contactId), JSON.stringify(obj || null)); } catch {}
}
function clearIntro(contactId){
  try { localStorage.removeItem(getIntroKey(contactId)); } catch {}
}

function clearAllIntros(){
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(INTRO_KEY_PREFIX)) localStorage.removeItem(k);
    }
  } catch {}
}

// 初始化：只在“从未初始化过”时写入；用户删除后会写 deleted:true，不会再自动复活（除非清空聊天）
function ensureIntro(contactId, contactName){
  const cur = loadIntro(contactId);
  if (cur && (cur.inited || cur.deleted)) return;

  const text = [
    `【${contactName || '对话'}】`,
    '这不是命令窗口，是一段正在发生的故事。',
    '你可以直接开口，也可以先问一句：现在我该怎么做？'
  ].join('\n');

  const introMsg = {
    id: 'intro_' + String(contactId || 'default'),
    role: 'assistant',
    content: text,
    createdAt: Date.now(),
    inited: true
  };
  saveIntro(contactId, introMsg);
}

// ===== message actions icons =====
  function iconEdit() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h4l11-11-4-4L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M13 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`;
  }
  function iconTrash() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7h10l-1 14H8L7 7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M9 7V5.6c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6V7" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <path d="M5 7h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`;
  }
  function iconReroll() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 12a8 8 0 1 1-2.3-5.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M20 4v6h-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
  }

  // ===== render =====
  function clearChatUI() {
    const box = qs('chatMessages');
    if (box) box.innerHTML = '';
  }

  function pushMsg(engine, msg, isLastAssistant) {
    const box = qs('chatMessages');
    if (!box) return;

    const role = msg.role === 'user' ? 'me' : 'assistant';
    const contactId = engine.getActiveContact?.() || 'ybm';
    const isIntro = String(msg?.id || '').startsWith('intro_');

    // ===== 外层 item：名字在外面 =====
    const item = document.createElement('div');
    item.className = 'chatItem' + (role === 'me' ? ' me' : ' assistant');
    item.dataset.msgId = msg.id;
    item.dataset.role = msg.role;

// ===== 气泡头部：头像+名字(左) + 操作键(右) =====
const head = document.createElement('div');
head.className = 'chatHead';

const whoLeft = document.createElement('div');
whoLeft.className = 'chatWhoLeft';

// 头像（user/assistant 都显示；没有就自动隐藏）
const ava = document.createElement('div');
ava.className = 'chatAva';

const avaImg = document.createElement('img');
avaImg.alt = '';
const cid = engine.getActiveContact?.() || 'ybm';

// ✅ 统一头像策略：优先用户上传（localStorage），其次静态文件，不存在自动隐藏（不会 404 刷屏）
applyAvatarToImg(avaImg, role, cid);

// 如果图片最终被隐藏，就把容器也隐藏掉（更干净）
const _oldOnErr = avaImg.onerror;
avaImg.onerror = () => { _oldOnErr && _oldOnErr(); ava.style.display = 'none'; };
avaImg.onload  = () => { ava.style.display = 'block'; };
ava.appendChild(avaImg);


// 名字
const who = document.createElement('div');
who.className = 'chatWho';
who.textContent = (role === 'me') ? getUserDisplayName() : getActiveContactName(engine);

whoLeft.appendChild(ava);
whoLeft.appendChild(who);

// 右侧操作区
const ops = document.createElement('div');
ops.className = 'chatOps';

head.appendChild(whoLeft);
head.appendChild(ops);


    // ===== 卡片本体 =====
    const wrap = document.createElement('div');
    wrap.className = 'chatMsg' + (role === 'me' ? ' me' : '');
    wrap.dataset.msgId = msg.id;
    wrap.dataset.role = msg.role;

    // 顶部只放操作按钮（不再放名字）
    const meta = document.createElement('div');
    meta.className = 'chatMeta';

    const actions = document.createElement('div');
    actions.className = 'msgActions';

    // 编辑
    const btnEdit = document.createElement('button');
    btnEdit.type = 'button';
    btnEdit.className = 'msgActBtn';
    btnEdit.title = '编辑';
    btnEdit.innerHTML = iconEdit();

    // 删除
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'msgActBtn';
    btnDel.title = '删除';
    btnDel.innerHTML = iconTrash();
    // ✅ 用委托处理删除：避免有时 DOM 重新渲染导致按钮“点不动”
    btnDel.dataset.act = 'del';
    btnDel.dataset.msgId = msg.id;

    // 重roll：只允许最后一条 assistant
    let btnReroll = null;
    if (msg.role === 'assistant' && isLastAssistant) {
      btnReroll = document.createElement('button');
      btnReroll.type = 'button';
      btnReroll.className = 'msgActBtn';
      btnReroll.title = '重roll（仅最后一条）';
      btnReroll.innerHTML = iconReroll();
      actions.appendChild(btnReroll);
    }

actions.appendChild(btnEdit);
actions.appendChild(btnDel);

// ✅ 操作键放到气泡头部右侧
ops.appendChild(actions);



    // 内容（注意：不要再用 chatBody 这个 class，避免和页面容器 .chatBody 撞名）
    const body = document.createElement('div');
    body.className = 'chatText';
    body.textContent = applyRenderRegex(sanitizeModelText(msg.content || ''));

// ✅ 气泡顶部先放 head（名字+头像+操作键）
wrap.appendChild(head);

// meta 这行你可以保留当“占位容器”，也可以直接不 append
// wrap.appendChild(meta);

wrap.appendChild(body);

// ✅ 不再把 tag 放在外面了
item.appendChild(wrap);

    box.appendChild(item);

    // ===== handlers =====
    // 删除按钮 click 由 initChat 里的委托统一处理

    btnEdit.addEventListener('click', () => {
      const oldText = msg.content || '';

      if (document.getElementById('chatEditModal')) return;

      const mask = document.createElement('div');
      mask.id = 'chatEditMask';
      mask.className = 'chatEditMask';

      const modal = document.createElement('div');
      modal.id = 'chatEditModal';
      modal.className = 'chatEditModal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');

      const header = document.createElement('div');
      header.className = 'chatEditHeader';

      const title = document.createElement('div');
      title.className = 'chatEditTitle';
      title.textContent = `编辑：${msg.role === 'user' ? getUserDisplayName() : getActiveContactName(engine)}`;

      const btnOk = document.createElement('button');
      btnOk.type = 'button';
      btnOk.className = 'chatEditIcon ok';
      btnOk.title = '保存（Ctrl/Cmd + Enter）';
      btnOk.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 6 9.5 17 4 11.5" fill="none" stroke="currentColor" stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;

      const btnX = document.createElement('button');
      btnX.type = 'button';
      btnX.className = 'chatEditIcon cancel';
      btnX.title = '取消（Esc）';
      btnX.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6 18 18M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2"
          stroke-linecap="round"/>
      </svg>`;

      const right = document.createElement('div');
      right.className = 'chatEditHeaderRight';
      right.appendChild(btnOk);
      right.appendChild(btnX);

      header.appendChild(title);
      header.appendChild(right);

      const area = document.createElement('textarea');
      area.className = 'chatEditArea';
      area.value = oldText;

      modal.appendChild(header);
      modal.appendChild(area);

      document.body.appendChild(mask);
      document.body.appendChild(modal);
      document.body.classList.add('chat-editing');

      const cleanup = () => {
        document.body.classList.remove('chat-editing');
        mask.remove();
        modal.remove();
      };

      const save = () => {
        const newText = (area.value || '').trim();
        if (isIntro) {
          const cur = loadIntro(contactId) || msg;
          saveIntro(contactId, { ...cur, content: newText, deleted: false, inited: true });
        } else {
          engine.updateMessage?.({ contactId, msgId: msg.id, content: newText });
        }
        cleanup();
        renderHistory(engine);
      };

      mask.addEventListener('click', cleanup);
      btnX.addEventListener('click', cleanup);
      btnOk.addEventListener('click', save);

      area.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(); return; }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
      });

      requestAnimationFrame(() => {
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
      });
    });

    if (btnReroll) {
      btnReroll.addEventListener('click', async () => {
        setSendingState(true);
        try {
          await engine.rerollLastAssistant?.({ contactId, channel: 'main' });
          renderHistory(engine);
        } finally {
          setSendingState(false);
        }
      });
    }
  }

  function renderHistory(engine) {
    const box = qs('chatMessages');
    if (!box) return;

    clearChatUI();

    const contactId = engine.getActiveContact?.() || 'ybm';
    const contactName = (engine.listContacts?.() || []).find(c => c.id === contactId)?.name || contactId;

    // 默认开场白：写进本地存储，渲染时作为第一条消息（可编辑/可删除）
    ensureIntro(contactId, contactName);

    const intro = loadIntro(contactId);
    const msgs = engine.getMessages?.({ contactId, channel: 'main' }) || [];

    // 找到最后一条 assistant（只对它显示重roll）
    let lastAssistantId = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'assistant') { lastAssistantId = msgs[i].id; break; }
    }


    // 先渲染开场白（不参与重roll判定）
    if (intro && !intro.deleted && (intro.content || '').trim()) {
      pushMsg(engine, intro, false);
    }

    for (const m of msgs) {
      if (!m) continue;
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      pushMsg(engine, m, m.id === lastAssistantId);
    }

    smartScrollToBottom(box, true);
  }

function ensureClearModalDOM() {
  // 如果没有，就动态创建，避免“点了没反应”
  if (!qs('chatClearMask')) {
    const mask = document.createElement('div');
    mask.id = 'chatClearMask';
    mask.className = 'chatClearMask';
    mask.style.display = 'none';
    mask.setAttribute('aria-hidden', 'true');
    document.body.appendChild(mask);
  }

  if (!qs('chatClearModal')) {
    const modal = document.createElement('div');
    modal.id = 'chatClearModal';
    modal.className = 'chatClearModal';
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="chatClearCard" role="dialog" aria-modal="true">
        <div class="chatClearTitle">清空聊天</div>
        <div class="chatClearBtns">
          <button id="chatClearCurrent" type="button">清空当前</button>
          <button id="chatClearAll" type="button">全清</button>
          <button id="chatClearCancel" type="button">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
}

function openClearModal() {
  ensureClearModalDOM();

  const mask = qs('chatClearMask');
  const modal = qs('chatClearModal');
  if (!mask || !modal) return;

  mask.style.display = 'block';
  modal.style.display = 'flex';

  // ✅ 关键：配合 chat.css 的 data-open
  modal.dataset.open = 'true';

  mask.setAttribute('aria-hidden', 'false');
  modal.setAttribute('aria-hidden', 'false');
}

function closeClearModal() {
  const mask = qs('chatClearMask');
  const modal = qs('chatClearModal');
  if (!mask || !modal) return;

  // ✅ 关键：关掉 data-open
  modal.dataset.open = 'false';

  mask.style.display = 'none';
  modal.style.display = 'none';

  mask.setAttribute('aria-hidden', 'true');
  modal.setAttribute('aria-hidden', 'true');
}

  // ===== mount chat.html into #mountChat =====
  async function ensureMounted() {
    const mount = document.getElementById('mountChat');
    if (!mount) {
      console.error('[chat] #mountChat not found in index.html');
      return false;
    }

    const engine = window.PhoneEngine || window.ChatEngine;
    if (!engine) {
      console.error('[chat] PhoneEngine not loaded. Add <script src="./phone/phoneEngine.js"></script> before chat.js');
      return false;
    }

// ✅ 只要 mount 里还没有 chatWindow，就加载 chat.html
if (!mount.querySelector('.chatWindow')) {
  try {
    const url = new URL('./chat/chat.html', document.baseURI).href;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('chat.html fetch failed: ' + resp.status);

    mount.innerHTML = await resp.text();

    // ✅ 校验：没有输入框就报警（不阻断）
    if (!mount.querySelector('#chatInput')) {
      console.error('[chat] mounted html has no #chatInput. First 300 chars:\n', mount.innerHTML.slice(0, 300));
    }
  } catch (e) {
    console.error('[chat] cannot load ./chat/chat.html', e);
    return false;
  }
}


    initChat(engine);
    return true;

  }

  function initChat(engine) {
    window.ChatEngine = engine;

    injectPolishOnce();
    setSendingState(false);

    ensureDefaultContacts(engine);
    mountContactBar(engine);
    renderHistory(engine);

    // ✅ 删除按钮委托（chatMessages 会频繁 innerHTML 重建，用委托更稳）
    const msgBox = qs('chatMessages');
    if (msgBox && !msgBox.dataset.delBound) {
      msgBox.dataset.delBound = '1';
      msgBox.addEventListener('click', (e) => {
        const btn = $closest(e.target, 'button.msgActBtn[data-act="del"]');
        if (!btn) return;
        const msgId = btn.dataset.msgId || $closest(btn, '.chatItem')?.dataset.msgId || '';
        if (!msgId) return;
        const contactId = engine.getActiveContact?.() || 'default';
        if (!confirm('删除这条消息？')) return;

        // 开场白（intro_）走本地存储：删除后不再自动生成，除非清空聊天
        if (String(msgId).startsWith('intro_')) {
          const cur = loadIntro(contactId) || { id: msgId, role: 'assistant', content: '' };
          saveIntro(contactId, { ...cur, deleted: true, inited: true });
        } else {
          engine.deleteMessage?.({ contactId, msgId });
        }

        renderHistory(engine);
      });
    }

    if (!document.documentElement.dataset.chatChangeBound) {
      document.documentElement.dataset.chatChangeBound = '1';
      engine.onChange?.((type) => {
        if (type === 'reload' || type === 'save') renderHistory(engine);
      });
    }


    // 输入
    const input = qs('chatInput');
    const send = qs('chatSend');

    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('input', () => autoGrow(input, 140));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send?.click();
        }
      });
    }

    // 发送
    if (send && !send.dataset.bound) {
      send.dataset.bound = '1';
      send.addEventListener('click', async () => {
        const t = (input?.value || '').trim();
        if (!t) return;

        input.value = '';
        autoGrow(input, 140);

        setSendingState(true);
        try {
          await engine.send?.({ text: t, channel: 'main' });
          renderHistory(engine);
        } catch (e) {
          console.error(e);
          alert('请求失败：请检查 API 设置');
        } finally {
          setSendingState(false);
        }
      });
    }

document.addEventListener('click', async (e) => {
  const btn = $closest(e.target, '#chatDeviceBtn');
  if (!btn) return;

  // ✅ 先确保 phoneOverlay/phoneMask/miniPhoneMount 存在
  ensurePhoneOverlayDOM();

  const ok = await ensureMiniPhoneLoaded();
  if (!ok) {
    console.warn('[mini_phone] load failed');
    alert('小手机模块加载失败：请打开F12看 Console 的红色报错（一般是路径/404）');
    return;
  }

  // ✅ 只让 mini_phone 自己负责 open/close（不要再叠一层 openPhone）
  await window.MiniPhone?.open?.();
}, true);


// 关闭 mini_phone：用委托（phoneMask 是动态创建的）
if (!document.documentElement.dataset.phoneMaskBound) {
  document.documentElement.dataset.phoneMaskBound = '1';

  document.addEventListener('click', (e) => {
    if (!$closest(e.target, '#phoneMask')) return;
    window.MiniPhone?.close?.();
  }, true);
}

// ✅ 返回键：不要放在 phoneMaskBound 里，否则第二次进来就不绑定了
const back = qs('chatBack');
if (back && !back.dataset.bound) {
  back.dataset.bound = '1';
  back.textContent = '返回';
  back.addEventListener('click', () => {
    if (window.PhoneEngine?.goHome) { window.PhoneEngine.goHome(); return; }
    if (window.PhoneEngine?.navigate) { window.PhoneEngine.navigate('home'); return; }
    history.back();
  });
}

// ✅ 清空：也不要放在 phoneMaskBound 里
if (!document.documentElement.dataset.chatClearBound) {
  document.documentElement.dataset.chatClearBound = '1';

  document.addEventListener('click', (e) => {
    if ($closest(e.target, '#chatClearBtn')) {
      openClearModal();
      return;
    }
    if ($closest(e.target, '#chatClearCancel')) {
      closeClearModal();
      return;
    }
    if ($closest(e.target, '#chatClearMask')) {
      closeClearModal();
      return;
    }
    if ($closest(e.target, '#chatClearCurrent')) {
      const contactId = engine.getActiveContact?.() || 'default';
      if (!confirm('清空当前联系人的聊天记录？')) return;
      engine.clearMessages?.({ contactId });
      clearIntro(contactId);
      closeClearModal();
      renderHistory(engine);
      return;
    }
    if ($closest(e.target, '#chatClearAll')) {
      if (!confirm('全清：清空所有联系人的聊天记录，确认继续？')) return;
      engine.clearAllMessages?.();
      clearAllIntros();
      closeClearModal();
      renderHistory(engine);
      return;
    }
  }, true);
}

  }

// expose
window.AvatarKit = {
  getStoredAvatar,
  setStoredAvatar,
  fileToSquareDataURL,
  applyAvatarToImg,
};

window.ChatUI = { ensureMounted };


  // auto
  ensureMounted();
})();
