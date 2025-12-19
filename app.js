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
  btnWorldbook.onclick = openWorldbookPanel;
  btnPresetList.onclick = openPresetPanel;
  document.getElementById('btnRole')?.addEventListener('click', () => alert('人设（占位）'));
  document.getElementById('btnChatlog')?.addEventListener('click', () => alert('聊天记录（占位）'));
  document.getElementById('btnPresetQuick')?.addEventListener('click', () => alert('正则（占位）'));
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
  /* =========================
   * 世界书配置（YBM_PROMPT_CFG_V1）
   * ========================= */

  const PROMPT_KEY = 'YBM_PROMPT_CFG_V1';

  function loadPromptCfg() {
    try {
      const cfg = JSON.parse(localStorage.getItem(PROMPT_KEY));
      if (cfg) return cfg;
    } catch { }
    // 默认结构
    return {
      version: 1,
      activeContactId: 'ybm',
      contacts: [
        { id: 'ybm', name: '岩白眉' },
        { id: 'dantuo', name: '但拓' },
        { id: 'c3', name: '联系人三' },
        { id: 'c4', name: '联系人四' }
      ],
      worldbook: {
        global: [],
        contact: {
          ybm: [],
          dantuo: [],
          c3: [],
          c4: []
        }
      }
    };
  }

  function savePromptCfg(cfg) {
    localStorage.setItem(PROMPT_KEY, JSON.stringify(cfg));
  }
  function openWorldbookPanel() {
    const cfg = loadPromptCfg();

    // 避免重复打开
    const old = document.querySelector('.wbModal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.className = 'wbModal';

    modal.innerHTML = `
    <div class="wbBackdrop" data-close="1"></div>

    <div class="wbCard" role="dialog" aria-label="世界书">
      <div class="wbTopbar">
        <div class="wbDots" aria-hidden="true">
          <span class="wbDot r"></span><span class="wbDot y"></span><span class="wbDot g"></span>
        </div>
        <div class="wbTopTitle">世界书</div>
        <button class="wbCloseBtn" type="button">关闭</button>
      </div>

      <div class="wbBody">
        <!-- 全局 -->
        <section class="wbSection">
          <div class="wbSectionHead">
            <div class="wbSectionTitle">全局世界书</div>
            <div class="wbSectionSub">（总是注入）</div>
            <button class="wbBtn wbBtnGhost wbAdd" data-scope="global" type="button">＋ 新增</button>
          </div>
          <div class="wbList" id="wb-global"></div>
        </section>

        <!-- 联系人 -->
        <section class="wbSection">
          <div class="wbSectionHead">
            <div class="wbSectionTitle">联系人世界书</div>
            <div class="wbSectionSub">（当前：${getActiveContactName(cfg)}）</div>
            <button class="wbBtn wbBtnGhost wbAdd" data-scope="contact" type="button">＋ 新增</button>
          </div>
          <div class="wbHint">联系人切换由「聊天页切换按钮 / 小手机联系人」决定。这里会自动跟随。</div>
          <div class="wbList" id="wb-contact"></div>
        </section>

        <!-- 导入导出（先给口子，后面再接功能） -->
        <section class="wbSection">
          <div class="wbSectionHead">
            <div class="wbSectionTitle">备份</div>
            <div class="wbSectionSub">（JSON）</div>
<div class="wbRowBtns">
  <button class="wbBtn wbBtnPrimary" id="wb-load-default" type="button">载入默认</button>
  <button class="wbBtn" id="wb-import-file" type="button">导入文件</button>
  <button class="wbBtn wbBtnPrimary" id="wb-export-file" type="button">导出下载</button>
</div>

          </div>
          <textarea id="wb-io" class="wbTextarea" placeholder="导入/导出用的 JSON 会出现在这里"></textarea>
          <input id="wb-file" type="file" accept="application/json" style="display:none;">
        </section>
      </div>
    </div>
  `;

    document.body.appendChild(modal);

    // 关闭
    const close = () => modal.remove();
    modal.querySelector('.wbCloseBtn').onclick = close;
    modal.querySelector('.wbBackdrop').onclick = close;

    // 列表渲染
    renderWorldbookList(cfg, 'global');
    renderWorldbookList(cfg, 'contact');

    // 新增
    modal.querySelectorAll('.wbAdd').forEach(btn => {
      btn.onclick = () => {
        const scope = btn.dataset.scope;
        addWorldbookEntry(cfg, scope);
        savePromptCfg(cfg);
        renderWorldbookList(cfg, scope);
      };
    });

    // 导出/导入（先最小实现）
    const io = modal.querySelector('#wb-io');
    const fileEl = modal.querySelector('#wb-file');

    // 1) 载入默认（从项目里的 default_worldbook.json 拉取，并覆盖当前配置）
    modal.querySelector('#wb-load-default').onclick = async () => {
      try {
        const res = await fetch('./default_worldbook.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('默认文件不存在或无法读取');
        const next = await res.json();

        savePromptCfg(next);
        const cfg2 = loadPromptCfg();

        // 重新渲染
        renderWorldbookList(cfg2, 'global');
        renderWorldbookList(cfg2, 'contact');

        // 标题刷新（当前联系人名）
        const sub = modal.querySelectorAll('.wbSectionSub')[1];
        if (sub) sub.textContent = `（当前：${getActiveContactName(cfg2)}）`;

        io.value = JSON.stringify(cfg2, null, 2);
        alert('已载入默认世界书（覆盖当前配置）');
      } catch (e) {
        alert('载入失败：请确认项目根目录存在 default_worldbook.json');
      }
    };

    // 2) 导入文件（选择一个 json，覆盖当前配置）
    modal.querySelector('#wb-import-file').onclick = () => fileEl.click();

    fileEl.onchange = async () => {
      const f = fileEl.files && fileEl.files[0];
      if (!f) return;
      try {
        const text = await f.text();
        const next = JSON.parse(text);

        savePromptCfg(next);
        const cfg2 = loadPromptCfg();

        renderWorldbookList(cfg2, 'global');
        renderWorldbookList(cfg2, 'contact');

        const sub = modal.querySelectorAll('.wbSectionSub')[1];
        if (sub) sub.textContent = `（当前：${getActiveContactName(cfg2)}）`;

        io.value = JSON.stringify(cfg2, null, 2);
        alert('导入成功（覆盖当前配置）');
      } catch (e) {
        alert('导入失败：JSON 格式不正确');
      } finally {
        fileEl.value = '';
      }
    };

    // 3) 导出下载（把当前配置下载成 json 文件）
    modal.querySelector('#wb-export-file').onclick = () => {
      const cfgNow = loadPromptCfg();
      const blob = new Blob([JSON.stringify(cfgNow, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `worldbook_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      io.value = JSON.stringify(cfgNow, null, 2);
    };


  }
  function openPresetPanel() {
    const cfg = loadPromptCfg();

    // 避免重复打开
    const old = document.querySelector('.presetModal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.className = 'wbModal presetModal';

    modal.innerHTML = `
    <div class="wbBackdrop" data-close="1"></div>

    <div class="wbCard" role="dialog" aria-label="预设">
      <div class="wbTopbar">
        <div class="wbDots" aria-hidden="true">
          <span class="wbDot r"></span><span class="wbDot y"></span><span class="wbDot g"></span>
        </div>
        <div class="wbTopTitle">预设</div>
        <button class="wbCloseBtn" type="button">关闭</button>
      </div>

      <div class="wbBody">
        <section class="wbSection">
          <div class="wbSectionHead">
            <div class="wbSectionTitle">全局预设</div>
            <div class="wbSectionSub">（system 注入）</div>
            <button class="wbBtn wbBtnGhost presetAdd" type="button">＋ 新增</button>
          </div>

          <div class="wbHint">预设用于固定风格/规则/写法等，会拼在世界书后面一起发给模型。</div>

          <div class="wbList" id="preset-global"></div>
        </section>

        <section class="wbSection">
          <div class="wbSectionHead">
            <div class="wbSectionTitle">备份</div>
            <div class="wbSectionSub">（JSON）</div>
<div class="wbRowBtns">
  <button class="wbBtn wbBtnPrimary" id="preset-load-default" type="button">载入默认</button>
  <button class="wbBtn" id="preset-export" type="button">导出</button>
  <button class="wbBtn wbBtnPrimary" id="preset-import" type="button">导入</button>
</div>
          </div>
          <textarea id="preset-io" class="wbTextarea" placeholder="把 JSON 粘贴到这里导入 / 或点击导出"></textarea>
        </section>
      </div>
    </div>
  `;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.wbCloseBtn').onclick = close;
    modal.querySelector('.wbBackdrop').onclick = close;

    // 确保字段存在
    if (!cfg.presets) cfg.presets = { global: [] };
    if (!Array.isArray(cfg.presets.global)) cfg.presets.global = [];

    renderPresetList(cfg);

    // 新增
    modal.querySelector('.presetAdd').onclick = () => {
      cfg.presets.global.push({
        id: Math.random().toString(36).slice(2),
        title: '新预设',
        content: '',
        enabled: true
      });
      savePromptCfg(cfg);
      renderPresetList(cfg);
    };
    // 载入默认预设（从项目 default_presets.json 拉取，并覆盖 cfg.presets.global）
    modal.querySelector('#preset-load-default').onclick = async () => {
      try {
        const res = await fetch('./default_presets.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('默认文件不存在或无法读取');

        const def = await res.json();
        if (!def.presets || !Array.isArray(def.presets.global)) {
          alert('载入失败：default_presets.json 缺少 presets.global 数组');
          return;
        }

        // 覆盖当前预设
        if (!cfg.presets) cfg.presets = { global: [] };
        cfg.presets.global = def.presets.global;

        savePromptCfg(cfg);
        renderPresetList(cfg);

        const io = modal.querySelector('#preset-io');
        if (io) io.value = JSON.stringify({ version: 1, presets: { global: cfg.presets.global } }, null, 2);

        alert('已载入默认预设（覆盖当前预设）');
      } catch (e) {
        alert('载入失败：请确认项目根目录存在 default_presets.json');
      }
    };

    // 导入/导出（最小实现）
    const io = modal.querySelector('#preset-io');

    modal.querySelector('#preset-export').onclick = () => {
      const out = { version: 1, presets: { global: cfg.presets.global } };
      io.value = JSON.stringify(out, null, 2);
      io.focus(); io.select();
    };

    modal.querySelector('#preset-import').onclick = () => {
      try {
        const next = JSON.parse(io.value || '{}');
        if (!next.presets || !Array.isArray(next.presets.global)) {
          alert('导入失败：缺少 presets.global 数组');
          return;
        }
        cfg.presets.global = next.presets.global;
        savePromptCfg(cfg);
        renderPresetList(cfg);
        alert('导入成功');
      } catch {
        alert('导入失败：JSON 格式不正确');
      }
    };
  }
  function renderPresetList(cfg) {
    const wrap = document.getElementById('preset-global');
    if (!wrap) return;

    wrap.innerHTML = '';

    cfg.presets.global.forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'wbRow';

      row.innerHTML = `
      <label class="wbToggle">
        <input type="checkbox" ${p.enabled ? 'checked' : ''}>
        <span class="wbToggleTrack"></span>
      </label>

      <div class="wbEntryMain">
        <div class="wbEntryTitle">${escapeHtml(p.title || '（未命名）')}</div>
        <div class="wbEntryMeta">${(p.content || '').length} 字</div>
      </div>

      <div class="wbEntryBtns">
        <button class="wbBtn wbBtnMini" data-act="up" type="button">↑</button>
        <button class="wbBtn wbBtnMini" data-act="down" type="button">↓</button>
        <button class="wbBtn wbBtnMini" data-act="edit" type="button">编辑</button>
        <button class="wbBtn wbBtnMini wbBtnDanger" data-act="del" type="button">删除</button>
      </div>
    `;

      const chk = row.querySelector('input');
      chk.onchange = () => {
        p.enabled = chk.checked;
        savePromptCfg(cfg);
        renderPresetList(cfg);
      };

      row.querySelector('[data-act="up"]').onclick = () => {
        if (idx <= 0) return;
        const t = cfg.presets.global[idx - 1];
        cfg.presets.global[idx - 1] = cfg.presets.global[idx];
        cfg.presets.global[idx] = t;
        savePromptCfg(cfg);
        renderPresetList(cfg);
      };

      row.querySelector('[data-act="down"]').onclick = () => {
        if (idx >= cfg.presets.global.length - 1) return;
        const t = cfg.presets.global[idx + 1];
        cfg.presets.global[idx + 1] = cfg.presets.global[idx];
        cfg.presets.global[idx] = t;
        savePromptCfg(cfg);
        renderPresetList(cfg);
      };

      row.querySelector('[data-act="edit"]').onclick = () => {
        const title = prompt('标题', p.title || '');
        if (title === null) return;
        const content = prompt('内容', p.content || '');
        if (content === null) return;
        p.title = title;
        p.content = content;
        savePromptCfg(cfg);
        renderPresetList(cfg);
      };

      row.querySelector('[data-act="del"]').onclick = () => {
        cfg.presets.global.splice(idx, 1);
        savePromptCfg(cfg);
        renderPresetList(cfg);
      };

      wrap.appendChild(row);
    });
  }


  function getActiveContactName(cfg) {
    const c = cfg.contacts.find(c => c.id === cfg.activeContactId);
    return c ? c.name : cfg.activeContactId;
  }
  function renderWorldbookList(cfg, scope) {
    const listEl = document.getElementById(
      scope === 'global' ? 'wb-global' : 'wb-contact'
    );
    if (!listEl) return;

    const entries =
      scope === 'global'
        ? cfg.worldbook.global
        : cfg.worldbook.contact[cfg.activeContactId];

    listEl.innerHTML = '';

    entries.forEach((e, idx) => {
      const row = document.createElement('div');
      row.className = 'wb-row';
      row.innerHTML = `
  <label class="wbToggle">
    <input type="checkbox" ${e.enabled ? 'checked' : ''}>
    <span class="wbToggleTrack"></span>
  </label>

  <div class="wbEntryMain">
    <div class="wbEntryTitle">${escapeHtml(e.title || '（未命名）')}</div>
    <div class="wbEntryMeta">${e.content.length} 字</div>
  </div>

  <div class="wbEntryBtns">
    <button class="wbBtn wbBtnMini" data-act="edit" type="button">编辑</button>
    <button class="wbBtn wbBtnMini wbBtnDanger" data-act="del" type="button">删除</button>
  </div>
`;


      const [chk] = row.querySelectorAll('input');
      chk.onchange = () => {
        e.enabled = chk.checked;
        savePromptCfg(cfg);
      };

      row.querySelector('[data-act="edit"]').onclick = () => {
        const title = prompt('标题', e.title || '');
        if (title === null) return;
        const content = prompt('内容', e.content || '');
        if (content === null) return;
        e.title = title;
        e.content = content;
        savePromptCfg(cfg);
        renderWorldbookList(cfg, scope);
      };

      row.querySelector('[data-act="del"]').onclick = () => {
        entries.splice(idx, 1);
        savePromptCfg(cfg);
        renderWorldbookList(cfg, scope);
      };

      listEl.appendChild(row);
    });
  }

  function addWorldbookEntry(cfg, scope) {
    const entry = {
      id: Math.random().toString(36).slice(2),
      title: '',
      content: '',
      enabled: true
    };

    if (scope === 'global') {
      cfg.worldbook.global.push(entry);
    } else {
      cfg.worldbook.contact[cfg.activeContactId].push(entry);
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // initial: launcher visible
  setView(viewLauncher);
  windowEl?.classList.remove('on');
})();
