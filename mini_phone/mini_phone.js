// mini_phone/mini_phone.js (module) — safe & stable (FULL REPLACE)

const CSS_URL = new URL('./mini_phone.css?v=4', import.meta.url).href;
const HTML_URL = new URL('./mini_phone.html?v=4', import.meta.url).href;

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

// ====== demo preview (你原来的预览逻辑保留) ======
function renderSmsPreview(mount, contactId, title) {
  const thread = mount.querySelector('[data-sms-thread]');
  if (!thread) return;

  const key = `sms_seeded_${contactId}`;
  if (mount.dataset[key] === '1') return;
  mount.dataset[key] = '1';

  const avatarMap = {
    c1: './assets/avatars/ybm.png',
    c2: './assets/avatars/caishu.png',
    c3: './assets/avatars/dantuo.png',
    c4: './assets/avatars/zhoubin.png',
  };
  const ava = avatarMap[contactId] || './assets/avatars/ybm.png';

  thread.innerHTML = '';

  const msgs = [
    { who: 'them', text: '（预览）你在吗？' },
    { who: 'me', text: '在。怎么？' },
    { who: 'them', text: '（预览）我刚看到你发的那个……有点意思。' },
    { who: 'me', text: '别卖关子，直说。' },
  ];

  msgs.forEach(m => appendSmsBubble(thread, m.who, m.text, ava));
  thread.scrollTop = thread.scrollHeight;

  bindSmsSendOnce(mount, ava);
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

function bindSmsSendOnce(mount, avatarSrc) {
  if (mount.dataset.smsSendBound === '1') return;
  mount.dataset.smsSendBound = '1';

  const thread = mount.querySelector('[data-sms-thread]');
  const input = mount.querySelector('.sms-input');
  const sendBtn = mount.querySelector('.sms-send');
  if (!thread || !input || !sendBtn) return;

  const doSend = () => {
    const val = (input.value || '').trim();
    if (!val) return;
    appendSmsBubble(thread, 'me', val, avatarSrc);
    input.value = '';
    thread.scrollTop = thread.scrollHeight;
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
