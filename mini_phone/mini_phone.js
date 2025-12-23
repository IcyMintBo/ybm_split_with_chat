const CSS_URL = new URL('./mini_phone.css?v=1', import.meta.url).href;

function ensureCss(){
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
  if (!mount) {
    // chat 还没 mount 完，先别报错，等 open 的时候再试
    return false;
  }

  // 先把 HTML 塞进去（否则第一次 querySelector 会找不到 .page/.phone-content）
  if (!mount.dataset.mpMounted) {
    const htmlUrl = new URL('./mini_phone.html?v=1', import.meta.url);
    const res = await fetch(htmlUrl.href);
    const html = await res.text();
    mount.innerHTML = html;
    mount.dataset.mpMounted = '1';
  }

  // ✅ 绑定：图标点击 -> App 打开动效切页；返回按钮（只绑定一次）
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
    }

    function setAppOriginFrom(el) {
      if (!content || !el) return;

      const iconRect = el.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();

      const cx = (iconRect.left + iconRect.right) / 2 - contentRect.left;
      const cy = (iconRect.top + iconRect.bottom) / 2 - contentRect.top;

      content.style.setProperty('--app-x', `${cx}px`);
      content.style.setProperty('--app-y', `${cy}px`);
    }

    // 初始：home
    showPage('home');

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

    // 返回：回 home
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        showPage('home');
        e.preventDefault();
        e.stopPropagation();
      });
    }
  }

  // 点击遮罩关闭
  const mask = byId(MASK_ID);
  if (mask && !mask.dataset.bound) {
    mask.dataset.bound = '1';
    mask.addEventListener('click', () => close());
  }

  mounted = true;
  return true;
}


export async function open() {
  // 确保 DOM 已经有挂载点（移动端更需要这一句）
  if (document.readyState === 'loading') {
    await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  }
  const ok = await ensureMounted();
  if (!ok) {
    // mount 还没出来：不要抛错，直接退出（下次再 open 会成功）
    return;
  }
  setOpen(OVERLAY_ID, true);
  setOpen(MASK_ID, true);
}

export function close() {
  setOpen(OVERLAY_ID, false);
  setOpen(MASK_ID, false);
}

// 暴露给 chat 调用
window.MiniPhone = { open, close };
