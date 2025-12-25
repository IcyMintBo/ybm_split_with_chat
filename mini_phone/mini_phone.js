const CSS_URL = new URL('./mini_phone.css?v=3', import.meta.url).href;

function ensureCss() {
  if (document.querySelector('link[data-mini-phone-css="1"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_URL;
  link.dataset.miniPhoneCss = '1';
  document.head.appendChild(link);
}

// mini_phone/mini_phone.js (module) — safe & stable
const MOUNT_ID = 'miniPhoneMount';
const OVERLAY_ID = 'phoneOverlay';
const MASK_ID = 'phoneMask';

let mounted = false;
// ===== SMS runtime state (simple) =====
let smsBound = false;
let smsActiveContactId = null;
let smsLastPage = 'list';

function byId(id) {
  return document.getElementById(id);
}
function setOpen(id, open) {
  const el = byId(id);
  if (!el) return;
  el.dataset.open = open ? 'true' : 'false';
  el.setAttribute('aria-hidden', open ? 'false' : 'true');
}

async function ensureMounted() {
  ensureCss();

  if (mounted) return true;

  const mount = byId(MOUNT_ID);
  if (!mount) return false;

  // 1) 塞入 HTML（只做一次）
  if (!mount.dataset.mpMounted) {
    const htmlUrl = new URL('./mini_phone.html?v=3', import.meta.url);
    const res = await fetch(htmlUrl.href);
    const html = await res.text();
    mount.innerHTML = html;
    mount.dataset.mpMounted = '1';
  }

  // 2) stage 同步：让定位相对“底图实际显示区域”
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

  // 3) 导航绑定（只绑定一次）
  if (!mount.dataset.mpNavBound) {
    mount.dataset.mpNavBound = '1';

    const shell = mount.querySelector('.phone-shell');
    const content = mount.querySelector('.phone-content');
    const backBtn = mount.querySelector('[data-mp-back]');
    const pages = Array.from(mount.querySelectorAll('.page'));

function setHome(isHome) {
  if (shell) shell.classList.toggle('is-home', isHome);
  if (backBtn) backBtn.classList.toggle('hidden', isHome);
}


function showPage(rawName) {
  let name = String(rawName || '').trim();

  // 兼容传入 "page page-duanxin active" / "page-duanxin"
  const m = name.match(/\bpage-([a-z0-9_-]+)\b/i);
  if (m && m[1]) name = m[1];
  name = name.replace(/^page-/i, '').trim();

  // 找目标页
  const targetClass = `page-${name}`;
  const target = pages.find(p => p.classList.contains(targetClass));

  // 找不到就回 home，避免空白
  const finalTarget = target || pages.find(p => p.classList.contains('page-home'));
  const isHome = !!(finalTarget && finalTarget.classList.contains('page-home'));

  // 关键：硬切 display，保证永远能看到页面
  pages.forEach(p => {
    const on = (p === finalTarget);
    p.classList.toggle('active', on);
    p.style.display = on ? 'block' : 'none';
    if (on) {
      p.style.opacity = '1';
      p.style.pointerEvents = 'auto';
      p.style.transform = 'none';
    } else {
      p.style.pointerEvents = 'none';
    }
  });

  // 顶部“返回”显示/隐藏
  setHome(isHome);

  // ===== 你的要求 1：点短信后底图切到 beijing2，并保持（联系人->聊天不再触发 showPage，所以背景会一直是 beijing2）=====
  const bgImg = mount.querySelector('.phone-bg');
  if (bgImg) {
    bgImg.src = (name === 'duanxin')
      ? './assets/avatars/beijing2.png'   // 短信背景
      : './assets/avatars/beijin.png';    // 默认背景（你自己的默认文件名）
  }

  // 短信页隐藏左下角小人（你前面要求短信页不显示）
  const ren = mount.querySelector('.phone-ren');
  if (ren) {
    ren.style.display = (name === 'duanxin') ? 'none' : '';
  }

  // ===== 你的要求 2：点击联系人切到聊天页（两层切换），背景依旧是 beijing2 =====
  if (!isHome && name === 'duanxin') {
    initSmsSimple(mount);
  }
}


    // 初始：home
    showPage('home');
    // ====== Home：左右切换角色（复用 mpTab1~4 radio） ======
    (function bindSwitchBar() {
      const prevBtn = mount.querySelector('.mp-prev');
      const nextBtn = mount.querySelector('.mp-next');
      const panelBody = mount.querySelector('.mp-panel-body');
      const radios = Array.from(mount.querySelectorAll('input[name="mpTab"]'));

      if (!prevBtn || !nextBtn || !panelBody || radios.length < 2) return;
      if (mount.dataset.mpSwitchBound) return;
      mount.dataset.mpSwitchBound = '1';

      function getIndex() {
        const i = radios.findIndex(r => r.checked);
        return i >= 0 ? i : 0;
      }

      function setIndex(nextIndex, dir) {
        const from = getIndex();
        const to = (nextIndex + radios.length) % radios.length;
        if (from === to) return;

        // 轻量滑动：给 panelBody 一个动画 class，再切 radio
        panelBody.classList.remove('slide-left', 'slide-right');
        void panelBody.offsetWidth; // reflow 触发动画
        panelBody.classList.add(dir === 'left' ? 'slide-left' : 'slide-right');

        radios[to].checked = true;

        setTimeout(() => {
          panelBody.classList.remove('slide-left', 'slide-right');
        }, 640);
      }

      prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIndex(getIndex() - 1, 'left');
      });

      nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIndex(getIndex() + 1, 'right');
      });
    })();


    function setAppOriginFrom(el) {
      if (!content || !el) return;

      const iconRect = el.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();

      const cx = (iconRect.left + iconRect.right) / 2 - contentRect.left;
      const cy = (iconRect.top + iconRect.bottom) / 2 - contentRect.top;

      content.style.setProperty('--app-x', `${cx}px`);
      content.style.setProperty('--app-y', `${cy}px`);
    }

    // 图标：带 data-page 的都当按钮
    mount.querySelectorAll('[data-page]').forEach(icon => {
      icon.style.cursor = 'pointer';
      icon.addEventListener('click', (e) => {
        const page = icon.getAttribute('data-page');
        if (!page) return;

        setAppOriginFrom(icon);
        showPage(page);

        e.preventDefault();
        e.stopPropagation();
      });
    });

    // 返回：优先处理短信页的“上一层”，否则回 home
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // ① 是否在短信页
        const duanxinPage = mount.querySelector('.page.page-duanxin');
        const isDuanxinActive = duanxinPage && duanxinPage.classList.contains('active');

        if (isDuanxinActive) {
          const listView = duanxinPage.querySelector('[data-sms-view="list"]');
          const threadView = duanxinPage.querySelector('[data-sms-view="thread"]');

          // ② 如果在“会话页”，返回到“短信列表页”
          if (threadView && threadView.classList.contains('active')) {
            threadView.classList.remove('active');
            listView.classList.add('active');
            return; // ⚠️ 关键：不再继续往下执行
          }
        }

        // ③ 其它情况，才回主界面
        showPage('home');
      });
    }

  }

  // 4) 点击遮罩关闭（只绑一次）
  const mask = byId(MASK_ID);
  if (mask && !mask.dataset.bound) {
    mask.dataset.bound = '1';
    mask.addEventListener('click', () => close());
  }

  mounted = true;
  return true;
}



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
// =========================
// SMS UI (Step 1: list <-> thread, render history only)
// =========================

