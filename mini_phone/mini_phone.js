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

  // 防止重复塞入
  if (!mount.dataset.mpMounted) {
    const htmlUrl = new URL('./mini_phone.html?v=1', import.meta.url);
    const res = await fetch(htmlUrl.href);
    const html = await res.text();
    mount.innerHTML = html;
    mount.dataset.mpMounted = '1';
  }

  // 绑定关闭按钮（若存在）
  const closeBtn = mount.querySelector('[data-mp-close]');
  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', () => close());
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
