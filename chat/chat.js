(function () {
  function qs(id) { return document.getElementById(id); }

  function ensureMounted() {
    const mount = document.getElementById('mountChat');
    if (!mount) return Promise.resolve(false);

    // already mounted
    if (mount.dataset.mounted === '1' && document.getElementById('viewChat')) {
      return Promise.resolve(true);
    }

    mount.dataset.mounted = '1';
    // ✅ 确保 phoneEngine.js 已加载
    function ensureEngineLoaded() {
      if (window.PhoneEngine) return Promise.resolve(true);
      return new Promise((resolve) => {
        const base = document.currentScript?.src || location.href;
        const s = document.createElement('script');
        s.src = new URL('../phone/phoneEngine.js', base).toString(); // chat/chat.js -> phone/phoneEngine.js
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
    }

    return ensureEngineLoaded().then(() => {
      return fetch('./chat/chat.html')
        .then(r => r.text())
        .then(html => {
          mount.innerHTML = html;
          init();
          return true;
        })
        .catch(err => {
          console.error('[chat] ensureMounted failed:', err);
          return false;
        });
    });
  }


  function autoGrow(el, maxH = 140) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
  }

  function pushMsg(role, text) {
    const box = qs('chatMessages');
    if (!box) return;

    const wrap = document.createElement('div');
    wrap.className = 'chatMsg' + (role === 'me' ? ' me' : '');

    const meta = document.createElement('div');
    meta.className = 'chatMeta';
    meta.textContent = role === 'me' ? 'YOU' : 'YBM';

    const body = document.createElement('div');
    body.textContent = text;

    wrap.appendChild(meta);
    wrap.appendChild(body);
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }

  // ====== Drawer（你之前的左右抽屉，保留） ======
  function openDrawer(side) {
    const left = qs('chatDrawerLeft');
    const right = qs('chatDrawerRight');
    const mask = qs('chatMask');

    if (side === 'left' && left) left.dataset.open = 'true';
    if (side === 'right' && right) right.dataset.open = 'true';

    if (mask) {
      mask.dataset.open = 'true';
      mask.setAttribute('aria-hidden', 'false');
    }
  }

  function closeDrawers() {
    const left = qs('chatDrawerLeft');
    const right = qs('chatDrawerRight');
    const mask = qs('chatMask');

    if (left) left.dataset.open = 'false';
    if (right) right.dataset.open = 'false';

    if (mask) {
      mask.dataset.open = 'false';
      mask.setAttribute('aria-hidden', 'true');
    }
  }

  function openPhone() {
    const p = qs('phoneOverlay');
    const m = qs('phoneMask');
    if (p) { p.dataset.open = 'true'; p.setAttribute('aria-hidden', 'false'); }
    if (m) { m.dataset.open = 'true'; m.setAttribute('aria-hidden', 'false'); }
  }


  function closePhone() {
    const p = qs('phoneOverlay');
    const m = qs('phoneMask');
    if (p) { p.dataset.open = 'false'; p.setAttribute('aria-hidden', 'true'); }
    if (m) { m.dataset.open = 'false'; m.setAttribute('aria-hidden', 'true'); }
  }


  function init() {
    // ====== 聊天发送（占位） ======
    const input = qs('chatInput');
    const send = qs('chatSend');

    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('input', () => autoGrow(input, 140));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send?.click();
        }
      });
    }

    if (send && !send.dataset.bound) {
      send.dataset.bound = '1';
      send.addEventListener('click', () => {
        const t = (input?.value || '').trim();
        if (!t) return;
        pushMsg('me', t);
        input.value = '';
        autoGrow(input, 140);
        // 用引擎发（共享记忆：main+phone 都会进上下文）
        if (window.PhoneEngine) {
          // 先推一个“正在生成”的气泡（可选）
          pushMsg('ybm', '…');

          // 发送并在完成后把最后一条 assistant 改成真实内容（简单做法：再补一条）
          PhoneEngine.send({
            text: t,
            channel: 'main',
            stream: false,   // 先非流式，稳；下一步再开 stream
          }).then(msg => {
            if (msg?.content) pushMsg('ybm', msg.content);
          });
        }

      });
    }

    // seed once
    const box = qs('chatMessages');
    if (box && !box.dataset.seeded) {
      box.dataset.seeded = '1';
      pushMsg('ybm', '（聊天界面雏形）\n这里先把 UI 立住：消息区、输入区、左右抽屉。');
      pushMsg('ybm', '下一步接：API/流式、世界书/预设注入、撤回/偷看。');
    }
    // ====== 切换联系人（循环切换） ======
    qs('chatSwitchContact')?.addEventListener('click', () => {
      if (!window.PhoneEngine) return;

      const list = PhoneEngine.listContacts?.() || [];
      if (!list.length) return;

      const curId = PhoneEngine.getActiveContact?.();
      const idx = Math.max(0, list.findIndex(c => c.id === curId));
      const next = list[(idx + 1) % list.length];

      PhoneEngine.setActiveContact?.(next.id);

      // UI：先简单粗暴刷新（后面我们会做“从引擎重绘历史”）
      const box = qs('chatMessages');
      if (box) box.innerHTML = '';
      pushMsg('ybm', `已切换到：${next.name || next.id}`);

      // 标题显示当前联系人（可选）
      const title = document.querySelector('.chatTitle');
      if (title) title.textContent = `CHAT · ${next.name || next.id}`;
    });

    // ====== 绑定：小手机 & 设置 ======
    // 小手机按钮：只开 phoneOverlay
    qs('chatDeviceBtn')?.addEventListener('click', openPhone);
    qs('phoneClose')?.addEventListener('click', closePhone);
    qs('phoneMask')?.addEventListener('click', closePhone);

    // ====== 小手机发送（占位） ======
    const pInput = qs('phoneInput');
    const pSend = qs('phoneSend');

    function pushPhone(role, text) {
      const pBox = qs('phoneMsgs');
      if (!pBox) return;
      const msg = document.createElement('div');
      msg.className = 'phoneMsg' + (role === 'me' ? ' me' : '');

      const meta = document.createElement('div');
      meta.className = 'phoneMeta';
      meta.textContent = role === 'me' ? 'YOU' : 'YBM';

      const body = document.createElement('div');
      body.textContent = text;

      msg.appendChild(meta);
      msg.appendChild(body);
      pBox.appendChild(msg);
      pBox.scrollTop = pBox.scrollHeight;
    }

    if (pInput && !pInput.dataset.bound) {
      pInput.dataset.bound = '1';
      pInput.addEventListener('input', () => autoGrow(pInput, 110));
      pInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          pSend?.click();
        }
      });
    }

    if (pSend && !pSend.dataset.bound) {
      pSend.dataset.bound = '1';
      pSend.addEventListener('click', () => {
        const t = (pInput?.value || '').trim();
        if (!t) return;
        pushPhone('me', t);
        pInput.value = '';
        autoGrow(pInput, 110);
        if (window.PhoneEngine) {
          // 用引擎发（同样共享记忆）
          PhoneEngine.send({
            text: t,
            channel: 'phone',
            stream: false,
          }).then(msg => {
            // 这里不需要 pushPhone，你现在的 pushPhone 是 UI 追加
            // 最简单：仍然追加一条，内容来自 msg.content
            if (msg?.content) pushPhone('ybm', msg.content);
          });
        }

      });
    }

    const pBox = qs('phoneMsgs');
    if (pBox && !pBox.dataset.seeded) {
      pBox.dataset.seeded = '1';
      pushPhone('ybm', '（小手机）这里是“给角色发微信/短信”的窗口。');
      pushPhone('ybm', '中间大窗口继续负责“故事推进”。');
    }

    // ====== 关闭左右抽屉（你已有的） ======
    qs('chatMask')?.addEventListener('click', closeDrawers);
    document.addEventListener('click', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (el.dataset.chatClose === 'left' || el.dataset.chatClose === 'right') closeDrawers();

    });

    // 如果你还有 Left/Right drawer 的按钮（可选）
    qs('chatLeftBtn')?.addEventListener('click', () => openDrawer('left'));
    qs('chatRightBtn')?.addEventListener('click', () => openDrawer('right'));
  }

  window.ChatUI = { ensureMounted };
  ensureMounted();
})();
