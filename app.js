(() => {
  // ===== Views =====
  const viewLauncher = document.getElementById('viewLauncher');
  const viewStart = document.getElementById('viewStart');
  const viewMain = document.getElementById('viewMain');
  const windowEl = document.getElementById('window');

  // 关键：chat 是后挂载的，所以不能只在一开始缓存 viewChat
  function setView(target) {
    // 每次都扫一遍现有的 .view（包括后挂载的 viewChat）
    document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
    target?.classList.add('on');
  }

  // ===== Launcher -> Start =====
  const btnClaim = document.getElementById('btnClaim');
  btnClaim?.addEventListener('click', () => {
    setView(viewStart);
    // 进入 start 时，确保主窗是收起状态
    windowEl?.classList.remove('on');
    // 进入 start 时，收起面板
    closeStartPanels();
  });

  // ===== Start menu (tabs -> side panel / overlay) =====
  const startRoot = viewStart?.querySelector('.startPage');
  const startTabs = startRoot ? Array.from(startRoot.querySelectorAll('.startTab')) : [];

  const startSide = document.getElementById('startSide');
  const startOverlay = document.getElementById('startOverlay');
  const startOverlayTitle = document.getElementById('startOverlayTitle');
  const startOverlayBody = document.getElementById('startOverlayBody');
  const startOverlayCloseBtn = document.getElementById('startOverlayCloseBtn');

  const startTpl = {
    api: document.getElementById('startTplApi'),
    help: document.getElementById('startTplHelp'),
    log: document.getElementById('startTplLog'),
    skin: document.getElementById('startTplSkin'),
  };

  const startTitleMap = { api: 'API设置', help: '操作说明', log: '更新日志', skin: '皮肤' };

  function isMobileStart() {
    return window.matchMedia('(max-width: 980px)').matches;
  }

  function renderPanelBody(key) {
    const t = startTpl[key];
    if (!t) return document.createElement('div');
    return t.content.cloneNode(true);
  }

  function closeStartPanels() {
    // desktop side
    if (startSide) {
      startSide.dataset.show = 'false';
      startSide.innerHTML = '';
    }
    // mobile overlay
    if (startOverlay) {
      startOverlay.dataset.open = 'false';
      startOverlay.setAttribute('aria-hidden', 'true');
    }
    if (startOverlayBody) startOverlayBody.innerHTML = '';
  }

  function openStartOverlay(key) {
    if (!startOverlay || !startOverlayBody || !startOverlayTitle) return;
    startOverlayTitle.textContent = startTitleMap[key] || 'PANEL';
    startOverlayBody.innerHTML = '';
    startOverlayBody.appendChild(renderPanelBody(key));
    startOverlay.dataset.open = 'true';
    startOverlay.setAttribute('aria-hidden', 'false');
  }

  function openStartSide(key) {
    if (!startSide) return;

    const panel = document.createElement('div');
    panel.className = 'startPanel';

    const chrome = document.createElement('div');
    chrome.className = 'startChrome';
    chrome.innerHTML = `
      <div class="startLights" aria-hidden="true">
        <span class="startLight"></span><span class="startLight y"></span><span class="startLight g"></span>
      </div>
      <div class="startChromeTitle">${startTitleMap[key] || 'PANEL'}</div>
      <button class="startOverlayCloseBtn" type="button" data-start-close="1">关闭</button>
    `;

    const body = document.createElement('div');
    body.className = 'startPanelBody';
    body.appendChild(renderPanelBody(key));

    panel.appendChild(chrome);
    panel.appendChild(body);

    startSide.innerHTML = '';
    startSide.appendChild(panel);
    startSide.dataset.show = 'true';
  }

  function openStartPanel(key) {
    // 只在 start 页生效
    if (!viewStart?.classList.contains('on')) return;

    if (isMobileStart()) {
      openStartOverlay(key);
    } else {
      openStartSide(key);
    }
  }

  // tabs click
  startTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (!key) return;
      openStartPanel(key);
    });
  });

  // overlay close
  startOverlayCloseBtn?.addEventListener('click', closeStartPanels);

  // desktop close (inside side panel)
  document.addEventListener('click', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.startClose === '1') closeStartPanels();
  });

  // Start center buttons (placeholders)
  document.getElementById('btnWorldbook')?.addEventListener('click', () => alert('世界书（占位）'));
  document.getElementById('btnPresetList')?.addEventListener('click', () => alert('预设列表（占位）'));
  document.getElementById('btnRole')?.addEventListener('click', () => alert('人设（占位）'));
  document.getElementById('btnChatlog')?.addEventListener('click', () => alert('聊天记录（占位）'));
  document.getElementById('btnPresetQuick')?.addEventListener('click', () => alert('预设（占位）'));
  document.getElementById('btnSaveCfg')?.addEventListener('click', () => alert('保存设置（占位）'));
  document.getElementById('btnResetCfg')?.addEventListener('click', () => alert('恢复默认（占位）'));

  // ===== Main window (3 pages) =====
  const pages = document.getElementById('pages');
  const tbTitle = document.getElementById('tbTitle');

  const titles = ['THE TAVERN · ENTRY', 'THE TAVERN · API', 'THE TAVERN · MANUAL'];

  const pageWidth = () => pages?.clientWidth || window.innerWidth;
  const idxFromScroll = () => Math.max(0, Math.min(2, Math.round(pages.scrollLeft / pageWidth())));

  function goto(i) {
    const w = pageWidth();
    pages?.scrollTo({ left: w * i, behavior: 'smooth' });
    if (tbTitle) tbTitle.textContent = titles[i] || titles[0];
  }

  function openMain() {
    setView(viewMain);
    requestAnimationFrame(() => {
      windowEl?.classList.add('on');
      goto(0);
    });
  }

  // ===== Chat open/close (核心接线) =====
  async function openChat() {
    // 进入聊天前，先把 start 的侧栏/遮罩收起来
    closeStartPanels();

    // 确保 chat 挂载完成（如果 chat/chat.js 提供了 ensureMounted）
    if (window.ChatUI && typeof window.ChatUI.ensureMounted === 'function') {
      await window.ChatUI.ensureMounted();
    }

    // 切到 chat view（chat 是后挂载的）
    const chatView = document.getElementById('viewChat');
    if (chatView) setView(chatView);
  }

  function backToStart() {
    setView(viewStart);
    closeStartPanels();
  }

  // Start 页：出发 -> 进聊天（修正：不要 alert）
  document.getElementById('btnGo')?.addEventListener('click', openChat);

  // Main 页：所有 data-action="start" 的出发 -> 进聊天
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-goto],[data-action],#chatBack');
    if (!el) return;

    // chat 返回按钮（挂载后也能点）
    if (el.id === 'chatBack') {
      backToStart();
      return;
    }

    if (el.dataset.goto != null) {
      goto(parseInt(el.dataset.goto, 10));
      return;
    }

    if (el.dataset.action === 'start') {
      openChat();
    }
  });

  pages?.addEventListener('scroll', () => {
    clearTimeout(pages.__t);
    pages.__t = setTimeout(() => {
      if (tbTitle) tbTitle.textContent = titles[idxFromScroll()];
    }, 80);
  });

  // initial: launcher visible
  setView(viewLauncher);
  windowEl?.classList.remove('on');
})();
