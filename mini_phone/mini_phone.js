// mini_phone/mini_phone.js (module) — safe & stable (FULL REPLACE)

const CSS_URL = new URL('./mini_phone.css?v=4', import.meta.url).href;
const HTML_URL = new URL('./mini_phone.html?v=4', import.meta.url).href;
const MINI_PRESETS_JSON_URL = new URL('./default_mini_presets.json?v=1', import.meta.url).href;

function ensureCss() {
  if (document.querySelector('link[data-mini-phone-css="1"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_URL;
  link.dataset.miniPhoneCss = '1';
  document.head.appendChild(link);
}

// ===== constants =====
const MOUNT_ID = 'miniPhoneMount';
const OVERLAY_ID = 'phoneOverlay';
const MASK_ID = 'phoneMask';

// ===== runtime =====
let mounted = false;
let mountedMount = null;

// SMS runtime state
let smsActiveContactId = null;
let smsLastPage = 'list';

// page stack
let mpPageStack = [];
let mpCurrentPage = 'home';

// ===== helpers =====
function byId(id) { return document.getElementById(id); }
async function ensureMiniPresetsSeeded() {
  // 如果已经有新结构，就不动
  try {
    const raw = localStorage.getItem('YBM_MINI_PRESETS_V1');
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && obj.scopes) return;
    }
  } catch {}

  // 兼容：如果旧 key 有内容，也不覆盖（让迁移逻辑去处理）
  try {
    const oldRaw = localStorage.getItem('YBM_MINI_PRESET_V1');
    if (oldRaw) return;
  } catch {}

  // 没有任何 preset -> 灌默认文件
  try {
    const res = await fetch(MINI_PRESETS_JSON_URL);
    if (!res.ok) return;
    const obj = await res.json();
    if (!obj || !obj.scopes) return;
    localStorage.setItem('YBM_MINI_PRESETS_V1', JSON.stringify(obj));
  } catch {}
}

function $closest(target, selector) {
  const el = (target && target.nodeType === 3) ? target.parentElement : target;
  return el && el.closest ? el.closest(selector) : null;
}

