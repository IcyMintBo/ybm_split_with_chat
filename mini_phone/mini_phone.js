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
function stripThinkingForUi(text) {
  let out = String(text || '');

  // 标准：成对 think 标签
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // 非标准：只有 <think> 没有 </think> ——不要删到结尾，只去掉标记本身/所在行
  out = out.replace(/<\/think>/gi, '');
  out = out.replace(/<think>/gi, '');

  // 有些模型会把 think 放在一行开头：只删这一行
  out = out.replace(/^<think>.*$/gim, '');

  // ```think ...``` 这种
  out = out.replace(/```(?:think|thinking)[\s\S]*?```/gi, '');

  return out.trim();
}


function cleanForSms(text) {
  let s = String(text || '');

  // 去 think（双保险：含“无闭合”）
  // 去 think（双保险：但不杀到末尾）
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<\/think>/gi, '');
  s = s.replace(/<think>/gi, '');
  s = s.replace(/^<think>.*$/gim, '');
  s = s.replace(/```(?:think|thinking)[\s\S]*?```/gi, '');

  // 统一换行
  s = s.replace(/\r\n/g, '\n');

  // 去掉常见 markdown 强调/标题
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/\*\*(.*?)\*\*/g, '$1');
  s = s.replace(/`([^`]+)`/g, '$1');

  // 去掉很像“旁白块”的长段英文（短信不需要）
  // （你不想过滤英文可以删掉这一段）
  const lines = s.split('\n');
  s = lines.filter(l => {
    const t = l.trim();
    if (!t) return false;
    const hasCJK = /[\u4e00-\u9fff]/.test(t);
    const englishHeavy = !hasCJK && /[a-zA-Z]/.test(t) && t.length > 60;
    return !englishHeavy;
  }).join('\n');

  return s.trim();
}

function splitSmsLines(rawText) {
  const src = cleanForSms(rawText);
  if (!src) return [];

  // 0) 强制中文：只保留含中文的行（避免英文标题/说明混进短信）
  const hasCJK = (s) => /[\u4e00-\u9fff]/.test(String(s || ''));

  // 1) 强优先：只提取 “对方：...” 的行（有就只用它们）
  const extracted = [];
  const reLine = /^对方[:：]\s*(.+)\s*$/gm;
  let mm;
  while ((mm = reLine.exec(src)) !== null) {
    const body = String(mm[1] || '').trim();
    if (body && hasCJK(body)) extracted.push(body);
  }
  if (extracted.length) return extracted;

  // 2) 兜底：按换行拆（去掉“对方：”前缀），并过滤非中文行
  let parts = src
    .split('\n')
    .map(s => s.trim().replace(/^对方[:：]\s*/, ''))
    .filter(Boolean)
    .filter(hasCJK);

  // 3) 如果还是一大段：按标点拆句（短信化）
  if (parts.length === 1 && parts[0].length > 120) {
    const one = parts[0];
    parts = one
      .replace(/([。！？\?！])\s*/g, '$1\n')
      .split('\n')
      .map(s => s.trim().replace(/^对方[:：]\s*/, ''))
      .filter(Boolean)
      .filter(hasCJK);
  }

  // 4) 每条限长（避免一个气泡太长）
  const MAX = 80;
  const HARD = 140;
  const out = [];

  for (let p of parts) {
    p = p.replace(/^[“"']+/, '').replace(/[”"']+$/, '').trim();
    if (!p) continue;
    if (!hasCJK(p)) continue;

    if (p.length <= HARD) {
      if (p.length > MAX) {
        for (let i = 0; i < p.length; i += MAX) out.push(p.slice(i, i + MAX));
      } else {
        out.push(p);
      }
    } else {
      for (let i = 0; i < p.length; i += MAX) out.push(p.slice(i, i + MAX));
    }
  }

  return out.filter(Boolean);
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
  } catch { }

  // 兼容：如果旧 key 有内容，也不覆盖（让迁移逻辑去处理）
  try {
    const oldRaw = localStorage.getItem('YBM_MINI_PRESET_V1');
    if (oldRaw) return;
  } catch { }

  // 没有任何 preset -> 灌默认文件
  try {
    const res = await fetch(MINI_PRESETS_JSON_URL);
    if (!res.ok) return;
    const obj = await res.json();
    if (!obj || !obj.scopes) return;
    localStorage.setItem('YBM_MINI_PRESETS_V1', JSON.stringify(obj));
  } catch { }
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
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", "&#39;");
}
function uidShort() { return 'p_' + Math.random().toString(36).slice(2, 10); }

function loadPromptCfg() {
  try { return JSON.parse(localStorage.getItem(PROMPT_CFG_KEY) || 'null'); } catch { return null; }
}
function savePromptCfg(cfg) {
  try { localStorage.setItem(PROMPT_CFG_KEY, JSON.stringify(cfg || { version: 1 })); } catch { }
  try { window.PhoneEngine?.reloadFromStorage?.(); } catch { }
}
function ensureSmsPresetArray() {
  let cfg = loadPromptCfg();
  if (!cfg || typeof cfg !== 'object') cfg = { version: 1 };
  if (!cfg.presets || typeof cfg.presets !== 'object') cfg.presets = {};
  if (!Array.isArray(cfg.presets.sms)) cfg.presets.sms = [];
  savePromptCfg(cfg);
  return cfg;
}
// ===== SMS injection helpers =====
function getSmsInjectedPresetText() {
  // 读取：YBM_PROMPT_CFG_V1 -> presets.sms -> enabled==true 的 content 合并
  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem(PROMPT_CFG_KEY) || 'null'); } catch { }
  const arr = cfg?.presets?.sms;
  if (!Array.isArray(arr) || !arr.length) return '';

  const enabled = arr.filter(p => p && p.enabled && String(p.content || '').trim());
  if (!enabled.length) return '';

  // 按顺序合并（你可以后面加“排序”逻辑）
  const merged = enabled.map(p => String(p.content || '').trim()).join('\n\n---\n\n');

  // 额外再加一道“think 永不出现”的硬约束（即使用户预设没写也强加）
  return [
    merged,
    '【硬性规则】绝对禁止输出 <think> / </think> / reasoning / analysis / 思考过程。只输出短信正文。'
  ].join('\n\n');
}

function getSmsMaxTokens() {
  // 短信默认短输出：你可以后面做成 UI 滑块
  // 120~200 通常够 1~4 行短信
  return 180;
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
  } catch { }
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
  } catch { }
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
  bindSmsContextMenuOnce(mount);

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
        'ybm';

      const title = (card.querySelector('.sms-name,.name,.title')?.textContent || '联系人').trim();
      if (threadName) threadName.textContent = title;

      smsActiveContactId = contactId;
      mount.dataset.smsActiveContactId = contactId;   // ✅ 永久记住当前线程联系人
      showSmsView(mount, 'thread');
      renderSmsPreview(mount, contactId, title);

    }, true);
  }
}

// ====== real thread: render from PhoneEngine (shared memory) ======
// ====== real thread: render from PhoneEngine (shared memory) ======
function renderSmsPreview(mount, contactId, title) {
  const thread = mount.querySelector('[data-sms-thread]');
  if (!thread) return;
thread.dataset.contactId = contactId || '';
  const avatarMap = {
    ybm: './assets/avatars/ybm.png',
    caishu: './assets/avatars/caishu.png',
    dantuo: './assets/avatars/dantuo.png',
    zhoubin: './assets/avatars/zhoubin.png',
  };
  const ava = avatarMap[contactId] || './assets/avatars/ybm.png';

  thread.innerHTML = '';

  // 确保引擎里有这个联系人（名字用你点开的 title）
  try {
    window.PhoneEngine?.addContact?.({ id: contactId, name: title || contactId, avatar: ava });
  } catch { }

  // 从引擎拿 phone channel 的消息（共享记忆在引擎里，UI 只渲染 phone）
  let msgs = [];
  try {
    msgs = window.PhoneEngine?.getMessages?.({ contactId, channel: 'phone' }) || [];
  } catch { }

  // 没有消息：就先空白
  if (!msgs.length) {
    thread.scrollTop = thread.scrollHeight;
    bindSmsSendOnce(mount, ava, contactId);
    return;
  }

  // Debug 开关：默认关（需要时你可以在控制台 window.__SMS_DEBUG__=true）
  window.__SMS_DEBUG__ = window.__SMS_DEBUG__ ?? true;

  // 渲染所有消息
  msgs.forEach((m) => {
    if (!m || !m.content) return;

    const tid = m.turnId || m.turn_id || m.meta?.turnId || m.meta?.turn_id || '';
    const mid = m.id || '';

    if (m.role === 'user') {
      const txt = stripThinkingForUi(m.content);
      if (txt) appendSmsBubble(thread, 'me', txt, ava, { msgId: mid, turnId: tid });
      return;
    }

    // assistant
    const raw = String(m.content || '');
    const clean = cleanForSms(raw);
    const lines = splitSmsLines(raw);

    if (window.__SMS_DEBUG__) {
      console.groupCollapsed('[SMS] assistant render');
      console.log('raw:', raw);
      console.log('clean:', clean);
      console.log('lines:', lines);
      console.groupEnd();
    }

    // 过滤后为空：给提示，避免“看起来像消失”
    if (!clean.trim()) {
      appendSmsBubble(thread, 'them', '（内容被过滤或为空）', ava, { msgId: mid, turnId: tid, kind: 'sys' });
      return;
    }

    // split 失败：fallback 用 clean
    if (!lines.length) {
      appendSmsBubble(thread, 'them', clean.trim(), ava, { msgId: mid, turnId: tid });
      return;
    }

    lines.forEach((line) => {
      appendSmsBubble(thread, 'them', line, ava, { msgId: mid, turnId: tid });
    });
  });

  thread.scrollTop = thread.scrollHeight;

  // 绑定发送（带 contactId）
  bindSmsSendOnce(mount, ava, contactId);
}



function appendSmsBubble(thread, who, text, avatarSrc, opts = {}) {
  const row = document.createElement('div');
  row.className = `sms-row ${who}`;

  if (opts && opts.msgId) row.dataset.msgId = String(opts.msgId);
  if (opts && opts.turnId) row.dataset.turnId = String(opts.turnId);
  if (opts && opts.kind) row.dataset.kind = String(opts.kind);

  if (who === 'me' && opts.pending) row.classList.add('pending');
  if (opts && opts.pendingId) row.dataset.pendingId = String(opts.pendingId);

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
  return row;
}


// 暂存队列：仅保存在内存里（刷新就没）
// key = contactId
window.__YBM_SMS_QUEUE__ = window.__YBM_SMS_QUEUE__ || {};
// 每个联系人一个“当前编辑轮”的 turnId（pending/withdraw 都归到这一轮）
window.__YBM_SMS_DRAFT_TURN__ = window.__YBM_SMS_DRAFT_TURN__ || {};


function bindSmsSendOnce(mount, avatarSrc, contactId) {
  // 进入不同联系人时要重新绑（否则你切联系人会用旧的 contactId）
  const boundKey = `1:${contactId || 'ybm'}`;
  if (mount.dataset.smsSendBound === boundKey) return;
  mount.dataset.smsSendBound = boundKey;

  const thread = mount.querySelector('[data-sms-thread]');
  const input = mount.querySelector('.sms-input');
  const stashBtn = mount.querySelector('.sms-stash');
  const sendBtn = mount.querySelector('.sms-send');
  if (!thread || !input || !sendBtn || !stashBtn) return;

  const cid = contactId || 'ybm';
  const getQueue = () => (window.__YBM_SMS_QUEUE__[cid] ||= []);
  const clearQueue = () => { window.__YBM_SMS_QUEUE__[cid] = []; };

  // ⇢ 暂存：上屏，但不发送
  const doStash = () => {
    const val = (input.value || '').trim();
    if (!val) return;

    // 本轮 draftTurnId：一旦开始暂存，就固定下来（pending/withdraw 都归这一轮）
    const draftTurnId = (window.__YBM_SMS_DRAFT_TURN__[cid] ||= (
      window.PhoneEngine?.newTurnId?.() || ('t_' + Date.now().toString(36))
    ));

    const id = 'q_' + Math.random().toString(36).slice(2, 10);
    getQueue().push({ id, text: val, kind: 'pending' });

    appendSmsBubble(thread, 'me', val, avatarSrc, {
      pending: true,
      pendingId: id,
      turnId: draftTurnId
    });

    input.value = '';
    thread.scrollTop = thread.scrollHeight;
  };


  // ➤ 发送：把“暂存队列 + 当前输入”一次性发出去
  let sending = false;
  const doSendAll = async () => {
    if (sending) return;

    const queue = getQueue().slice();
    const tail = (input.value || '').trim();

    // 允许：队列为空但有尾巴；或队列非空但尾巴空
    if (!queue.length && !tail) return;

    // 如果尾巴有内容，先把尾巴也当成“要发的一条”（但它不是 pending）
    const all = queue.map(x => x.text);
    if (tail) all.push(tail);

    // 发送时：如果 tail 有内容，把它也先上屏（作为“已发送”的那条）
    if (tail) {
      appendSmsBubble(thread, 'me', tail, avatarSrc, { pending: false });
      input.value = '';
      thread.scrollTop = thread.scrollHeight;
    }

    // 把 pending 气泡从“待发送”改成“已发送”（去掉 pending 样式）
    // 注意：只改 queue 里那几条（不含 tail）
    queue.forEach(q => {
      const row = thread.querySelector(`.sms-row.me.pending[data-pending-id="${q.id}"]`);
      if (row) row.classList.remove('pending');
    });

    // UI：对方正在输入…
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
    stashBtn.disabled = true;

    try {
      if (!window.PhoneEngine?.appendMessage || !window.PhoneEngine?.send) {
        throw new Error('PhoneEngine 未加载：请确认 phone/phoneEngine.js 已挂上');
      }

      const lastText = all.pop();

      // ✅ 本轮 turnId：优先用 draftTurnId（让撤回/暂存/本轮回复都归一轮）
      const turnId = (window.__YBM_SMS_DRAFT_TURN__[cid] ||= (window.PhoneEngine?.newTurnId?.() || ('t_' + Date.now().toString(36))));

      // 写入前面的（如果有）：同一轮
      for (const t of all) {
        window.PhoneEngine.appendMessage({
          contactId: cid,
          channel: 'phone',
          role: 'user',
          content: t,
          turnId
        });
      }

      // ===== SMS preset injection + short output control =====
      const smsPreset = getSmsInjectedPresetText(); // 把启用的短信预设拼起来（强约束短信格式）
      const smsMaxTokens = getSmsMaxTokens();       // 短信专用 tokens（未来可做成 UI 开关）

      await window.PhoneEngine.send({
        text: lastText,
        channel: 'phone',
        contactId: cid,
        turnId,

        // ✅ 注入短信预设（关键：让模型“先天像短信”）
        // PhoneEngine 需要支持 systemPrompt / extraSystem 之类字段；
        // 如果你现在的 PhoneEngine 还没吃这个字段，我下一步给你补到 phoneEngine.js。
        systemPrompt: smsPreset,

        // ✅ 短信专用短输出（若 PhoneEngine 支持）
        max_tokens: smsMaxTokens,

        // TODO(miniPhone): 未来这里加“手机专用 API Key / BaseURL / model override”
        // apiOverride: { baseUrl, apiKey, model }
      });



      // 清空暂存队列 & 本轮 draftTurnId
      clearQueue();
      delete window.__YBM_SMS_DRAFT_TURN__[cid];


      // 重新渲染线程（如果你现在是“从引擎读消息渲染”，这里会刷新到最新）
      // 没有这个函数也没关系，不会报错
      try {
        if (typeof renderSmsPreview === 'function') {
          const title = mount.querySelector('[data-sms-thread-name]')?.textContent || '';
          renderSmsPreview(mount, cid, title);
        }
      } catch { }

    } catch (e) {
      const bubble = typingRow.querySelector('.sms-bubble');
      if (bubble) bubble.textContent = `（错误）${e?.message || e}`;
    } finally {
      // 移除 typing 占位（如果还在）
      try { typingRow.remove(); } catch { }
      sending = false;
      sendBtn.disabled = false;
      stashBtn.disabled = false;
    }
  };

  // 绑定按钮
  stashBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); doStash(); };
  sendBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); doSendAll(); };

  // Enter：默认发送（Shift+Enter 换行）
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSendAll();
    }
  };
}
// =========================
// SMS Context Menu (right click)
// pending: 删除 / 撤回（撤回会写入引擎，让模型可见）
// assistant: 仅最后一轮可 重roll / 删除本轮
// =========================
function bindSmsContextMenuOnce(mount) {
  if (!mount || mount.dataset.smsCtxBound === '1') return;
  mount.dataset.smsCtxBound = '1';

  const overlay = mount.querySelector('[data-mp-ctx]');
  const card = overlay?.querySelector('.mp-ctx-card');
  const hint = overlay?.querySelector('[data-ctx-hint]');
  if (!overlay || !card) return;

  const btnPendingWithdraw = overlay.querySelector('[data-ctx-act="pending-withdraw"]');
  const btnPendingDelete = overlay.querySelector('[data-ctx-act="pending-delete"]');
  const btnTurnReroll = overlay.querySelector('[data-ctx-act="turn-reroll"]');
  const btnTurnDelete = overlay.querySelector('[data-ctx-act="turn-delete"]');
  const sep = overlay.querySelector('.mp-ctx-sep');

  let ctx = null; // { kind, contactId, pendingId, pendingText, turnId, msgId }
  function getLastAssistantTurnIdSafe(contactId) {
    // 1) 引擎提供就用
    try {
      const tid = window.PhoneEngine?.getLastAssistantTurnId?.({ contactId, channel: 'phone' });
      if (tid) return String(tid);
    } catch { }

    // 2) fallback：从 phone channel 的消息里倒序找最后一条 assistant 的 turnId
    try {
      const msgs = window.PhoneEngine?.getMessages?.({ contactId, channel: 'phone' }) || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!m || m.role !== 'assistant') continue;
        const tid = m.turnId || m.turn_id || m.meta?.turnId || m.meta?.turn_id;
        if (tid) return String(tid);
      }
    } catch { }

    return '';
  }

  function openAt(x, y) {
    overlay.dataset.open = 'true';
    overlay.setAttribute('aria-hidden', 'false');

    const rect = mount.getBoundingClientRect();
    const maxW = 220;
    const maxH = 260;

    const px = Math.max(12, Math.min(x - rect.left, rect.width - maxW - 12));
    const py = Math.max(12, Math.min(y - rect.top, rect.height - maxH - 12));

    card.style.left = px + 'px';
    card.style.top = py + 'px';
  }

  function close() {
    overlay.dataset.open = 'false';
    overlay.setAttribute('aria-hidden', 'true');
    ctx = null;
  }

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  function openCtxFromEvent(e) {
    const duanxinPage = mount.querySelector('.page.page-duanxin');
    if (!duanxinPage || !duanxinPage.classList.contains('active')) return false;

    const threadView = duanxinPage.querySelector('[data-sms-view="thread"]');
    if (!threadView || !threadView.classList.contains('active')) return false;

    const row = $closest(e.target, '.sms-row');
    if (!row) return false;

    e.preventDefault();
    e.stopPropagation();

const threadEl = mount.querySelector('[data-sms-thread]');
const contactId =
  threadEl?.dataset.contactId ||
  mount.dataset.smsActiveContactId ||
  smsActiveContactId ||
  'ybm';


    // ===== A) pending（暂存队列里的气泡）=====
    const pendingId = row.dataset.pendingId || '';
    if (pendingId) {
      const q = (window.__YBM_SMS_QUEUE__?.[contactId] || []);
      const hit = q.find(x => x && x.id === pendingId);
      const pendingText = hit?.text || '';

      ctx = { kind: 'pending', contactId, pendingId, pendingText };

      const isWithdrawPending = !!hit && hit.kind === 'withdraw';
      btnPendingWithdraw.style.display = isWithdrawPending ? 'none' : '';
      btnPendingDelete.style.display = '';

      if (sep) sep.style.display = 'none';
      btnTurnReroll.style.display = 'none';
      btnTurnDelete.style.display = 'none';

      btnPendingDelete.disabled = false;
      if (hint) hint.textContent = isWithdrawPending ? '撤回事件：可删除/可发送' : '暂存消息：撤回可被模型看到';

      openAt(e.clientX, e.clientY);
      return true;
    }

    // ===== B) withdraw（旧逻辑：撤回写进引擎的 user 消息）=====
    // 你现在撤回已经是 pending 了，基本用不到，但留着不影响
    if (row.classList.contains('me') && (row.dataset.kind === 'withdraw') && row.dataset.msgId) {
      const msgId = row.dataset.msgId || '';
      const turnId = row.dataset.turnId || '';

      ctx = { kind: 'withdraw', contactId, msgId, turnId };

      btnPendingWithdraw.style.display = 'none';
      btnPendingDelete.style.display = '';
      if (sep) sep.style.display = 'none';
      btnTurnReroll.style.display = 'none';
      btnTurnDelete.style.display = 'none';

      btnPendingDelete.disabled = false;
      if (hint) hint.textContent = '撤回消息：删除会彻底移除（模型将不再看到）';

      openAt(e.clientX, e.clientY);
      return true;
    }

    // ===== C) assistant（对方消息：只允许最后一轮重roll/删除本轮）=====
    if (row.classList.contains('them')) {
      const turnId = row.dataset.turnId || '';
      const msgId = row.dataset.msgId || '';

      ctx = { kind: 'assistant', contactId, turnId, msgId };

      btnPendingWithdraw.style.display = 'none';
      btnPendingDelete.style.display = 'none';
      if (sep) sep.style.display = '';
      btnTurnReroll.style.display = '';
      btnTurnDelete.style.display = '';

      const lastTid = getLastAssistantTurnIdSafe(contactId);

      const ok = !!turnId && !!lastTid && (turnId === lastTid);

      btnTurnReroll.disabled = !ok;
      btnTurnDelete.disabled = !ok;

      if (hint) hint.textContent = ok ? '操作最后一轮：重roll / 删除本轮' : '只能操作“最后一轮”';

      openAt(e.clientX, e.clientY);
      return true;
    }

    return false;
  }

  // 右键（PC）
  mount.addEventListener('contextmenu', (e) => {
    openCtxFromEvent(e);
  }, true);

  // 点击（手机/触屏）：点气泡弹菜单
  mount.addEventListener('click', (e) => {
    // 避免点到输入框/按钮时误弹
    if ($closest(e.target, '.sms-input,.sms-send,.sms-stash,.phone-menu,[data-mp-back]')) return;
    openCtxFromEvent(e);
  }, true);

  // 长按（手机）：更像原生
  let pressTimer = null;
  mount.addEventListener('touchstart', (e) => {
    const row = $closest(e.target, '.sms-row');
    if (!row) return;
    pressTimer = setTimeout(() => {
      // touch 没有 clientX/clientY 时，用触点坐标
      const t = e.touches && e.touches[0];
      if (t) {
        e.clientX = t.clientX;
        e.clientY = t.clientY;
      }
      openCtxFromEvent(e);
    }, 420);
  }, { passive: false, capture: true });

  mount.addEventListener('touchend', () => {
    clearTimeout(pressTimer);
    pressTimer = null;
  }, true);

  mount.addEventListener('touchmove', () => {
    clearTimeout(pressTimer);
    pressTimer = null;
  }, true);


  // ===== pending-delete / withdraw-delete =====
  btnPendingDelete?.addEventListener('click', () => {
    if (!ctx) return;

    const thread = mount.querySelector('[data-sms-thread]');

    // 1) 删暂存 pending
    if (ctx.kind === 'pending') {
      const { contactId, pendingId } = ctx;

      const q = (window.__YBM_SMS_QUEUE__?.[contactId] || []);
      window.__YBM_SMS_QUEUE__[contactId] = q.filter(x => x && x.id !== pendingId);

      const row = thread?.querySelector(`.sms-row.me.pending[data-pending-id="${pendingId}"]`);
      try { row?.remove(); } catch { }
      close();
      return;
    }

    // 2) 删 withdraw（硬删除：从引擎里移除）
    if (ctx.kind === 'withdraw') {
      const { contactId, msgId } = ctx;
      if (!msgId) return;

      window.PhoneEngine?.deleteMessage?.({ contactId, msgId });

      try {
        const title = mount.querySelector('[data-sms-thread-name]')?.textContent || '';
        renderSmsPreview(mount, contactId, title);
      } catch { }

      close();
      return;
    }
  });

  // ===== pending-withdraw（撤回：转成一条 withdraw pending，可发送/可删除）=====
  btnPendingWithdraw?.addEventListener('click', () => {
    if (!ctx || ctx.kind !== 'pending') return;

    const { contactId, pendingId, pendingText } = ctx;
    const thread = mount.querySelector('[data-sms-thread]');
    if (!thread) { close(); return; }

    // ✅ 取当前线程头像（不要用未定义的 avatarSrc）
    const avatarSrc =
      thread.querySelector('.sms-row.them .sms-ava img')?.getAttribute('src') ||
      './assets/avatars/ybm.png';

    // 当前草稿轮 turnId（撤回要跟本轮绑定）
    const draftTurnId = (window.__YBM_SMS_DRAFT_TURN__[contactId] ||= (
      window.PhoneEngine?.newTurnId?.() || ('t_' + Date.now().toString(36))
    ));

    // 1) 从队列删掉原 pending
    const q = (window.__YBM_SMS_QUEUE__?.[contactId] || []);
    window.__YBM_SMS_QUEUE__[contactId] = q.filter(x => x && x.id !== pendingId);

    // 2) 删 UI 行（原 pending 气泡）
    const pendingRow = thread.querySelector(`.sms-row.me.pending[data-pending-id="${pendingId}"]`);
    try { pendingRow?.remove(); } catch { }

    // 3) 新增一个“撤回事件 pending”（仍可发送、仍可删除）
    const wid = 'w_' + Math.random().toString(36).slice(2, 10);
    const wText = `（已撤回）${pendingText || ''}`.trim();

    (window.__YBM_SMS_QUEUE__[contactId] ||= []).push({ id: wid, text: wText, kind: 'withdraw' });

    // 4) UI：显示撤回 pending 气泡
    appendSmsBubble(thread, 'me', wText, avatarSrc, {
      pending: true,
      pendingId: wid,
      turnId: draftTurnId,
      kind: 'withdraw'
    });

    thread.scrollTop = thread.scrollHeight;
    close();
  });



  // ===== turn-delete =====
  btnTurnDelete?.addEventListener('click', () => {
    if (!ctx || ctx.kind !== 'assistant') return;
    const { contactId, turnId } = ctx;
    if (!turnId) return;

    window.PhoneEngine?.deleteTurn?.({ contactId, channel: 'phone', turnId });

    try {
      const title = mount.querySelector('[data-sms-thread-name]')?.textContent || '';
      renderSmsPreview(mount, contactId, title);
    } catch { }

    close();
  });

  // ===== turn-reroll =====
  // ===== turn-reroll =====
  btnTurnReroll?.addEventListener('click', async () => {
    if (!ctx || ctx.kind !== 'assistant') return;
    const { contactId, turnId } = ctx;
    if (!turnId) return;

    const lastTid =
      window.PhoneEngine?.getLastAssistantTurnId?.({ contactId, channel: 'phone' }) || '';
    if (turnId !== lastTid) return;

    const thread = mount.querySelector('[data-sms-thread]');
    const avatarSrc =
      thread?.querySelector('.sms-row.them .sms-ava img')?.getAttribute('src') ||
      './assets/avatars/ybm.png';

    // A) 先在 UI 上把“这一轮的对方气泡”删掉（带淡出）
    if (thread) {
      const rows = Array.from(thread.querySelectorAll(`.sms-row.them[data-turn-id="${turnId}"], .sms-row.them[data-turnid="${turnId}"]`));
      rows.forEach(r => {
        r.classList.add('mp-fadeout');
        setTimeout(() => { try { r.remove(); } catch { } }, 180);
      });

      // B) 放一个“对方正在输入…”占位
      const typingRow = document.createElement('div');
      typingRow.className = 'sms-row them';
      typingRow.dataset._typing = '1';
      typingRow.innerHTML = `
        <div class="sms-ava"><img src="${avatarSrc}" alt=""></div>
        <div class="sms-bubble">…</div>
      `;
      thread.appendChild(typingRow);
      thread.scrollTop = thread.scrollHeight;
    }

    // C) 触发引擎重roll
    try {
      if (window.PhoneEngine?.rerollLastTurn) {
        await window.PhoneEngine.rerollLastTurn({ contactId, channel: 'phone', turnId });
      } else if (window.PhoneEngine?.rerollLastAssistant) {
        await window.PhoneEngine.rerollLastAssistant({ contactId, channel: 'phone' });
      }
    } finally {
      // D) 不管成功失败，都去掉 typing 占位（随后整体重渲染）
      try {
        thread?.querySelector('.sms-row.them[data-_typing="1"]')?.remove();
      } catch { }
    }

    // E) 新回复回来后：重渲染
    try {
      const title = mount.querySelector('[data-sms-thread-name]')?.textContent || '';
      renderSmsPreview(mount, contactId, title);
    } catch { }

    close();
  });

}