function getEngine() {
  return window.PhoneEngine || window.phoneEngine || null;
}

function q(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function qa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function showSmsView(mount, view /* 'list' | 'thread' */) {
  const listView = q(mount, '[data-sms-view="list"]');
  const threadView = q(mount, '[data-sms-view="thread"]');
  if (!listView || !threadView) return;

  const isList = view === 'list';
  listView.classList.toggle('active', isList);
  threadView.classList.toggle('active', !isList);

  smsLastPage = view;
}

function getSmsView(mount) {
  const listView = q(mount, '[data-sms-view="list"]');
  const threadView = q(mount, '[data-sms-view="thread"]');
  if (!listView || !threadView) return null;
  if (threadView.classList.contains('active')) return 'thread';
  return 'list';
}

function formatHHMM(ts) {
  if (!ts) return '';
  try {
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '';
  }
}


function openSmsThread(mount, contactId, { pushState } = { pushState: true }) {
  smsActiveContactId = contactId;

  // 头像/姓名
  const engine = getEngine();
  const contact = engine && typeof engine.getContact === 'function'
    ? engine.getContact(contactId)
    : null;

  const nameEl = q(mount, '[data-sms-thread-name]');
  const avaEl = q(mount, '[data-sms-thread-ava]');

  const name = (contact && (contact.name || contact.title)) || '短信';
  const avatar = (contact && (contact.avatar || contact.ava || contact.image)) || '';

  if (nameEl) nameEl.textContent = name;

  if (avaEl) {
    // 这里不假设你的 DOM 是 img 还是容器：做个兼容
    const img = avaEl.tagName.toLowerCase() === 'img' ? avaEl : q(avaEl, 'img');
    if (img) {
      if (avatar) {
        img.src = avatar;
        img.classList.remove('hidden');
      } else {
        img.removeAttribute('src');
        img.classList.add('hidden');
      }
    } else {
      // 如果不是 img，就当容器塞背景
      if (avatar) {
        avaEl.style.backgroundImage = `url("${avatar}")`;
      } else {
        avaEl.style.backgroundImage = '';
      }
    }
  }

  showSmsView(mount, 'thread');
  renderSmsThread(mount, contactId);
}

function renderSmsThread(mount, contactId) {
  const engine = getEngine();
  const thread = q(mount, '[data-sms-thread]');
  if (!thread) return;

  thread.innerHTML = '';

  // 为了“预览”，即使没引擎，也给示例气泡
  if (!engine || typeof engine.getMessages !== 'function') {
    renderThreadDemo(thread, { avatar: '' });
    scrollThreadToBottom(thread);
    return;
  }

  // 取联系人头像（左侧头像）
  const contact = (engine && typeof engine.getContact === 'function')
    ? engine.getContact(contactId)
    : null;

  const avatar = (contact && (contact.avatar || contact.ava || contact.image)) || '';

  const msgs = engine.getMessages({ contactId, channel: 'phone' }) || [];

  if (!msgs.length) {
    // 没历史：也给示例气泡，方便你看整体
    renderThreadDemo(thread, { avatar });
    scrollThreadToBottom(thread);
    return;
  }

  let lastSide = null; // 'them' | 'me'

  msgs.forEach((m) => {
    const role = (m.role || m.sender || 'assistant');
    const side = (role === 'user') ? 'me' : 'them';
    const text = (m.text ?? m.content ?? '').toString();

    const row = document.createElement('div');
    row.className = `sms-row ${side}`;

    if (side === 'them') {
      const ava = document.createElement('div');
      ava.className = 'sms-ava' + (lastSide === 'them' ? ' hidden' : '');
      ava.innerHTML = avatar ? `<img alt="" src="${avatar}">` : '';
      row.appendChild(ava);

      const bubble = document.createElement('div');
      bubble.className = 'sms-bubble';
      bubble.innerHTML = `<div class="sms-text">${escapeHtml(text)}</div>`;
      row.appendChild(bubble);
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'sms-bubble';
      bubble.innerHTML = `<div class="sms-text">${escapeHtml(text)}</div>`;
      row.appendChild(bubble);
    }

    thread.appendChild(row);
    lastSide = side;
  });

  scrollThreadToBottom(thread);
}

function renderThreadDemo(threadEl, { avatar }) {
  const demo = [
    { side: 'me', text: '我还想着切点水果给你' },
    { side: 'me', text: '那我现在端上来' },
    { side: 'them', text: '不用' },
    { side: 'them', text: '电脑在边儿上' },
    { side: 'me', text: '哦哦哦，谢谢' },
    { side: 'me', text: '太谢谢你了…… :)' },
    { side: 'them', text: '下载了维修模式插件' },
    { side: 'them', text: '以后修电脑开维修模式' },
  ];

  let lastSide = null;

  demo.forEach((d) => {
    const row = document.createElement('div');
    row.className = `sms-row ${d.side}`;

    if (d.side === 'them') {
      const ava = document.createElement('div');
      ava.className = 'sms-ava' + (lastSide === 'them' ? ' hidden' : '');
      ava.innerHTML = avatar ? `<img alt="" src="${avatar}">` : '';
      row.appendChild(ava);

      const bubble = document.createElement('div');
      bubble.className = 'sms-bubble';
      bubble.innerHTML = `<div class="sms-text">${escapeHtml(d.text)}</div>`;
      row.appendChild(bubble);
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'sms-bubble';
      bubble.innerHTML = `<div class="sms-text">${escapeHtml(d.text)}</div>`;
      row.appendChild(bubble);
    }

    threadEl.appendChild(row);
    lastSide = d.side;
  });
}



function scrollThreadToBottom(threadEl) {
  requestAnimationFrame(() => {
    threadEl.scrollTop = threadEl.scrollHeight;
  });
}

function getLastPreview(engine, contactId) {
  try {
    const msgs = engine.getMessages({ contactId, channel: 'phone' }) || [];
    if (!msgs.length) return '';
    const last = msgs[msgs.length - 1];
    const t = (last.text ?? last.content ?? '').toString().trim();
    return t.length > 28 ? t.slice(0, 28) + '…' : t;
  } catch {
    return '';
  }
}

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// 暴露给 chat 调用
window.MiniPhone = { open, close };
function initSmsSimple(mount){
  // 每次进入短信页都可以调用，但只绑定一次事件
  if (mount.dataset.smsBound === '1') {
    // 仍然确保默认显示 list
    showSmsInnerView(mount, 'list');
    return;
  }
  mount.dataset.smsBound = '1';

  function showSmsInnerView(mount, view){
    const listView = mount.querySelector('[data-sms-view="list"]');
    const threadView = mount.querySelector('[data-sms-view="thread"]');
    if (!listView || !threadView) return;

    listView.classList.toggle('active', view === 'list');
    threadView.classList.toggle('active', view === 'thread');
  }

  // 暴露给上面复用
  window.showSmsInnerView = showSmsInnerView;

  // 默认进短信就是联系人列表
  showSmsInnerView(mount, 'list');

  const threadName = mount.querySelector('[data-sms-thread-name]');
  const backBtn = mount.querySelector('[data-sms-back]');

mount.querySelectorAll('[data-sms-open-thread]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const contactId = btn.getAttribute('data-contact') || btn.getAttribute('data-sms-open-thread') || 'c1';
    const title = (btn.querySelector('.sms-name')?.textContent || '联系人').trim();

    // 顶部标题
    if (threadName) threadName.textContent = title;

    // 切到聊天页
    showSmsInnerView(mount, 'thread');

    // ✅ 塞预览消息（每个联系人只塞一次，方便你调样式）
    renderSmsPreview(mount, contactId, title);
  });
});


  // 2) 聊天页返回 -> 回联系人列表
  if (backBtn){
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSmsInnerView(mount, 'list');
    });
  }
}