function setOpen(id, open) {
  const el = byId(id);
  if (!el) return;
  el.dataset.open = open ? 'true' : 'false';
  el.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function getMount() {
  return byId(MOUNT_ID);
}

function setHome(isHome) {
  const mount = getMount();
  if (!mount) return;

  const shell = mount.querySelector('.phone-shell');
  const backBtn = mount.querySelector('[data-mp-back], .phone-back');
  const menuBtn = mount.querySelector('.phone-menu');

  if (shell) shell.classList.toggle('is-home', !!isHome);

  // ✅ Home 隐藏返回 & 菜单，非 Home 显示
  if (backBtn) backBtn.classList.toggle('hidden', !!isHome);
  if (menuBtn) menuBtn.classList.toggle('hidden', !!isHome);

  // 短信态标记（给 CSS 用）
  const duanxinActive =
    !!mount.querySelector('.page.page-duanxin')?.classList.contains('active');
  if (shell) shell.classList.toggle('is-sms', !isHome && duanxinActive);
}


function showPage(rawName, opts = {}) {
  const { push = true } = opts;

  const mount = getMount();
  if (!mount) return;

  const pages = Array.from(mount.querySelectorAll('.page'));
  if (!pages.length) return;

  let name = String(rawName || '').trim();
  const m = name.match(/\bpage-([a-z0-9_-]+)\b/i);
  if (m && m[1]) name = m[1];
  name = name.replace(/^page-/i, '').trim();
  if (!name) name = 'home';

  const targetClass = `page-${name}`;
  const target = pages.find(p => p.classList.contains(targetClass));
  const finalTarget = target || pages.find(p => p.classList.contains('page-home'));
  const isHome = !!(finalTarget && finalTarget.classList.contains('page-home'));

  // history push
  if (push) {
    const nextKey = isHome ? 'home' : name;
    if (nextKey && nextKey !== mpCurrentPage) {
      mpPageStack.push(mpCurrentPage);
      if (mpPageStack.length > 30) mpPageStack.shift();
    }
  }

  // render
  pages.forEach(p => {
    const on = (p === finalTarget);
    p.classList.toggle('active', on);
    p.style.display = on ? 'block' : 'none';
    p.style.opacity = on ? '1' : '0';
    p.style.pointerEvents = on ? 'auto' : 'none';
    if (on) p.style.transform = 'none';
  });

  mpCurrentPage = isHome ? 'home' : name;

  // set home state
  setHome(isHome);

  // bg switch
  const bgImg = mount.querySelector('.phone-bg');
  if (bgImg) {
    bgImg.src = (name === 'duanxin')
      ? './assets/avatars/beijing2.png'
      : './assets/avatars/beijin.png';
  }

  // ren hide in duanxin
  const ren = mount.querySelector('.phone-ren');
  if (ren) ren.style.display = (name === 'duanxin') ? 'none' : '';

  // clock only on home
  const clockEl = mount.querySelector('.mp-clock');
  if (clockEl) clockEl.style.display = isHome ? '' : 'none';

  // topbar follow
  const topbarEl = mount.querySelector('.mp-topbar');
  if (topbarEl) topbarEl.style.opacity = isHome ? '1' : '0';

  // enter sms page
  if (name === 'duanxin') {
    initSmsSimple(mount);
    setHome(false);
  }
}

// ===== mount & bind =====
async function ensureMounted() {
  ensureCss();

  const mount = getMount();
  if (!mount) return false;

  // mount unchanged -> done
  if (mounted && mount === mountedMount) return true;

  // insert html once
  if (!mount.dataset.mpMounted) {
    const res = await fetch(HTML_URL);
    const html = await res.text();
    mount.innerHTML = html;
    mount.dataset.mpMounted = '1';
  }
    await ensureMiniPresetsSeeded();


  // stage sync (bg actual display rect)
  const syncStageToBg = () => {
    const shell = mount.querySelector('.phone-shell');
    const bg = mount.querySelector('.phone-bg');
    const stage = mount.querySelector('.phone-stage');
    if (!shell || !bg || !stage) return;

    const W = shell.clientWidth;
    const H = shell.clientHeight;

    const iw = bg.naturalWidth || 1;
    const ih = bg.naturalHeight || 1;

    const s = Math.min(W / iw, H / ih);
    const rw = iw * s;
    const rh = ih * s;

    const x = (W - rw) / 2;
    const y = (H - rh) / 2;

    stage.style.setProperty('--stage-x', `${x}px`);
    stage.style.setProperty('--stage-y', `${y}px`);
    stage.style.setProperty('--stage-w', `${rw}px`);
    stage.style.setProperty('--stage-h', `${rh}px`);
  };

  const bg = mount.querySelector('.phone-bg');
  if (bg) {
    if (bg.complete) syncStageToBg();
    else bg.addEventListener('load', syncStageToBg, { once: true });
  }
  if (!mount.dataset.stageResizeBound) {
    mount.dataset.stageResizeBound = '1';
    window.addEventListener('resize', syncStageToBg);
  }

  // initial home
  showPage('home', { push: false });

// bind sms preset manager (☰ menu)
bindSmsPresetMenuOnce(mount);


  // home: switch bar prev/next（✅ 事件委托版：不依赖 mp-panel-body 是否存在）
  if (!mount.dataset.mpSwitchBound) {
    mount.dataset.mpSwitchBound = '1';

    mount.addEventListener('click', (e) => {
      const prev = $closest(e.target, '.mp-prev');
      const next = $closest(e.target, '.mp-next');
      if (!prev && !next) return;

      e.preventDefault();
      e.stopPropagation();

      // 只在 home 生效（避免在别的页误触）
      const homePage = mount.querySelector('.page.page-home');
      if (!homePage || !homePage.classList.contains('active')) return;

      const radios = Array.from(mount.querySelectorAll('input[name="mpTab"]'));
      if (radios.length < 2) return;

      const cur = Math.max(0, radios.findIndex(r => r.checked));
      const dir = prev ? -1 : +1;
      const to = (cur + dir + radios.length) % radios.length;

      // ✅ 找到承载动画的容器（兼容你旧类名）
      const panelBody =
        mount.querySelector('.mp-panel-body') ||
        mount.querySelector('.mp-panel') ||
        mount.querySelector('.mp-card') ||
        mount.querySelector('[data-mp-panel]');

      // ✅ 先清，再触发 reflow，再加方向 class
      if (panelBody) {
        panelBody.classList.remove('slide-left', 'slide-right');
        void panelBody.offsetWidth; // force reflow
        panelBody.classList.add(dir < 0 ? 'slide-left' : 'slide-right');

        // 动画结束后移除
        clearTimeout(panelBody._mpSlideTimer);
        panelBody._mpSlideTimer = setTimeout(() => {
          panelBody.classList.remove('slide-left', 'slide-right');
        }, 640);
      }

      radios[to].checked = true;
      radios[to].dispatchEvent(new Event('change', { bubbles: true }));

    }, true);
  }


  // helper: origin animation point
  function setAppOriginFrom(el) {
    const content = mount.querySelector('.phone-content');
    if (!content || !el) return;

    const iconRect = el.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();

    const cx = (iconRect.left + iconRect.right) / 2 - contentRect.left;
    const cy = (iconRect.top + iconRect.bottom) / 2 - contentRect.top;

    content.style.setProperty('--app-x', `${cx}px`);
    content.style.setProperty('--app-y', `${cy}px`);
  }

  // delegate: click icons -> show page
  if (!mount.dataset.mpNavDelegated) {
    mount.dataset.mpNavDelegated = '1';

    mount.addEventListener('click', (e) => {
      const icon = $closest(e.target, '[data-page]');
      if (!icon) return;

      const page = icon.getAttribute('data-page');
      if (!page) return;

      setAppOriginFrom(icon);
      showPage(page, { push: true });

      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }

  // delegate: back button
  if (!mount.dataset.mpBackDelegated) {
    mount.dataset.mpBackDelegated = '1';

    mount.addEventListener('click', (e) => {
      const hit = $closest(e.target, '[data-mp-back], .phone-back');
      if (!hit) return;

      e.preventDefault();
      e.stopPropagation();

      // sms page?
      const duanxinPage = mount.querySelector('.page.page-duanxin');
      const isDuanxinActive = duanxinPage && duanxinPage.classList.contains('active');

      if (isDuanxinActive) {
        const threadView = duanxinPage.querySelector('[data-sms-view="thread"]');
        const listView = duanxinPage.querySelector('[data-sms-view="list"]');

        // thread -> list
        if (threadView && threadView.classList.contains('active')) {
          showSmsView(mount, 'list');
          return;
        }

        // list -> home
        if (listView && listView.classList.contains('active')) {
          mpPageStack.length = 0;
          mpCurrentPage = 'home';
          showPage('home', { push: false });
          return;
        }
      }

      // other pages -> pop stack
      if (mpPageStack.length) {
        const prev = mpPageStack.pop();
        showPage(prev, { push: false });
        return;
      }
      showPage('home', { push: false });
    }, true);
  }

  // mask click closes
  const mask = byId(MASK_ID);
  if (mask && !mask.dataset.bound) {
    mask.dataset.bound = '1';
    mask.addEventListener('click', () => close());
  }

  mounted = true;
  mountedMount = mount;
  return true;
}

// ===== public open/close =====
export async function open() {
  if (document.readyState === 'loading') {
    await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  }
  const ok = await ensureMounted();
  if (!ok) return;

  setOpen(OVERLAY_ID, true);
  setOpen(MASK_ID, true);
}

export function close() {
  setOpen(OVERLAY_ID, false);
  setOpen(MASK_ID, false);
}

// expose for chat.js
window.MiniPhone = { open, close };

// =========================
// SMS UI (list <-> thread)
// =========================

function q(root, sel) { return root ? root.querySelector(sel) : null; }
function qa(root, sel) { return root ? Array.from(root.querySelectorAll(sel)) : []; }

function showSmsView(mount, view /* 'list' | 'thread' */) {
  const listView = q(mount, '[data-sms-view="list"]');
  const threadView = q(mount, '[data-sms-view="thread"]');
  if (!listView || !threadView) return;

  const isList = view === 'list';
  listView.classList.toggle('active', isList);
  threadView.classList.toggle('active', !isList);

  smsLastPage = view;
}
// =========================
// SMS preset manager (list + import/export/default)
// store into: YBM_PROMPT_CFG_V1 -> presets.sms
// =========================
const PROMPT_CFG_KEY = 'YBM_PROMPT_CFG_V1';
const SMS_PRESET_DEFAULT_URL = new URL('./default_sms_presets.json?v=1', import.meta.url).href;

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}
function uidShort() { return 'p_' + Math.random().toString(36).slice(2, 10); }

function loadPromptCfg() {
  try { return JSON.parse(localStorage.getItem(PROMPT_CFG_KEY) || 'null'); } catch { return null; }
}
function savePromptCfg(cfg) {
  try { localStorage.setItem(PROMPT_CFG_KEY, JSON.stringify(cfg || { version: 1 })); } catch {}
  try { window.PhoneEngine?.reloadFromStorage?.(); } catch {}
}
function ensureSmsPresetArray() {
  let cfg = loadPromptCfg();
  if (!cfg || typeof cfg !== 'object') cfg = { version: 1 };
  if (!cfg.presets || typeof cfg.presets !== 'object') cfg.presets = {};
  if (!Array.isArray(cfg.presets.sms)) cfg.presets.sms = [];
  savePromptCfg(cfg);
  return cfg;
}

function setSmsPresetOpen(mount, open) {
  const overlay = mount.querySelector('[data-mp-sms-preset]');
  if (!overlay) return;
  overlay.dataset.open = open ? 'true' : 'false';
  overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function renderSmsPresetList(mount) {
  const cfg = ensureSmsPresetArray();
  const list = mount.querySelector('[data-mp-sms-list]');
  const empty = mount.querySelector('[data-mp-sms-empty]');
  if (!list || !empty) return;

  const arr = cfg.presets.sms || [];
  list.innerHTML = '';

  if (!arr.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  arr.forEach((p) => {
    if (!p.id) p.id = uidShort();

    const row = document.createElement('div');
    row.className = 'mp-preset-row';
    row.dataset.id = p.id;
    row.dataset.open = 'false';

    row.innerHTML = `
      <div class="mp-preset-top">
        <div class="mp-toggle" data-on="${p.enabled ? 'true' : 'false'}" title="启用/关闭"></div>
        <input class="mp-preset-title-input" value="${escapeHtml(p.title || '')}" placeholder="标题" />
        <div class="mp-row-btns">
          <div class="mp-chip" data-act="edit">编辑</div>
          <div class="mp-chip danger" data-act="del">删除</div>
        </div>
      </div>
      <div class="mp-preset-editor">
        <textarea class="mp-preset-textarea" placeholder="预设内容（会在短信发送时注入）">${escapeHtml(p.content || '')}</textarea>
      </div>
    `;

    // toggle
    row.querySelector('.mp-toggle')?.addEventListener('click', () => {
      p.enabled = !p.enabled;
      row.querySelector('.mp-toggle').dataset.on = p.enabled ? 'true' : 'false';
      savePromptCfg(cfg);
    });

    // edit
    row.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
      row.dataset.open = (row.dataset.open === 'true') ? 'false' : 'true';
    });

    // delete
    row.querySelector('[data-act="del"]')?.addEventListener('click', () => {
      cfg.presets.sms = cfg.presets.sms.filter(x => x && x.id !== p.id);
      savePromptCfg(cfg);
      renderSmsPresetList(mount);
    });

    // title/content update
    row.querySelector('.mp-preset-title-input')?.addEventListener('input', (e) => {
      p.title = e.target.value;
      savePromptCfg(cfg);
    });
    row.querySelector('.mp-preset-textarea')?.addEventListener('input', (e) => {
      p.content = e.target.value;
      savePromptCfg(cfg);
    });

    list.appendChild(row);
  });

  savePromptCfg(cfg);
}

async function loadDefaultSmsPresetsIntoCfg() {
  const cfg = ensureSmsPresetArray();
  try {
    const res = await fetch(SMS_PRESET_DEFAULT_URL);
    if (!res.ok) return;
    const json = await res.json();
    if (json?.presets?.sms && Array.isArray(json.presets.sms)) {
      cfg.presets.sms = json.presets.sms;
      savePromptCfg(cfg);
    }
  } catch {}
}

function exportSmsPresets() {
  const cfg = ensureSmsPresetArray();
  const out = { version: 1, presets: { sms: cfg.presets.sms || [] } };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sms_presets_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

async function importSmsPresetsFromFile(file) {
  if (!file) return;
  const cfg = ensureSmsPresetArray();
  try {
    const text = await file.text();
    const json = JSON.parse(text);

    if (json?.presets?.sms && Array.isArray(json.presets.sms)) {
      cfg.presets.sms = json.presets.sms;
      savePromptCfg(cfg);
      return;
    }
  } catch {}
}

function bindSmsPresetMenuOnce(mount) {
  if (!mount || mount.dataset.mpSmsPresetBound === '1') return;
  mount.dataset.mpSmsPresetBound = '1';

  // 菜单按钮：只在“短信页”打开
  mount.addEventListener('click', (e) => {
    const hitMenu = $closest(e.target, '.phone-menu');
    if (!hitMenu) return;

    const duanxinPage = mount.querySelector('.page.page-duanxin');
    const isSms = !!(duanxinPage && duanxinPage.classList.contains('active'));
    if (!isSms) return; // 现在只有短信接了预设

    e.preventDefault();
    e.stopPropagation();

    renderSmsPresetList(mount);
    setSmsPresetOpen(mount, true);
  }, true);

  // close
  mount.addEventListener('click', (e) => {
    if ($closest(e.target, '[data-mp-sms-close]')) {
      e.preventDefault();
      e.stopPropagation();
      setSmsPresetOpen(mount, false);
    }
  }, true);

  // actions
  mount.addEventListener('click', async (e) => {
    if ($closest(e.target, '[data-mp-sms-load-default]')) {
      e.preventDefault(); e.stopPropagation();
      await loadDefaultSmsPresetsIntoCfg();
      renderSmsPresetList(mount);
      return;
    }
    if ($closest(e.target, '[data-mp-sms-add]')) {
      e.preventDefault(); e.stopPropagation();
      const cfg = ensureSmsPresetArray();
      cfg.presets.sms.unshift({ id: uidShort(), title: '短信预设', content: '', enabled: false });
      savePromptCfg(cfg);
      renderSmsPresetList(mount);
      return;
    }
    if ($closest(e.target, '[data-mp-sms-export]')) {
      e.preventDefault(); e.stopPropagation();
      exportSmsPresets();
      return;
    }
    if ($closest(e.target, '[data-mp-sms-import]')) {
      e.preventDefault(); e.stopPropagation();
      mount.querySelector('[data-mp-sms-file]')?.click();
      return;
    }
  }, true);

  // file input
  const fileInput = mount.querySelector('[data-mp-sms-file]');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (!f) return;
      await importSmsPresetsFromFile(f);
      renderSmsPresetList(mount);
    });
  }

  // ESC close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setSmsPresetOpen(mount, false);
  });
}


