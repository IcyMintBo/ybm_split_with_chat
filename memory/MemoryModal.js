(function () {
  function show({ summaryRangeText, onConfirm, onSkip }) {
    const mask = document.createElement('div');
    mask.style.cssText = `
      position:fixed;inset:0;
      background:rgba(0,0,0,.45);
      z-index:9999;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      position:fixed;left:50%;top:50%;
      transform:translate(-50%,-50%);
      width:320px;
      background:#111;color:#eee;
      border-radius:10px;
      padding:16px;
      z-index:10000;
    `;

    modal.innerHTML = `
      <h3 style="margin:0 0 8px;">生成长期摘要</h3>
      <p style="font-size:13px;opacity:.9;">
        是否为当前对话生成长期摘要？
      </p>
      <p style="font-size:12px;opacity:.7;">
        ${summaryRangeText || ''}
      </p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
        <button id="ybm-confirm-gen">生成摘要</button>
        <button id="ybm-confirm-skip">跳过</button>
      </div>
    `;

    document.body.appendChild(mask);
    document.body.appendChild(modal);

    function cleanup() {
      mask.remove();
      modal.remove();
    }

    modal.querySelector('#ybm-confirm-gen').onclick = () => {
      cleanup();
      onConfirm && onConfirm();
    };

    modal.querySelector('#ybm-confirm-skip').onclick = () => {
      cleanup();
      onSkip && onSkip();
    };
  }

  window.__YBM_MEMORY_CONFIRM_MODAL__ = { show };
})();


(function () {
  function createModal() {
    const mask = document.createElement('div');
    mask.id = 'ybm-memory-mask';

    const modal = document.createElement('div');
    modal.id = 'ybm-memory-modal';

    modal.innerHTML = `
      <h3>总结模块</h3>
      <p>这是当前对话的长期摘要，可由系统生成，也可手动修改。</p>

      <textarea
        id="ybm-memory-text"
        placeholder="这里是摘要内容…"
        style="width:100%;height:120px;resize:vertical;"
      ></textarea>

      <div class="btns" style="margin-top:12px;">
        <button id="ybm-memory-regenerate">重新生成</button>
        <button id="ybm-memory-confirm">保存并生效</button>
        <button id="ybm-memory-skip">跳过</button>
      </div>
    `;

    document.body.appendChild(mask);
    document.body.appendChild(modal);

    return { mask, modal };
  }

  let ui = null;

  function show({
    initialText = '',
    onSave,
    onSkip,
    onRegenerate
  }) {
    if (!ui) ui = createModal();

    const { mask, modal } = ui;
    const textarea = modal.querySelector('#ybm-memory-text');

    textarea.value = initialText || '';

    mask.style.display = 'block';
    modal.style.display = 'block';

    modal.querySelector('#ybm-memory-confirm').onclick = () => {
      const text = textarea.value;
      hide();
      onSave && onSave(text);
    };

    modal.querySelector('#ybm-memory-skip').onclick = () => {
      hide();
      onSkip && onSkip();
    };

    modal.querySelector('#ybm-memory-regenerate').onclick = () => {
      if (onRegenerate) {
        const next = onRegenerate(textarea.value);
        if (typeof next === 'string') {
          textarea.value = next;
        }
      }
    };
  }

  function hide() {
    if (!ui) return;
    ui.mask.style.display = 'none';
    ui.modal.style.display = 'none';
  }

  window.__YBM_MEMORY_MODAL__ = { show };
})();
