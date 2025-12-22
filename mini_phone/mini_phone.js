// mini_phone.js (module)
const MOUNT_ID = 'miniPhoneMount';
const OVERLAY_ID = 'phoneOverlay';
const MASK_ID = 'phoneMask';

let mounted = false;

async function ensureMounted(){
  if (mounted) return;

  const mount = document.getElementById(MOUNT_ID);
  if (!mount) return;

  // 把独立 html 塞进挂载点
  const res = await fetch('../mini_phone/mini_phone.html?v=1');
  const html = await res.text();
  mount.innerHTML = html;

  // 绑定关闭按钮
  mount.querySelector('[data-mp-close]')?.addEventListener('click', close);

  mounted = true;
}

function setOpen(id, on){
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = on ? '' : 'none';
  el.setAttribute('aria-hidden', on ? 'false' : 'true');
}

export async function open(){
  await ensureMounted();
  setOpen(OVERLAY_ID, true);
  setOpen(MASK_ID, true);
}

export function close(){
  setOpen(OVERLAY_ID, false);
  setOpen(MASK_ID, false);
}

// 暴露给 chat 调用
window.MiniPhone = { open, close };