function initSmsSimple(mount) {
  // already bound -> just ensure list
  if (mount.dataset.smsBound === '1') {
    showSmsView(mount, 'list');
    return;
  }
  mount.dataset.smsBound = '1';

  // default: list
  showSmsView(mount, 'list');

  const threadName = mount.querySelector('[data-sms-thread-name]');

  // click contact card -> thread
  if (!mount.dataset.smsOpenDelegated) {
    mount.dataset.smsOpenDelegated = '1';

    mount.addEventListener('click', (e) => {
      // only when sms page active
      const duanxinPage = mount.querySelector('.page.page-duanxin');
      if (!duanxinPage || !duanxinPage.classList.contains('active')) return;

      // avoid back/menu/switch
      if ($closest(e.target, '[data-mp-back],.phone-menu,.mp-prev,.mp-next')) return;

      const card = $closest(e.target, '[data-sms-open-thread],[data-contact],.sms-item,.contact-card,.sms-card');
      if (!card) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const contactId =
        card.getAttribute('data-contact') ||
        card.getAttribute('data-sms-open-thread') ||
        card.dataset.contactId ||
        'c1';

      const title = (card.querySelector('.sms-name,.name,.title')?.textContent || '联系人').trim();
      if (threadName) threadName.textContent = title;

      smsActiveContactId = contactId;
      showSmsView(mount, 'thread');
      renderSmsPreview(mount, contactId, title);
    }, true);
  }
}

