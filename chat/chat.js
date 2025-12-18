(function(){
  // mount (once)
  function ensureMounted(){
    const mount = document.getElementById('mountChat');
    if (!mount || mount.dataset.mounted) return;
    mount.dataset.mounted = '1';

    fetch('./chat/chat.html')
      .then(r => r.text())
      .then(html => {
        mount.innerHTML = html;
        init();
      })
      .catch(() => {
        // fallback: do nothing
      });
  }

  function qs(id){ return document.getElementById(id); }

  function autoGrow(el){
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  function pushMsg(role, text){
    const box = qs('chatMessages');
    if(!box) return;
    const wrap = document.createElement('div');
    wrap.className = 'chatMsg' + (role==='me' ? ' me' : '');
    const meta = document.createElement('div');
    meta.className = 'chatMeta';
    meta.textContent = role==='me' ? 'YOU' : 'YBM';
    const body = document.createElement('div');
    body.textContent = text;
    wrap.appendChild(meta);
    wrap.appendChild(body);
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
  }

  function openDrawer(side){
    const left = qs('chatDrawerLeft');
    const right = qs('chatDrawerRight');
    const mask = qs('chatMask');
    if(side==='left' && left){ left.dataset.open='true'; }
    if(side==='right' && right){ right.dataset.open='true'; }
    if(mask){ mask.dataset.open='true'; mask.setAttribute('aria-hidden','false'); }
  }

  function closeDrawers(){
    const left = qs('chatDrawerLeft');
    const right = qs('chatDrawerRight');
    const mask = qs('chatMask');
    if(left) left.dataset.open='false';
    if(right) right.dataset.open='false';
    if(mask){ mask.dataset.open='false'; mask.setAttribute('aria-hidden','true'); }
  }

  function init(){
    // seed once
    const box = qs('chatMessages');
    if(box && !box.dataset.seeded){
      box.dataset.seeded='1';
      pushMsg('ybm','（聊天界面雏形）
这里先把UI立住：消息区、输入区、左右抽屉。');
      pushMsg('ybm','下一步接：API/流式、世界书/预设注入、撤回/偷看。');
    }

    const input = qs('chatInput');
    const send = qs('chatSend');
    input?.addEventListener('input', () => autoGrow(input));
    input?.addEventListener('keydown', (e) => {
      if(e.key==='Enter' && !e.shiftKey){
        e.preventDefault();
        send?.click();
      }
    });
    send?.addEventListener('click', () => {
      const t = (input?.value || '').trim();
      if(!t) return;
      pushMsg('me', t);
      input.value='';
      autoGrow(input);
      // placeholder bot echo
      setTimeout(()=>pushMsg('ybm','（占位）收到：'+t), 180);
    });

    qs('chatLeftBtn')?.addEventListener('click', ()=>openDrawer('left'));
    qs('chatRightBtn')?.addEventListener('click', ()=>openDrawer('right'));
    qs('chatMask')?.addEventListener('click', closeDrawers);

    document.addEventListener('click', (e)=>{
      const el = e.target;
      if(!(el instanceof HTMLElement)) return;
      if(el.dataset.chatClose==='left' || el.dataset.chatClose==='right'){
        closeDrawers();
      }
    });
  }

  window.ChatUI = { ensureMounted };

  // preload
  ensureMounted();
})();