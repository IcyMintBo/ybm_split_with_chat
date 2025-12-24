const CSS_URL = new URL('./mini_phone.css?v=2', import.meta.url).href;

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
// ===== SMS runtime state =====
let smsBound = false;
let smsActiveContactId = null;
let smsLastPage = 'list'; // 'list' | 'thread'

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
    const htmlUrl = new URL('./mini_phone.html?v=2', import.meta.url);
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

    function showPage(name) {
      pages.forEach(p => {
        const isTarget = p.classList.contains(`page-${name}`);
        p.classList.toggle('active', isTarget);
      });
      setHome(name === 'home');

      // ===== SMS auto hook (do NOT rely on name) =====
      // 只要“当前激活页面里”存在短信DOM，就初始化短信
      const activePage = pages.find(p => p.classList.contains('active'));
      const hasSmsDom =
        !!(activePage && (
          activePage.querySelector('[data-sms-list]') ||
          activePage.querySelector('[data-sms-view="list"]') ||
          activePage.querySelector('[data-sms-view="thread"]')
        ));

      if (hasSmsDom) {
        bindSmsUIOnce(mount);

        if (smsLastPage === 'thread' && smsActiveContactId) {
          openSmsThread(mount, smsActiveContactId, { pushState: false });
        } else {
          showSmsView(mount, 'list');
          renderSmsList(mount);
        }
      } else {
        // 离开短信页：记住当前子视图（如果短信DOM存在的话）
        const v = getSmsView(mount);
        if (v) smsLastPage = v;
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
            smsLastPage = 'list';
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

function bindSmsUIOnce(mount) {
  if (smsBound) return;
  smsBound = true;

  const back = q(mount, '[data-sms-back]');
  const btnSend = q(mount, '[data-sms-send]');
  const btnReroll = q(mount, '[data-sms-reroll]');
  const btnStash = q(mount, '[data-sms-stash]');
  const input = q(mount, '[data-sms-input]');

  // 返回：会话 -> 列表（不是回 home）
  if (back) {
    back.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSmsView(mount, 'list');
      renderSmsList(mount);
    });
  }

  // Step1 先不启用发送/重roll/暂存（避免你担心“开始做太多”）
  // 但为了 UI 体验，我们把按钮先做成“阻止冒泡+不报错”
  [btnSend, btnReroll, btnStash].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 这里先不做任何事（Step2/3 再接）
    });
  });

  // 输入框 Enter：默认不发送（避免误触），只阻止表单类行为
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
      }
    });
  }
}

function renderSmsList(mount) {
  const engine = getEngine();
  const listWrap = q(mount, '[data-sms-list]');
  if (!listWrap) return;

  listWrap.innerHTML = '';

  // 没引擎：也给你四个“预览联系人卡片”，方便看UI
  if (!engine || typeof engine.listContacts !== 'function') {
    const demo = [
      { id: 'c1', name: '联系人一', avatar: '', preview: '我还想着切点水果给你', time: '22:03', unread: 1 },
      { id: 'c2', name: '联系人二', avatar: '', preview: '电脑在边儿上', time: '22:07', unread: 0 },
      { id: 'c3', name: '联系人三', avatar: '', preview: '下载了维修模式插件', time: '22:10', unread: 2 },
      { id: 'c4', name: '联系人四', avatar: '', preview: '我回去了', time: '22:11', unread: 0 },
    ];

    demo.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'sms-item';
      item.dataset.smsContactId = c.id;

      item.innerHTML = `
        <div class="sms-ava">${c.avatar ? `<img alt="" src="${c.avatar}">` : ``}</div>
        <div class="sms-meta">
          <div class="sms-name">${escapeHtml(c.name)}</div>
          <div class="sms-preview">${escapeHtml(c.preview || '')}</div>
        </div>
        <div class="sms-right">
          <span class="sms-time">${escapeHtml(c.time || '')}</span>
          <span class="sms-dot ${c.unread ? '' : 'hidden'}"></span>
        </div>
      `;

      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSmsThread(mount, c.id, { pushState: true });
      });

      listWrap.appendChild(item);
    });

    return;
  }

  const contacts = engine.listContacts() || [];
  if (!contacts.length) {
    const empty = document.createElement('div');
    empty.className = 'sms-empty';
    empty.textContent = '暂无联系人';
    listWrap.appendChild(empty);
    return;
  }

  contacts.forEach((c) => {
    const id = c.id || c.contactId || c.key || c.name;
    const name = c.name || c.title || '未命名';
    const avatar = c.avatar || c.ava || c.image || '';

    const { preview, timeText, unread } = getContactSummary(engine, id, c);

    const item = document.createElement('div');
    item.className = 'sms-item';
    item.dataset.smsContactId = id;

    item.innerHTML = `
      <div class="sms-ava">${avatar ? `<img alt="" src="${avatar}">` : ``}</div>
      <div class="sms-meta">
        <div class="sms-name">${escapeHtml(name)}</div>
        <div class="sms-preview">${escapeHtml(preview)}</div>
      </div>
      <div class="sms-right">
        <span class="sms-time">${escapeHtml(timeText)}</span>
        <span class="sms-dot ${unread > 0 ? '' : 'hidden'}"></span>
      </div>
    `;

    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSmsThread(mount, id, { pushState: true });
    });

    listWrap.appendChild(item);
  });
}

function getContactSummary(engine, contactId, contactObj) {
  // 1) 未读：优先用 contact 上的字段，否则尝试引擎函数
  let unread = 0;
  unread = Number(contactObj?.unread ?? contactObj?.unreadCount ?? 0) || 0;

  if (!unread && engine && typeof engine.getUnreadCount === 'function') {
    try { unread = Number(engine.getUnreadCount(contactId)) || 0; } catch { }
  }

  // 2) 取最后一条消息：决定预览与时间
  let preview = '';
  let timeText = '';

  try {
    const msgs = engine.getMessages({ contactId, channel: 'phone' }) || [];
    if (msgs.length) {
      const last = msgs[msgs.length - 1];
      const t = (last.text ?? last.content ?? '').toString().trim();
      preview = t.length > 28 ? t.slice(0, 28) + '…' : t;

      const ts = last.ts ?? last.time ?? last.timestamp ?? last.createdAt;
      timeText = formatHHMM(ts);
    } else {
      preview = '暂无短信';
      timeText = '';
    }
  } catch {
    preview = '';
    timeText = '';
  }

  return { preview, timeText, unread };
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