// ====== real thread: render from PhoneEngine (shared memory) ======
function renderSmsPreview(mount, contactId, title) {
  const thread = mount.querySelector('[data-sms-thread]');
  if (!thread) return;

  const avatarMap = {
    c1: './assets/avatars/ybm.png',
    c2: './assets/avatars/caishu.png',
    c3: './assets/avatars/dantuo.png',
    c4: './assets/avatars/zhoubin.png',
  };
  const ava = avatarMap[contactId] || './assets/avatars/ybm.png';

  thread.innerHTML = '';

  // 确保引擎里有这个联系人（名字用你点开的 title）
  try {
    window.PhoneEngine?.addContact?.({ id: contactId, name: title || contactId, avatar: ava });
  } catch {}

  // 从引擎拿 phone channel 的消息（共享记忆在引擎里，UI 只渲染 phone）
  let msgs = [];
  try {
    msgs = window.PhoneEngine?.getMessages?.({ contactId, channel: 'phone' }) || [];
  } catch {}

  // 没有消息：就先空白（不再塞预览）
  if (!msgs.length) {
    thread.scrollTop = thread.scrollHeight;
    bindSmsSendOnce(mount, ava, contactId);
    return;
  }

  // 渲染
  msgs.forEach(m => {
    if (!m || !m.content) return;
    const who = (m.role === 'user') ? 'me' : 'them';
    appendSmsBubble(thread, who, m.content, ava);
  });

  thread.scrollTop = thread.scrollHeight;

  // 绑定发送（带 contactId）
  bindSmsSendOnce(mount, ava, contactId);
}