// 让重复进入短信页时也能强制回到 list
function showSmsInnerView(mount, view){
  const fn = window.showSmsInnerView;
  if (typeof fn === 'function') fn(mount, view);
}
function renderSmsPreview(mount, contactId, title){
  const thread = mount.querySelector('[data-sms-thread]');
  if (!thread) return;

  // 每个联系人只初始化一次（避免你来回点重复刷）
  const key = `sms_seeded_${contactId}`;
  if (mount.dataset[key] === '1') return;
  mount.dataset[key] = '1';

  // 头像映射：按你的资源名改
  const avatarMap = {
    c1: './assets/avatars/ybm.png',
    c2: './assets/avatars/caishu.png',
    c3: './assets/avatars/dantuo.png',
    c4: './assets/avatars/zhoubin.png',
  };
  const ava = avatarMap[contactId] || './assets/avatars/ybm.png';

  thread.innerHTML = '';

  // 预览消息（你想怎么写都行）
  const msgs = [
    { who: 'them', text: '（预览）你在吗？' },
    { who: 'me',   text: '在。怎么？' },
    { who: 'them', text: '（预览）我刚看到你发的那个……有点意思。' },
    { who: 'me',   text: '别卖关子，直说。' },
  ];

  msgs.forEach(m => appendSmsBubble(thread, m.who, m.text, ava));

  // 滚到底
  thread.scrollTop = thread.scrollHeight;

  // 绑定发送（只绑一次）
  bindSmsSendOnce(mount, ava);
}

function appendSmsBubble(thread, who, text, avatarSrc){
  const row = document.createElement('div');
  row.className = `sms-row ${who}`;

  // 左侧头像（me 的头像占位隐藏，保持对齐）
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

function bindSmsSendOnce(mount, avatarSrc){
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

  // 点击发送
  sendBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    doSend();
  });

  // 回车发送（Shift+Enter 换行）
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
}

