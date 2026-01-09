
(function () {
  function show({ summaryRangeText, onConfirm, onSkip }) {
    const mask = document.createElement('div');
    mask.id = 'ybm-confirm-mask';

    const modal = document.createElement('div');
    modal.id = 'ybm-confirm-modal';

    modal.innerHTML = `
      <div class="ybmConfirmTitle">生成长期摘要</div>
      <div class="ybmConfirmDesc">是否为当前对话生成长期摘要？</div>
      <div class="ybmConfirmSub">${summaryRangeText || ''}</div>

      <div class="ybmConfirmBtns">
        <button class="btn primary" id="ybm-confirm-gen" type="button">生成摘要</button>
        <button class="btn" id="ybm-confirm-skip" type="button">跳过</button>
      </div>
    `;

    document.body.appendChild(mask);
    document.body.appendChild(modal);

    function cleanup() {
      mask.remove();
      modal.remove();
    }

    mask.onclick = () => {
      cleanup();
      onSkip && onSkip();
    };

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
<div class="memHead">
  <div class="memTitle">总结模块</div>
</div>
<div class="memSub">
  <div>这是当前对话的长期摘要，可由系统生成，也可手动修改。</div>
</div>


<textarea
  id="ybm-memory-text"
  placeholder="这里是摘要内容…"
></textarea>

<div class="btns">
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
