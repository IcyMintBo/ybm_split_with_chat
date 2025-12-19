(() => {
  // ===== API Config (Start) =====
  const API_LS_KEY = 'YBM_API_CFG_V1';

  function loadApiCfg() {
    try { return JSON.parse(localStorage.getItem(API_LS_KEY) || '{}'); } catch { return {}; }
  }
  function saveApiCfg(cfg) {
    localStorage.setItem(API_LS_KEY, JSON.stringify(cfg || {}));
  }

  function normalizeBaseUrl(input) {
    let u = (input || '').trim();
    if (!u) return { baseUrl: '', endpoint: '' };

    // 去掉结尾空格/斜杠
    u = u.replace(/\s+/g, '');
    u = u.replace(/\/+$/, '');

    // 如果用户填到了 /chat/completions，裁回 /v1
    u = u.replace(/\/chat\/completions$/i, '');

    // 如果没写 /v1，就补上（你说诺基亚要填完整，我们内部统一到 /v1）
    if (!/\/v1$/i.test(u)) {
      // 如果里面已经有 /v1/xxx，也裁到 /v1
      const m = u.match(/^(.*?\/v1)\b/i);
      if (m && m[1]) u = m[1];
      else u = u + '/v1';
    }

    const endpoint = u.replace(/\/+$/, '') + '/chat/completions';
    return { baseUrl: u, endpoint };
  }

  async function fetchModels({ baseUrl, apiKey }) {
    const url = baseUrl.replace(/\/+$/, '') + '/models';
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) throw new Error(`模型拉取失败 ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data?.data) ? data.data : [];
    return list.map(x => x?.id).filter(Boolean).sort();
  }

  async function testChat({ baseUrl, apiKey, model }) {
    const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = {
      model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'ping' }
      ],
      temperature: 0.2,
      stream: false
    };

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`测试失败 ${res.status}\n${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return text;
  }

  function isApiReady() {
    const cfg = loadApiCfg();
    return !!(cfg.baseUrl && cfg.apiKey && cfg.model);
  }

  function markApiAttention(on) {
    const apiTab = document.querySelector('.startTab[data-key="api"]');
    if (!apiTab) return;
    if (on) apiTab.classList.add('attn');
    else apiTab.classList.remove('attn');
  }

  function shakeApiTab() {
    const apiTab = document.querySelector('.startTab[data-key="api"]');
    if (!apiTab) return;
    apiTab.classList.remove('shake');
    // 强制 reflow
    void apiTab.offsetWidth;
    apiTab.classList.add('shake');
  }

  // 绑定 API 面板（每次打开面板都会重新生成 DOM，所以要重新绑定）
  function bindStartApiPanel(panelRoot) {
    if (!panelRoot) return;

    const elBase = panelRoot.querySelector('#apiBaseUrl');
    const elKey = panelRoot.querySelector('#apiKey');
    const elProvider = panelRoot.querySelector('#apiProvider');
    const elModelSel = panelRoot.querySelector('#apiModelSelect');
    const elStatus = panelRoot.querySelector('#apiStatus');
    const btnConnect = panelRoot.querySelector('#btnApiConnect');
    const btnTest = panelRoot.querySelector('#btnApiTest');
    const btnSave = panelRoot.querySelector('#btnApiSave');
    const elKeyToggle = panelRoot.querySelector('#apiKeyToggle');


    const cfg = loadApiCfg();
    if (cfg.provider && elProvider) elProvider.value = cfg.provider;
    if (cfg.baseUrl && elBase) elBase.value = cfg.baseUrl;
    if (cfg.apiKey && elKey) elKey.value = cfg.apiKey;


    // 若已有模型，放进去
    if (cfg.model) {
      elModelSel.innerHTML = `<option value="${cfg.model}">${cfg.model}</option>`;
      elModelSel.value = cfg.model;
      btnTest.disabled = false;
      btnSave.disabled = false;
      elStatus.textContent = '已加载本地配置：可直接测试或保存';
    }

    elBase?.addEventListener('blur', () => {
      const n = normalizeBaseUrl(elBase.value || '');
      if (n.baseUrl) elBase.value = n.baseUrl; // 自动补全到 /v1
    });


    function setStatus(msg) {
      if (elStatus) elStatus.textContent = msg;
    }
    // 显示/隐藏 API Key（默认 password）
    elKeyToggle?.addEventListener('click', () => {
      if (!elKey) return;
      elKey.type = (elKey.type === 'password') ? 'text' : 'password';
      elKeyToggle.textContent = (elKey.type === 'password') ? '👁' : '🙈';
    });

    btnConnect?.addEventListener('click', async () => {
      const n = normalizeBaseUrl(elBase?.value || '');
      const apiKey = (elKey?.value || '').trim();
      const provider = elProvider?.value || 'openai';

      if (!n.baseUrl || !apiKey) {
        setStatus('请先填写 Base URL 和 API Key 再连接。');
        markApiAttention(true);
        shakeApiTab();
        return;
      }

      setStatus('连接中：拉取模型列表…');
      btnConnect.disabled = true;

      try {
        const models = await fetchModels({ baseUrl: n.baseUrl, apiKey });
        if (!models.length) throw new Error('模型列表为空（接口可能不兼容 /models）');

        elModelSel.innerHTML = `<option value="">请选择模型</option>` + models.map(id => `<option value="${id}">${id}</option>`).join('');
        setStatus(`连接成功：已获取 ${models.length} 个模型。\n请选择模型后再点测试。`);

        // 先存 baseUrl/key/provider（模型还没选）
        saveApiCfg({ provider, baseUrl: n.baseUrl, apiKey, model: '' });

        btnTest.disabled = true;
        btnSave.disabled = true;
        markApiAttention(true);
      } catch (e) {
        setStatus(`连接失败：${e?.message || e}`);
        markApiAttention(true);
        shakeApiTab();
      } finally {
        btnConnect.disabled = false;
      }
    });

    elModelSel?.addEventListener('change', () => {
      const n = normalizeBaseUrl(elBase?.value || '');
      const apiKey = (elKey?.value || '').trim();
      const provider = elProvider?.value || 'openai';
      const model = (elModelSel.value || '').trim();

      const prev = loadApiCfg();
      saveApiCfg({ ...prev, provider, baseUrl: n.baseUrl, apiKey, model });

      if (model) {
        btnTest.disabled = false;
        btnSave.disabled = false;
        setStatus(`已选择模型：${model}\n现在可以点击“测试”。`);
      } else {
        btnTest.disabled = true;
        btnSave.disabled = true;
      }
    });

    btnTest?.addEventListener('click', async () => {
      const cfgNow = loadApiCfg();
      if (!(cfgNow.baseUrl && cfgNow.apiKey && cfgNow.model)) {
        setStatus('请先连接并选择模型。');
        markApiAttention(true);
        shakeApiTab();
        return;
      }

      setStatus('测试中：发送 ping…');
      btnTest.disabled = true;

      try {
        const reply = await testChat({ baseUrl: cfgNow.baseUrl, apiKey: cfgNow.apiKey, model: cfgNow.model });
        setStatus(`✅ 测试成功\n模型回复：\n${reply || '（空）'}`);
        // 测试成功后认为 API 已配置完成
        markApiAttention(false);
      } catch (e) {
        setStatus(`❌ 测试失败：${e?.message || e}`);
        markApiAttention(true);
        shakeApiTab();
      } finally {
        btnTest.disabled = false;
      }
    });

    btnSave?.addEventListener('click', () => {
      const cfgNow = loadApiCfg();
      if (!(cfgNow.baseUrl && cfgNow.apiKey && cfgNow.model)) {
        setStatus('请先连接并选择模型，再保存。');
        markApiAttention(true);
        shakeApiTab();
        return;
      }
      setStatus('✅ 已保存到本地（localStorage）。');
      markApiAttention(false);
    });
  }

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
    const frag = renderPanelBody(key);
    startOverlayBody.appendChild(frag);

    // ✅ 绑定 API 面板逻辑
    if (key === 'api') bindStartApiPanel(startOverlayBody);

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

    // ✅ 绑定 API 面板逻辑
    if (key === 'api') bindStartApiPanel(body);


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

  document.getElementById('btnGo')?.addEventListener('click', async () => {
    if (!isApiReady()) {
      markApiAttention(true);
      shakeApiTab();
      openStartPanel('api'); // 强制引导先配 API
      return;
    }
    markApiAttention(false);
    await openChat();        // ✅ 直接进聊天
  });


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
