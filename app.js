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
  // 针对部分兼容网关（如 tiantianai.pro）授权头不完全一致
  function buildAuthHeader(baseUrl, apiKey) {
    if (!apiKey) return {};
    const key = apiKey.trim();
    if (!key) return {};
    const lower = (baseUrl || '').toLowerCase();

    // tiantianai：很多示例是 Authorization: sk-xxx（不带 Bearer）
    if (lower.includes('tiantianai.pro')) {
      return { Authorization: key };
    }

    // 默认：Bearer
    let auth = key;
    if (!/^bearer\s+/i.test(auth)) auth = `Bearer ${auth}`;
    return { Authorization: auth };
  }

  async function fetchModels({ baseUrl, apiKey }) {
    const url = baseUrl.replace(/\/+$/, '') + '/models';
    const headers = { 'Content-Type': 'application/json' };
    Object.assign(headers, buildAuthHeader(baseUrl, apiKey));

    const res = await fetch(url, { method: 'GET', headers });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`模型拉取失败 ${res.status}\n${t.slice(0, 200)}`);
    }

    const data = await res.json().catch(() => ({}));
    const list = Array.isArray(data?.data) ? data.data : [];
    return list.map(x => x?.id).filter(Boolean).sort();
  }


  async function testChat({ baseUrl, apiKey, model }) {
    const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    Object.assign(headers, buildAuthHeader(baseUrl, apiKey));

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
      throw new Error(`测试失败 ${res.status}\n${t.slice(0, 300)}`);
    }

    const data = await res.json().catch(() => ({}));
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
  const PROMPT_LS_KEY = 'YBM_PROMPT_CFG_V1';

  function loadPromptCfg() {
    try { return JSON.parse(localStorage.getItem(PROMPT_LS_KEY) || 'null'); } catch { return null; }
  }
  window.initDefaultPromptCfgIfEmpty = initDefaultPromptCfgIfEmpty;
  function savePromptCfg(cfg) {
    localStorage.setItem(PROMPT_LS_KEY, JSON.stringify(cfg || {}));
  }
  async function initDefaultPromptCfgIfEmpty() {
    // 只在第一次 / 或 worldbook/presets 缺失时导入默认
    const cfg = loadPromptCfg();
    const hasWB = !!(cfg && cfg.worldbook && (Array.isArray(cfg.worldbook.global) || cfg.worldbook.contact));
    const hasPresets = !!(cfg && cfg.presets && Array.isArray(cfg.presets.global));

    if (hasWB && hasPresets) return; // 都有了就不动

    // 如果 cfg 不存在，先给一个基础壳
    const base = (cfg && typeof cfg === 'object') ? cfg : { version: 1 };
    if (!base.contacts) base.contacts = [
      { id: 'ybm', name: '岩白眉' },
      { id: 'caishu', name: '猜叔' },
      { id: 'dantuo', name: '但拓' },
      { id: 'zhoubin', name: '州槟' }
    ];
    if (!base.activeContactId) base.activeContactId = base.contacts[0].id;

    // 并行拉默认 worldbook/presets（不存在也不致命）
    try {
      if (!hasWB) {
        const r = await fetch('./default_worldbook.json', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j.worldbook) base.worldbook = j.worldbook;
        }
      }
    } catch { }

    try {
      if (!hasPresets) {
        const r = await fetch('./default_presets.json', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j.presets) base.presets = j.presets;
        }
      }
    } catch { }

    // 如果默认文件没拉到，也保证结构存在
    if (!base.worldbook) base.worldbook = { global: [], contact: {} };
    if (!base.worldbook.contact) base.worldbook.contact = {};
    if (!base.presets) base.presets = { global: [] };

    savePromptCfg(base);
  }


  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function ensurePromptCfg() {
    let cfg = loadPromptCfg();
    if (!cfg || typeof cfg !== 'object') cfg = { version: 1 };

    if (!Array.isArray(cfg.contacts) || cfg.contacts.length === 0) {
      cfg.contacts = [
        { id: 'ybm', name: '岩白眉' },
        { id: 'caishu', name: '猜叔' },
        { id: 'dantuo', name: '但拓' },
        { id: 'zhoubin', name: '州槟' }
      ];
    }
    if (!cfg.activeContactId) cfg.activeContactId = cfg.contacts[0].id;

    // ✅ 世界书：数组结构（匹配 phoneEngine）
    if (!cfg.worldbook || typeof cfg.worldbook !== 'object') cfg.worldbook = {};
    if (!Array.isArray(cfg.worldbook.global)) cfg.worldbook.global = [];
    if (!cfg.worldbook.contact || typeof cfg.worldbook.contact !== 'object') cfg.worldbook.contact = {};
    cfg.contacts.forEach(c => {
      if (!Array.isArray(cfg.worldbook.contact[c.id])) cfg.worldbook.contact[c.id] = [];
    });

    // ✅ 预设：数组结构（匹配 phoneEngine）
    if (!cfg.presets || typeof cfg.presets !== 'object') cfg.presets = {};
    if (!Array.isArray(cfg.presets.global)) cfg.presets.global = [];

    savePromptCfg(cfg);
    return cfg;
  }

  function getActiveContactName(cfg) {
    const cid = cfg?.activeContactId;
    const hit = (cfg?.contacts || []).find(c => c.id === cid);
    return hit?.name || cid || '未选择';
  }

  function makeWbItem() {
    return { id: Math.random().toString(36).slice(2), title: '新条目', content: '', enabled: true };
  }
  function makePresetItem() {
    return { id: Math.random().toString(36).slice(2), title: '新预设', content: '', enabled: true };
  }

  function renderWorldbookList(root, cfg, scope) {
    // 注入一次性样式：不让用户碰 css 文件，也保证全端一致
    if (!document.getElementById('ybm-wb-style')) {
      const st = document.createElement('style');
      st.id = 'ybm-wb-style';
      st.textContent = `
      .ybmWbList { max-height: 56vh; overflow:auto; padding-right:6px; box-sizing:border-box; }
      .ybmWbRow {
        display:block;
        border:2px solid rgba(0,0,0,.18);
        border-radius:18px;
        background: rgba(255,255,255,.35);
        padding:12px 12px 10px;
        margin: 10px 0;
        box-shadow: 0 8px 18px rgba(0,0,0,.06);
      }
      .ybmWbTop {
        display:flex; align-items:center; gap:10px;
      }
      .ybmWbTopLeft { display:flex; align-items:center; gap:10px; min-width:0; flex: 1; }
      .ybmWbTitlePill {
        display:inline-flex; align-items:center;
        padding: 8px 12px;
        border-radius: 999px;
        border: 2px solid rgba(0,0,0,.2);
        background: rgba(255,255,255,.55);
        font-weight: 700;
        max-width: 100%;
        min-width: 0;
      }
      .ybmWbTitleInput {
        border: none; outline:none; background:transparent;
        font: inherit; font-weight:700;
        width: 100%;
        min-width: 0;
      }
      .ybmWbMeta {
        margin-top: 8px;
        display:flex; align-items:center; justify-content:space-between;
        gap: 10px; flex-wrap:wrap;
      }
      .ybmWbMiniInfo { font-size:12px; opacity:.75; padding-left:2px; }
      .ybmWbBtns { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
      .ybmWbBtnMini {
        border-radius: 999px;
        padding: 6px 10px;
        border: 2px solid rgba(0,0,0,.22);
        background: rgba(255,255,255,.45);
        font-weight: 700;
      }
      .ybmWbBtnDanger {
        background: rgba(255,182,193,.35);
        border-color: rgba(120,0,0,.25);
      }

      .ybmLampGroup { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
      .ybmLamp {
        display:inline-flex; align-items:center; gap:8px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 2px solid rgba(0,0,0,.18);
        background: rgba(255,255,255,.35);
        user-select:none;
      }
      .ybmLampDot {
        width: 14px; height: 14px; border-radius: 999px;
        border: 2px solid rgba(0,0,0,.35);
        background: rgba(0,0,0,.08);
        box-shadow: inset 0 0 0 2px rgba(255,255,255,.35);
      }
      .ybmLampOn .ybmLampDot { box-shadow: 0 0 0 4px rgba(0,0,0,.06), inset 0 0 0 2px rgba(255,255,255,.35); }
      .ybmLampLabel { font-size: 12px; font-weight: 800; letter-spacing: .5px; opacity:.9; }

      .ybmLampGreen.ybmLampOn .ybmLampDot { background: rgba(60,190,110,.9); border-color: rgba(30,120,70,.55); }
      .ybmLampBlue.ybmLampOn .ybmLampDot  { background: rgba(70,140,255,.92); border-color: rgba(30,70,160,.55); }

      .ybmWbKwWrap { display:flex; gap:10px; align-items:center; flex:1; min-width: 220px; }
      .ybmWbKeyword {
        width:100%; min-width:0;
        border-radius: 999px;
        padding: 7px 10px;
        border: 2px solid rgba(0,0,0,.18);
        background: rgba(255,255,255,.50);
        outline:none;
      }

      .ybmWbEditor { margin-top:10px; }
      .ybmWbTextarea {
        width: 100%;
        min-height: 92px;
        border-radius: 14px;
        padding: 10px 12px;
        border: 2px solid rgba(0,0,0,.18);
        background: rgba(255,255,255,.55);
        outline:none;
        resize: vertical;
      }
      .ybmHidden { display:none !important; }

      @media (max-width: 520px) {
        .ybmWbTop { flex-direction: column; align-items: stretch; }
        .ybmLampGroup { justify-content:flex-start; }
        .ybmWbKwWrap { min-width: 0; flex: 1 1 100%; }
        .ybmWbBtns { justify-content:flex-start; }
      }
    `;
      document.head.appendChild(st);
    }

    const cid = cfg.activeContactId;

    const listEl =
      scope === 'global'
        ? (root.querySelector('#wb-global-list') || root.querySelector('#wbListGlobal'))
        : (root.querySelector('#wb-contact-list') || root.querySelector('#wbListContact'));

    if (!listEl) return;

    listEl.classList.add('ybmWbList');

    const arr =
      scope === 'global'
        ? (cfg.worldbook.global || [])
        : (cfg.worldbook.contact?.[cid] || []);

    listEl.innerHTML = '';

    if (!arr.length) {
      const empty = document.createElement('div');
      empty.className = 'wbEmpty';
      empty.textContent = '暂无条目，点“＋新增”创建。';
      listEl.appendChild(empty);
      return;
    }

    arr.forEach((it, idx) => {
      if (!it.injectMode) it.injectMode = 'always'; // always | keyword
      if (it.keyword == null) it.keyword = '';
      if (typeof it.enabled !== 'boolean') it.enabled = true;
      if (typeof it.title !== 'string') it.title = it.title ? String(it.title) : '新条目';
      if (typeof it.content !== 'string') it.content = it.content ? String(it.content) : '';

      const isAlways = it.injectMode === 'always';

      const row = document.createElement('div');
      row.className = 'ybmWbRow';

      row.innerHTML = `
      <div class="ybmWbTop">
        <div class="ybmWbTopLeft">
          <label class="wbToggle" style="margin-left:2px;">
            <input type="checkbox" ${it.enabled ? 'checked' : ''}>
            <span class="wbToggleTrack"></span>
          </label>

          <div class="ybmWbTitlePill" title="${escapeHtml(it.title || '')}">
            <input class="ybmWbTitleInput" value="${escapeHtml(it.title || '')}" placeholder="名称">
          </div>
        </div>

        <div class="ybmLampGroup">
          <button type="button"
                  class="ybmLamp ybmLampGreen ${isAlways ? 'ybmLampOn' : ''}"
                  data-act="mode-always"
                  aria-pressed="${isAlways ? 'true' : 'false'}">
            <span class="ybmLampDot"></span><span class="ybmLampLabel">总是注入</span>
          </button>

          <button type="button"
                  class="ybmLamp ybmLampBlue ${!isAlways ? 'ybmLampOn' : ''}"
                  data-act="mode-keyword"
                  aria-pressed="${!isAlways ? 'true' : 'false'}">
            <span class="ybmLampDot"></span><span class="ybmLampLabel">随提示词</span>
          </button>
        </div>
      </div>

      <div class="ybmWbMeta">
        <div class="ybmWbMiniInfo">${(it.content || '').length} 字</div>

        <div class="ybmWbKwWrap ${isAlways ? 'ybmHidden' : ''}">
          <input class="ybmWbKeyword" value="${escapeHtml(it.keyword || '')}" placeholder="关键词（例：短信/某人名/状态栏）">
        </div>

        <div class="ybmWbBtns">
          <button class="ybmWbBtnMini" data-act="up" type="button">↑</button>
          <button class="ybmWbBtnMini" data-act="down" type="button">↓</button>
          <button class="ybmWbBtnMini" data-act="toggle" type="button">编辑</button>
          <button class="ybmWbBtnMini ybmWbBtnDanger" data-act="del" type="button">删除</button>
        </div>
      </div>

      <div class="ybmWbEditor ybmHidden">
        <textarea class="ybmWbTextarea" placeholder="内容...">${escapeHtml(it.content || '')}</textarea>
        <div class="ybmWbBtns" style="margin-top:10px;">
          <button class="ybmWbBtnMini" data-act="save" type="button">保存</button>
          <button class="ybmWbBtnMini" data-act="close" type="button">收起</button>
        </div>
      </div>
    `;

      // 绑定
      const chk = row.querySelector('input[type="checkbox"]');
      const titleInput = row.querySelector('.ybmWbTitleInput');
      const kwInput = row.querySelector('.ybmWbKeyword');
      const editor = row.querySelector('.ybmWbEditor');
      const ta = row.querySelector('textarea');

      chk.onchange = () => {
        it.enabled = chk.checked;
        savePromptCfg(cfg);
      };

      titleInput.onchange = () => {
        it.title = titleInput.value || '';
        savePromptCfg(cfg);
      };

      if (kwInput) {
        kwInput.onchange = () => {
          it.keyword = kwInput.value || '';
          savePromptCfg(cfg);
        };
      }

      row.querySelector('[data-act="mode-always"]').onclick = () => {
        it.injectMode = 'always';
        savePromptCfg(cfg);
        renderWorldbookList(root, cfg, scope);
      };

      row.querySelector('[data-act="mode-keyword"]').onclick = () => {
        it.injectMode = 'keyword';
        savePromptCfg(cfg);
        renderWorldbookList(root, cfg, scope);
      };

      const toggleEditor = (open) => {
        const hidden = editor.classList.contains('ybmHidden');
        const shouldOpen = (open === undefined) ? hidden : open;
        editor.classList.toggle('ybmHidden', !shouldOpen);
      };

      row.querySelector('[data-act="toggle"]').onclick = () => toggleEditor();
      row.querySelector('[data-act="close"]').onclick = () => toggleEditor(false);

      row.querySelector('[data-act="save"]').onclick = () => {
        it.content = ta.value || '';
        savePromptCfg(cfg);
        renderWorldbookList(root, cfg, scope);
      };

      row.querySelector('[data-act="up"]').onclick = () => {
        if (idx <= 0) return;
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        savePromptCfg(cfg);
        renderWorldbookList(root, cfg, scope);
      };

      row.querySelector('[data-act="down"]').onclick = () => {
        if (idx >= arr.length - 1) return;
        [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
        savePromptCfg(cfg);
        renderWorldbookList(root, cfg, scope);
      };

      row.querySelector('[data-act="del"]').onclick = () => {
        arr.splice(idx, 1);
        savePromptCfg(cfg);
        renderWorldbookList(root, cfg, scope);
      };

      listEl.appendChild(row);
    });
  }




  function bindWorldbookPanel(root) {
    let cfg = ensurePromptCfg();
    const cid = cfg.activeContactId;

    // ① 删除重复的“导入/导出 textarea 区域”（你红框叉掉的那块）
    //    不改 HTML，运行时移除
    const wbIo = root.querySelector('#wb-io');
    if (wbIo) {
      const wrapper = wbIo.closest('.wbIO') || wbIo.parentElement;
      wrapper?.remove();
    }
    // 如果还有旧的导出/导入按钮也一起清掉
    root.querySelector('#wb-export')?.remove();
    root.querySelector('#wb-import')?.remove();

    // ② 当前联系人显示
    // ② 联系人切换：下拉框 + “显示：xxx”
    const sub = root.querySelector('.wbSectionSubContact');
    const picker = root.querySelector('#wb-contact-picker');

    const syncContactUI = () => {
      if (sub) sub.textContent = `（显示：${getActiveContactName(cfg)}）`;
      if (picker) picker.value = cfg.activeContactId;
    };

    if (picker) {
      // 填充联系人选项
      picker.innerHTML = (cfg.contacts || [])
        .map(c => `<option value="${c.id}">${c.name || c.id}</option>`)
        .join('');

      picker.onchange = () => {
        cfg.activeContactId = picker.value;
        savePromptCfg(cfg);
        syncContactUI();
        renderWorldbookList(root, cfg, 'contact'); // 只重渲染联系人区
      };
    }

    syncContactUI();


    // ③ 列表滚动（防挤出去）
    const gList = root.querySelector('#wb-global-list');
    const cList = root.querySelector('#wb-contact-list');
    [gList, cList].forEach(el => {
      if (!el) return;
      el.style.maxHeight = '52vh';
      el.style.overflowY = 'auto';
      el.style.paddingRight = '6px';
      el.style.boxSizing = 'border-box';
    });

    // ④ 首次渲染
    renderWorldbookList(root, cfg, 'global');
    renderWorldbookList(root, cfg, 'contact');

    // ⑤ 新增按钮（多 selector 兜底：避免你模板里 id 改过导致点了没反应）
    const btnAddGlobal =
      root.querySelector('#wb-add-global') ||
      root.querySelector('[data-act="wb-add-global"]') ||
      root.querySelector('[data-key="wb-add-global"]');

    const btnAddContact =
      root.querySelector('#wb-add-contact') ||
      root.querySelector('[data-act="wb-add-contact"]') ||
      root.querySelector('[data-key="wb-add-contact"]');

    btnAddGlobal?.addEventListener('click', () => {
      cfg.worldbook.global.push(makeWbItem());
      savePromptCfg(cfg);
      renderWorldbookList(root, cfg, 'global');
    });

    btnAddContact?.addEventListener('click', () => {
      const cidNow = cfg.activeContactId;          // ✅ 用当前选择的联系人
      if (!Array.isArray(cfg.worldbook.contact[cidNow])) cfg.worldbook.contact[cidNow] = [];
      cfg.worldbook.contact[cidNow].push(makeWbItem());
      savePromptCfg(cfg);
      renderWorldbookList(root, cfg, 'contact');
    });

    // ⑥ 顶部：载入默认 / 导入文件 / 导出下载（修复：render 参数正确 + 真实报错）
    root.querySelector('#wb-load-default')?.addEventListener('click', async () => {
      try {
        const res = await fetch('./default_worldbook.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('无法读取 default_worldbook.json');
        const def = await res.json();
        if (!def.worldbook) throw new Error('默认世界书格式错误（缺少 worldbook）');

        const cfg2 = ensurePromptCfg();
        cfg2.worldbook = def.worldbook;
        // 补齐 contact 数组
        if (!cfg2.worldbook.contact || typeof cfg2.worldbook.contact !== 'object') cfg2.worldbook.contact = {};
        cfg2.contacts.forEach(c => {
          if (!Array.isArray(cfg2.worldbook.contact[c.id])) cfg2.worldbook.contact[c.id] = [];
        });

        savePromptCfg(cfg2);
        cfg = cfg2;

        if (sub) sub.textContent = `（当前：${getActiveContactName(cfg2)}）`;
        renderWorldbookList(root, cfg2, 'global');
        renderWorldbookList(root, cfg2, 'contact');
        alert('已载入默认世界书');
      } catch (e) {
        console.error(e);
        alert('载入失败：' + (e?.message || e));
      }
    });

    const wbFile = root.querySelector('#wb-file');
    root.querySelector('#wb-import-file')?.addEventListener('click', () => wbFile?.click());

    wbFile?.addEventListener('change', async () => {
      const f = wbFile.files && wbFile.files[0];
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        if (!obj.worldbook) throw new Error('缺少 worldbook 字段');

        const cfg2 = ensurePromptCfg();
        cfg2.worldbook = obj.worldbook;
        if (Array.isArray(obj.contacts)) cfg2.contacts = obj.contacts;
        if (typeof obj.activeContactId === 'string') cfg2.activeContactId = obj.activeContactId;

        // 补齐 contact 数组
        if (!cfg2.worldbook.contact || typeof cfg2.worldbook.contact !== 'object') cfg2.worldbook.contact = {};
        cfg2.contacts.forEach(c => {
          if (!Array.isArray(cfg2.worldbook.contact[c.id])) cfg2.worldbook.contact[c.id] = [];
        });

        savePromptCfg(cfg2);

        if (sub) sub.textContent = `（当前：${getActiveContactName(cfg2)}）`;
        renderWorldbookList(root, cfg2, 'global');
        renderWorldbookList(root, cfg2, 'contact');
        alert('世界书导入成功');
      } catch (e) {
        console.error(e);
        alert('导入失败：' + (e?.message || e));
      } finally {
        wbFile.value = '';
      }
    });

    root.querySelector('#wb-export-file')?.addEventListener('click', () => {
      const cfgNow = ensurePromptCfg();
      const out = {
        version: 1,
        activeContactId: cfgNow.activeContactId,
        contacts: cfgNow.contacts,
        worldbook: cfgNow.worldbook
      };
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `worldbook_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    });
  }

  function renderPresetList(root, cfg) {
    // 注入一次性样式（如果世界书已经注入过同名 style，这里不会重复）
    if (!document.getElementById('ybm-wb-style')) {
      const st = document.createElement('style');
      st.id = 'ybm-wb-style';
      st.textContent = `
      .ybmWbList { max-height: 56vh; overflow:auto; padding-right:6px; box-sizing:border-box; }
      .ybmWbRow {
        display:block;
        border:2px solid rgba(0,0,0,18);
        border-radius:18px;
        background: rgba(255,255,255,35);
        padding:12px 12px 10px;
        margin: 10px 0;
        box-shadow: 0 8px 18px rgba(0,0,0,06);
      }
      .ybmWbTop { display:flex; align-items:center; gap:10px; }
      .ybmWbTopLeft { display:flex; align-items:center; gap:10px; min-width:0; flex: 1; }

      /* 标题胶囊：手机端不再被挤成一个字 */
      .ybmWbTitlePill{
        display:flex; align-items:center;
        padding: 8px 12px;
        border-radius: 999px;
        border: 2px solid rgba(0,0,0,2);
        background: rgba(255,255,255,55);
        font-weight: 700;
        max-width: 100%;
        min-width: 0;
        flex: 1;
      }
      .ybmWbTitleInput{
        border:none; outline:none; background:transparent;
        font: inherit; font-weight:700;
        width:100%;
        min-width:0;
      }

      .ybmWbMeta{
        margin-top: 8px;
        display:flex; align-items:center; justify-content:space-between;
        gap: 10px; flex-wrap:wrap;
      }
      .ybmWbMiniInfo{ font-size:12px; opacity:.75; padding-left:2px; }
      .ybmWbBtns{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
      .ybmWbBtnMini{
        border-radius: 999px;
        padding: 6px 10px;
        border: 2px solid rgba(0,0,0,22);
        background: rgba(255,255,255,45);
        font-weight: 700;
      }
      .ybmWbBtnDanger{
        background: rgba(255,182,193,35);
        border-color: rgba(120,0,0,25);
      }
      .ybmWbEditor{ margin-top:10px; }
      .ybmWbTextarea{
        width: 100%;
        min-height: 92px;
        border-radius: 14px;
        padding: 10px 12px;
        border: 2px solid rgba(0,0,0,18);
        background: rgba(255,255,255,55);
        outline:none;
        resize: vertical;
      }
      .ybmHidden{ display:none !important; }

      @media (max-width: 520px) {
        .ybmWbTop { flex-direction: column; align-items: stretch; }
        .ybmWbBtns { justify-content:flex-start; }
        .ybmWbTitlePill { width: 100%; }
      }
    `;
      document.head.appendChild(st);
    }

    const listEl =
      root.querySelector('#preset-global-list') ||
      root.querySelector('#presetList');

    if (!listEl) return;

    listEl.classList.add('ybmWbList');

    const arr = cfg.presets?.global || [];
    listEl.innerHTML = '';

    if (!arr.length) {
      const empty = document.createElement('div');
      empty.className = 'wbEmpty';
      empty.textContent = '暂无预设，点“＋新增”创建。';
      listEl.appendChild(empty);
      return;
    }

    arr.forEach((it, idx) => {
      if (typeof it.enabled !== 'boolean') it.enabled = true;
      if (typeof it.title !== 'string') it.title = it.title ? String(it.title) : '新预设';
      if (typeof it.content !== 'string') it.content = it.content ? String(it.content) : '';

      const row = document.createElement('div');
      row.className = 'ybmWbRow';

      // ✅ 预设：只有一个开关（开=注入，关=不注入），不提供“总是/随提示词”
      row.innerHTML = `
      <div class="ybmWbTop">
        <div class="ybmWbTopLeft">
          <label class="wbToggle" style="margin-left:2px;">
            <input type="checkbox" ${it.enabled ? 'checked' : ''}>
            <span class="wbToggleTrack"></span>
          </label>

          <div class="ybmWbTitlePill" title="${escapeHtml(it.title || '')}">
            <input class="ybmWbTitleInput" value="${escapeHtml(it.title || '')}" placeholder="名称">
          </div>
        </div>
      </div>

      <div class="ybmWbMeta">
        <div class="ybmWbMiniInfo">${(it.content || '').length} 字</div>

        <div class="ybmWbBtns">
          <button class="ybmWbBtnMini" data-act="up" type="button">↑</button>
          <button class="ybmWbBtnMini" data-act="down" type="button">↓</button>
          <button class="ybmWbBtnMini" data-act="toggle" type="button">编辑</button>
          <button class="ybmWbBtnMini ybmWbBtnDanger" data-act="del" type="button">删除</button>
        </div>
      </div>

      <div class="ybmWbEditor ybmHidden">
        <textarea class="ybmWbTextarea" placeholder="内容...">${escapeHtml(it.content || '')}</textarea>
        <div class="ybmWbBtns" style="margin-top:10px;">
          <button class="ybmWbBtnMini" data-act="save" type="button">保存</button>
          <button class="ybmWbBtnMini" data-act="close" type="button">收起</button>
        </div>
      </div>
    `;

      const chk = row.querySelector('input[type="checkbox"]');
      const titleInput = row.querySelector('.ybmWbTitleInput');
      const editor = row.querySelector('.ybmWbEditor');
      const ta = row.querySelector('textarea');

      chk.onchange = () => {
        it.enabled = chk.checked;
        savePromptCfg(cfg);
      };

      titleInput.onchange = () => {
        it.title = titleInput.value || '';
        savePromptCfg(cfg);
      };

      const toggleEditor = (open) => {
        const hidden = editor.classList.contains('ybmHidden');
        const shouldOpen = (open === undefined) ? hidden : open;
        editor.classList.toggle('ybmHidden', !shouldOpen);
      };

      row.querySelector('[data-act="toggle"]').onclick = () => toggleEditor();
      row.querySelector('[data-act="close"]').onclick = () => toggleEditor(false);

      row.querySelector('[data-act="save"]').onclick = () => {
        it.content = ta.value || '';
        savePromptCfg(cfg);
        renderPresetList(root, cfg);
      };

      row.querySelector('[data-act="up"]').onclick = () => {
        if (idx <= 0) return;
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        savePromptCfg(cfg);
        renderPresetList(root, cfg);
      };

      row.querySelector('[data-act="down"]').onclick = () => {
        if (idx >= arr.length - 1) return;
        [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
        savePromptCfg(cfg);
        renderPresetList(root, cfg);
      };

      row.querySelector('[data-act="del"]').onclick = () => {
        arr.splice(idx, 1);
        savePromptCfg(cfg);
        renderPresetList(root, cfg);
      };

      listEl.appendChild(row);
    });
  }



  function bindPresetsPanel(root) {
    let cfg = ensurePromptCfg();


    // ① 删除重复的“导入/导出 textarea 区域”（你红框叉掉的那块）
    const io = root.querySelector('#preset-io');
    if (io) {
      const wrapper = io.closest('.wbIO') || io.parentElement;
      wrapper?.remove();
    }
    root.querySelector('#preset-export')?.remove();
    root.querySelector('#preset-import')?.remove();

    // ② 渲染
    renderPresetList(root, cfg);

    // ③ “＋新增”按钮：多 selector 兜底（你说点了没反应，这里会强行匹配）
    const addBtn =
      root.querySelector('#preset-add-global') ||
      root.querySelector('#preset-add') ||
      root.querySelector('[data-act="preset-add-global"]') ||
      root.querySelector('[data-key="preset-add-global"]');

    addBtn?.addEventListener('click', () => {
      const item = makePresetItem();
      // 新字段默认值（兼容你后续注入逻辑）
      item.injectMode = item.injectMode || 'always';
      item.keyword = item.keyword || '';
      cfg.presets.global.push(item);

      savePromptCfg(cfg);
      renderPresetList(root, cfg);
    });

    // ④ 顶部：载入默认 / 导入文件 / 导出下载（修复：render 参数正确 + 真实报错）
    root.querySelector('#preset-load-default')?.addEventListener('click', async () => {
      try {
        const res = await fetch('./default_presets.json', { cache: 'no-store' });
        if (!res.ok) throw new Error('无法读取 default_presets.json');
        const def = await res.json();
        if (!def.presets) throw new Error('默认预设格式错误（缺少 presets）');

        const cfg2 = ensurePromptCfg();
        cfg2.presets = def.presets;
        if (!Array.isArray(cfg2.presets.global)) cfg2.presets.global = [];

        // 兼容字段补齐
        cfg2.presets.global.forEach(p => {
          if (!p.injectMode) p.injectMode = 'always';
          if (p.keyword == null) p.keyword = '';
          if (typeof p.enabled !== 'boolean') p.enabled = true;
          if (typeof p.title !== 'string') p.title = p.title ? String(p.title) : '新预设';
          if (typeof p.content !== 'string') p.content = p.content ? String(p.content) : '';
        });

        savePromptCfg(cfg2);
        renderPresetList(root, cfg2);
        alert('已载入默认预设');
      } catch (e) {
        console.error(e);
        alert('载入失败：' + (e?.message || e));
      }
    });

    const pFile = root.querySelector('#preset-file');
    root.querySelector('#preset-import-file')?.addEventListener('click', () => pFile?.click());

    pFile?.addEventListener('change', async () => {
      const f = pFile.files && pFile.files[0];
      if (!f) return;

      try {
        const obj = JSON.parse(await f.text());
        if (!obj.presets) throw new Error('缺少 presets 字段');

        const cfg2 = ensurePromptCfg();
        cfg2.presets = obj.presets;
        if (!Array.isArray(cfg2.presets.global)) cfg2.presets.global = [];

        cfg2.presets.global.forEach(p => {
          if (!p.injectMode) p.injectMode = 'always';
          if (p.keyword == null) p.keyword = '';
          if (typeof p.enabled !== 'boolean') p.enabled = true;
        });

        savePromptCfg(cfg2);
        renderPresetList(root, cfg2);
        alert('预设导入成功');
      } catch (e) {
        console.error(e);
        alert('导入失败：' + (e?.message || e));
      } finally {
        pFile.value = '';
      }
    });

    root.querySelector('#preset-export-file')?.addEventListener('click', () => {
      const cfgNow = ensurePromptCfg();
      const out = { version: 1, presets: cfgNow.presets };
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `presets_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
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
    skin: document.getElementById('startTplSkin'),
    help: document.getElementById('startTplHelp'),
    log: document.getElementById('startTplLog'),
    worldbook: document.getElementById('startTplWorldbook'),
    presets: document.getElementById('startTplPresets')
  };


  const startTitleMap = {
    api: 'API设置',
    skin: '皮肤',
    help: '操作说明',
    log: '更新日志',
    worldbook: '世界书',
    presets: '预设'
  };


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
    if (key === 'worldbook') bindWorldbookPanel(startOverlayBody);
    if (key === 'presets') bindPresetsPanel(startOverlayBody);


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
    if (key === 'worldbook') bindWorldbookPanel(body);
    if (key === 'presets') bindPresetsPanel(body);



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
  document.getElementById('btnWorldbook')?.addEventListener('click', () => openStartPanel('worldbook'));
  document.getElementById('btnPresetList')?.addEventListener('click', () => openStartPanel('presets'));
  // ===== Start center buttons (real panels) =====
  const PERSONA_LS_KEY = 'YBM_PERSONA_V1';
  const REGEX_LS_KEY = 'YBM_REGEX_CFG_V1';
  const ENGINE_LS_KEY = 'YBM_ENGINE_V1';
  const USER_AVA_LS_KEY = 'YBM_AVATAR_V1_me';


  function downloadJsonFile(filename, obj) {
    try {
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 800);
    } catch (e) {
      console.error(e);
      alert('导出失败：' + (e?.message || e));
    }
  }

  function pickJsonFile(onLoad) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        onLoad?.(data);
      } catch (e) {
        console.error(e);
        alert('导入失败：文件不是合法 JSON。');
      }
    };

    input.click();
  }

  /** 用 Start 页现成的 side/overlay 机制，打开一个“自定义内容面板” */
  function openStartCustomPanel(title, buildBodyFn) {
    // 只在 start 页生效
    if (!viewStart?.classList.contains('on')) return;

    const bodyNode = buildBodyFn?.();
    if (!bodyNode) return;

    if (isMobileStart()) {
      // mobile overlay
      if (!startOverlay || !startOverlayBody || !startOverlayTitle) return;
      startOverlayTitle.textContent = title || 'PANEL';
      startOverlayBody.innerHTML = '';
      startOverlayBody.appendChild(bodyNode);
      startOverlay.dataset.open = 'true';
      startOverlay.setAttribute('aria-hidden', 'false');
    } else {
      // desktop side
      if (!startSide) return;
      const panel = document.createElement('div');
      panel.className = 'startPanel';

      const chrome = document.createElement('div');
      chrome.className = 'startChrome';
      chrome.innerHTML = `
      <div class="startLights" aria-hidden="true">
        <span class="startLight"></span><span class="startLight y"></span><span class="startLight g"></span>
      </div>
      <div class="startChromeTitle">${escapeHtml(title || 'PANEL')}</div>
      <button class="startOverlayCloseBtn" type="button" data-start-close="1">关闭</button>
    `;

      const body = document.createElement('div');
      body.className = 'startPanelBody';
      body.appendChild(bodyNode);

      panel.appendChild(chrome);
      panel.appendChild(body);
      startSide.innerHTML = '';
      startSide.appendChild(panel);
      startSide.dataset.show = 'true';
    }
  }

  /** 人设面板：用户填“名字 + 基础信息”，保存到 localStorage，并会随提示词发出（后面我会在 phoneEngine.js 接入） */
  function buildPersonaPanel() {
    const wrap = document.createElement('div');
    wrap.className = 'startList';

    const cur = (() => {
      try { return JSON.parse(localStorage.getItem(PERSONA_LS_KEY) || 'null') || {}; } catch { return {}; }
    })();

    const enabled = !!cur.enabled;
    const name = cur.name || '';
    const bio = cur.bio || '';

    wrap.innerHTML = `
    <div class="startItem" style="opacity:.9">
      <b>说明</b><br/>
      这里是“你的自定义人设”。保存后会作为系统提示的一部分发给模型。
    </div>

    <div class="startItem">
      <div style="font-weight:800; margin-bottom:6px;">名字</div>
      <input id="personaName" placeholder="例如：薄荷冰淇淋" value="${escapeHtml(name)}"
             style="width:100%; padding:10px 12px; border-radius:14px; border:2px solid rgba(0,0,0,.18); background:rgba(255,255,255,.55); outline:none;">
    </div>

    <div class="startItem">
      <div style="font-weight:800; margin-bottom:6px;">基础信息</div>
      <textarea id="personaBio" placeholder="例如：年龄/身份/口吻偏好/禁忌点…（简短清晰）"
                style="width:100%; min-height:120px; padding:10px 12px; border-radius:14px; border:2px solid rgba(0,0,0,.18); background:rgba(255,255,255,.55); outline:none; resize:vertical;">${escapeHtml(bio)}</textarea>
    </div>

    <div class="wbRowBtns">
      <button class="btn primary" id="personaSave" type="button">保存</button>
      <button class="btn secondary" id="personaClear" type="button">清空</button>
      <button class="btn" id="personaExport" type="button">导出</button>
      <button class="btn" id="personaImport" type="button">导入</button>
    </div>
  `;

    wrap.querySelector('#personaSave')?.addEventListener('click', () => {
      const data = {
        enabled: true, // ✅ 默认永远注入，不提供开关
        name: (wrap.querySelector('#personaName')?.value || '').trim(),
        bio: (wrap.querySelector('#personaBio')?.value || '').trim(),
        updatedAt: Date.now()
      };

      localStorage.setItem(PERSONA_LS_KEY, JSON.stringify(data));
      alert('已保存。');
    });

    wrap.querySelector('#personaClear')?.addEventListener('click', () => {
      if (!confirm('确定清空人设吗？')) return;
      localStorage.removeItem(PERSONA_LS_KEY);
      alert('已清空。');
    });

    wrap.querySelector('#personaExport')?.addEventListener('click', () => {
      const raw = localStorage.getItem(PERSONA_LS_KEY);
      const obj = raw ? JSON.parse(raw) : { enabled: false, name: '', bio: '' };
      downloadJsonFile('ybm_persona.json', obj);
    });

    wrap.querySelector('#personaImport')?.addEventListener('click', () => {
      pickJsonFile((data) => {
        localStorage.setItem(PERSONA_LS_KEY, JSON.stringify(data || {}));
        alert('已导入。建议刷新页面确保生效。');
      });
    });

    return wrap;
  }

  /** 聊天记录：导出/导入整个引擎状态（最稳，不拆字段，防丢） */
  function buildChatlogPanel() {
    const wrap = document.createElement('div');
    wrap.className = 'startList';

    wrap.innerHTML = `
    <div class="startItem" style="opacity:.9">
      <b>说明</b><br/>
      这里导入导出的是“聊天引擎的完整存档”（包含联系人与消息）。用来防丢最稳。
    </div>

    <div class="wbRowBtns">
      <button class="btn primary" id="chatlogExport" type="button">导出下载</button>
      <button class="btn" id="chatlogImport" type="button">导入覆盖</button>
    </div>

    <div class="startItem" style="opacity:.85">
      <b>注意：</b>导入会覆盖本地存档。导入前建议先导出备份。
    </div>
  `;

    wrap.querySelector('#chatlogExport')?.addEventListener('click', () => {
      const raw = localStorage.getItem(ENGINE_LS_KEY);
      if (!raw) {
        alert('本地还没有聊天记录。');
        return;
      }
      const obj = JSON.parse(raw);
      downloadJsonFile('ybm_chatlog_backup.json', obj);
    });

    wrap.querySelector('#chatlogImport')?.addEventListener('click', () => {
      if (!confirm('导入会覆盖本地聊天存档，确定继续？')) return;
      pickJsonFile((data) => {
        localStorage.setItem(ENGINE_LS_KEY, JSON.stringify(data || {}));
        alert('已导入。即将刷新页面。');
        location.reload();
      });
    });

    return wrap;
  }

  /** 正则渲染规则：用于“前端显示层”改写文本（不影响发给模型的内容） */
  function buildRegexPanel() {
    const wrap = document.createElement('div');
    wrap.className = 'startList';

    const cfg = (() => {
      try { return JSON.parse(localStorage.getItem(REGEX_LS_KEY) || 'null') || {}; } catch { return {}; }
    })();

    if (!Array.isArray(cfg.rules)) cfg.rules = [];
    if (typeof cfg.enabled !== 'boolean') cfg.enabled = true;

    function save() {
      localStorage.setItem(REGEX_LS_KEY, JSON.stringify(cfg));
    }

    function renderList() {
      list.innerHTML = '';
      cfg.rules.forEach((r, idx) => {
        if (typeof r.enabled !== 'boolean') r.enabled = true;
        if (!r.name) r.name = '规则';
        if (r.pattern == null) r.pattern = '';
        if (r.flags == null) r.flags = 'g';
        if (r.replace == null) r.replace = '';

        const row = document.createElement('div');
        row.className = 'wbPad';
        row.style.borderRadius = '18px';
        row.style.border = '2px solid rgba(0,0,0,.16)';
        row.style.background = 'rgba(255,255,255,.30)';
        row.style.padding = '10px 12px';
        row.style.margin = '10px 0';

        row.innerHTML = `
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <label class="wbToggle">
            <input type="checkbox" ${r.enabled ? 'checked' : ''}>
            <span class="wbToggleTrack"></span>
          </label>

          <input value="${escapeHtml(r.name)}" placeholder="规则名"
                 style="flex:1; min-width:140px; padding:8px 10px; border-radius:14px; border:2px solid rgba(0,0,0,.16); background:rgba(255,255,255,.55); outline:none; font-weight:800;">

          <div style="display:flex; gap:8px; margin-left:auto;">
            <button class="wbBtn" data-act="up" type="button">↑</button>
            <button class="wbBtn" data-act="down" type="button">↓</button>
            <button class="wbBtn wbBtnDanger" data-act="del" type="button">删除</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 90px; gap:10px; margin-top:10px;">
          <input value="${escapeHtml(r.pattern)}" placeholder="pattern（不要带 / /）"
                 style="padding:8px 10px; border-radius:14px; border:2px solid rgba(0,0,0,.16); background:rgba(255,255,255,.55); outline:none;">
          <input value="${escapeHtml(r.flags)}" placeholder="flags"
                 style="padding:8px 10px; border-radius:14px; border:2px solid rgba(0,0,0,.16); background:rgba(255,255,255,.55); outline:none;">
        </div>

        <div style="margin-top:10px;">
          <input value="${escapeHtml(r.replace)}" placeholder="replace（替换成什么）"
                 style="width:100%; padding:8px 10px; border-radius:14px; border:2px solid rgba(0,0,0,.16); background:rgba(255,255,255,.55); outline:none;">
        </div>

        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          <button class="wbBtn wbBtnPrimary" data-act="test" type="button">测试本条</button>
          <span style="opacity:.75; font-size:12px;">只影响前端显示，不影响发给模型</span>
        </div>

        <textarea class="wbTextarea" data-act="sample" placeholder="粘一段文本测试效果（不会保存）"
                  style="margin-top:10px; min-height:80px;"></textarea>
      `;

        const chk = row.querySelector('input[type="checkbox"]');
        const [nameI, patI, flagsI, repI] = row.querySelectorAll('input');

        chk.onchange = () => { r.enabled = chk.checked; save(); };
        nameI.onchange = () => { r.name = nameI.value.trim(); save(); };
        patI.onchange = () => { r.pattern = patI.value; save(); };
        flagsI.onchange = () => { r.flags = flagsI.value || 'g'; save(); };
        repI.onchange = () => { r.replace = repI.value; save(); };

        row.querySelector('[data-act="up"]').onclick = () => {
          if (idx <= 0) return;
          [cfg.rules[idx - 1], cfg.rules[idx]] = [cfg.rules[idx], cfg.rules[idx - 1]];
          save(); renderList();
        };
        row.querySelector('[data-act="down"]').onclick = () => {
          if (idx >= cfg.rules.length - 1) return;
          [cfg.rules[idx + 1], cfg.rules[idx]] = [cfg.rules[idx], cfg.rules[idx + 1]];
          save(); renderList();
        };
        row.querySelector('[data-act="del"]').onclick = () => {
          cfg.rules.splice(idx, 1);
          save(); renderList();
        };

        row.querySelector('[data-act="test"]').onclick = () => {
          const sample = row.querySelector('textarea[data-act="sample"]').value || '';
          let out = sample;
          try {
            const re = new RegExp(r.pattern || '', r.flags || 'g');
            out = sample.replace(re, r.replace ?? '');
          } catch (e) {
            alert('正则不合法：' + (e?.message || e));
            return;
          }
          row.querySelector('textarea[data-act="sample"]').value = out;
        };

        list.appendChild(row);
      });
    }

    wrap.innerHTML = `
    <div class="startItem" style="opacity:.9">
      <b>说明</b><br/>
      这里是“渲染正则”。用于把显示出来的文字做替换/标记（不影响发给模型）。
    </div>

    <div class="startItem">
      <label style="display:flex; align-items:center; gap:10px;">
        <input id="regexEnabled" type="checkbox" ${cfg.enabled ? 'checked' : ''} />
        <b>启用渲染正则</b>
      </label>
    </div>

    <div class="wbRowBtns">
      <button class="btn primary" id="regexAdd" type="button">＋ 新增规则</button>
      <button class="btn" id="regexExport" type="button">导出</button>
      <button class="btn" id="regexImport" type="button">导入</button>
    </div>

    <div id="regexList"></div>
  `;

    const list = wrap.querySelector('#regexList');

    wrap.querySelector('#regexEnabled')?.addEventListener('change', (e) => {
      cfg.enabled = !!e.target.checked;
      save();
    });

    wrap.querySelector('#regexAdd')?.addEventListener('click', () => {
      cfg.rules.push({ enabled: true, name: '规则', pattern: '', flags: 'g', replace: '' });
      save();
      renderList();
    });

    wrap.querySelector('#regexExport')?.addEventListener('click', () => {
      downloadJsonFile('ybm_render_regex.json', cfg);
    });

    wrap.querySelector('#regexImport')?.addEventListener('click', () => {
      pickJsonFile((data) => {
        localStorage.setItem(REGEX_LS_KEY, JSON.stringify(data || {}));
        alert('已导入。建议刷新页面确保生效。');
      });
    });

    renderList();
    return wrap;
  }

  // 绑定按钮：打开自定义面板
  document.getElementById('btnRole')?.addEventListener('click', () => {
    openStartCustomPanel('人设', buildPersonaPanel);
  });
  document.getElementById('btnChatlog')?.addEventListener('click', () => {
    openStartCustomPanel('聊天记录', buildChatlogPanel);
  });
  document.getElementById('btnPresetQuick')?.addEventListener('click', () => {
    openStartCustomPanel('正则', buildRegexPanel);
  });

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
