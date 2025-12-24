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
  if (!mount) return false;

  // 1) 塞入 HTML（只做一次）
  if (!mount.dataset.mpMounted) {
    const htmlUrl = new URL('./mini_phone.html?v=1', import.meta.url);
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

    function setHome(isHome){
      if (shell) shell.classList.toggle('is-home', isHome);
      if (backBtn) backBtn.classList.toggle('hidden', isHome);
    }

    function showPage(name){
      pages.forEach(p=>{
        const isTarget = p.classList.contains(`page-${name}`);
        p.classList.toggle('active', isTarget);
      });
      setHome(name === 'home');
    }

    // 初始：home
    showPage('home');
        // ====== Home：左右切换角色（复用 mpTab1~4 radio） ======
    (function bindSwitchBar(){
      const prevBtn = mount.querySelector('.mp-prev');
      const nextBtn = mount.querySelector('.mp-next');
      const panelBody = mount.querySelector('.mp-panel-body');
      const radios = Array.from(mount.querySelectorAll('input[name="mpTab"]'));

      if (!prevBtn || !nextBtn || !panelBody || radios.length < 2) return;
      if (mount.dataset.mpSwitchBound) return;
      mount.dataset.mpSwitchBound = '1';

      function getIndex(){
        const i = radios.findIndex(r => r.checked);
        return i >= 0 ? i : 0;
      }

      function setIndex(nextIndex, dir){
        const from = getIndex();
        const to = (nextIndex + radios.length) % radios.length;
        if (from === to) return;

        // 轻量滑动：给 panelBody 一个动画 class，再切 radio
        panelBody.classList.remove('slide-left','slide-right');
        void panelBody.offsetWidth; // reflow 触发动画
        panelBody.classList.add(dir === 'left' ? 'slide-left' : 'slide-right');

        radios[to].checked = true;

        setTimeout(()=> {
          panelBody.classList.remove('slide-left','slide-right');
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


    function setAppOriginFrom(el){
      if (!content || !el) return;

      const iconRect = el.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();

      const cx = (iconRect.left + iconRect.right) / 2 - contentRect.left;
      const cy = (iconRect.top + iconRect.bottom) / 2 - contentRect.top;

      content.style.setProperty('--app-x', `${cx}px`);
      content.style.setProperty('--app-y', `${cy}px`);
    }

    // 图标：带 data-page 的都当按钮
    mount.querySelectorAll('[data-page]').forEach(icon=>{
      icon.style.cursor = 'pointer';
      icon.addEventListener('click', (e)=>{
        const page = icon.getAttribute('data-page');
        if (!page) return;

        setAppOriginFrom(icon);
        showPage(page);

        e.preventDefault();
        e.stopPropagation();
      });
    });

    // 返回：回 home
    if (backBtn){
      backBtn.addEventListener('click', (e)=>{
        showPage('home');
        e.preventDefault();
        e.stopPropagation();
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

// 暴露给 chat 调用
window.MiniPhone = { open, close };