function appendSmsBubble(thread, who, text, avatarSrc) {
  const row = document.createElement('div');
  row.className = `sms-row ${who}`;

  const ava = document.createElement('div');
  ava.className = 'sms-ava' + (who === 'me' ? ' hidden' : '');
  ava.innerHTML = `<img src="${avatarSrc}" alt="">`;

  const bubble = document.createElement('div');
  bubble.className = 'sms-bubble';
  bubble.textContent = text;

  if (who === 'me') {
    row.appendChild(bubble);
    row.appendChild(ava);
  } else {
    row.appendChild(ava);
    row.appendChild(bubble);
  }

  thread.appendChild(row);
}

function bindSmsSendOnce(mount, avatarSrc, contactId) {
  if (mount.dataset.smsSendBound === '1') return;
  mount.dataset.smsSendBound = '1';

  const thread = mount.querySelector('[data-sms-thread]');
  const input = mount.querySelector('.sms-input');
  const sendBtn = mount.querySelector('.sms-send');
  if (!thread || !input || !sendBtn) return;

let sending = false;

const doSend = async () => {
  if (sending) return;
  const val = (input.value || '').trim();
  if (!val) return;

  // UI：先把用户消息立刻显示出来
  appendSmsBubble(thread, 'me', val, avatarSrc);
  input.value = '';
  thread.scrollTop = thread.scrollHeight;

  // UI：加一个“对方正在输入…”占位
  const typingRow = document.createElement('div');
  typingRow.className = 'sms-row them';
  typingRow.innerHTML = `
    <div class="sms-ava"><img src="${avatarSrc}" alt=""></div>
    <div class="sms-bubble">…</div>
  `;
  thread.appendChild(typingRow);
  thread.scrollTop = thread.scrollHeight;

  sending = true;
  sendBtn.disabled = true;

  try {
    if (!window.PhoneEngine?.send) {
      throw new Error('PhoneEngine 未加载（phone/phoneEngine.js 没挂上或路径不对）');
    }

    // ✅ 这里就是接入模型：走开始界面同一份 API（引擎里 readApiFromDOM）
    await window.PhoneEngine.send({
      text: val,
      channel: 'phone',
      contactId: contactId || 'c1',
      // 未来短信专用 API：这里预留 systemPrompt/apiOverride 口子（暂不启用）
      // systemPrompt: '...'
    });

    // 刷新渲染（用引擎里的 phone 消息重画，保证共享记忆一致）
    renderSmsPreview(mount, contactId || 'c1', mount.querySelector('[data-sms-thread-name]')?.textContent || '');
  } catch (e) {
    // 把占位换成错误提示
    const bubble = typingRow.querySelector('.sms-bubble');
    if (bubble) bubble.textContent = `（错误）${e?.message || e}`;
  } finally {
    sending = false;
    sendBtn.disabled = false;
  }
};


  sendBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    doSend();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
}
