// memory/MemoryManager.js
// v2: trigger at 15/25/35...; summarize 1-10, 11-20...

(function () {
  const SUMMARY_BLOCK = 10;     // 每次总结 10 轮
  const PROMPT_OFFSET = 5;      // 15 提示总结 1-10；25 提示总结 11-20
  const DEFAULT_CHAR_THRESHOLD = 12000;

  function countMainMessages(messages) {
    return messages.filter(
      m => m.channel === 'main' && (m.role === 'user' || m.role === 'assistant')
    );
  }

  function calcChars(msgs) {
    return msgs.reduce((sum, m) => {
      if (!m.content) return sum;
      return sum + String(m.content).length;
    }, 0);
  }

  function calcSummaryRange(turnCount) {
    // turn=15 => end=10 => 1-10
    // turn=25 => end=20 => 11-20
    if (turnCount < SUMMARY_BLOCK + PROMPT_OFFSET) return null;
    const end = turnCount - PROMPT_OFFSET;
    if (end > 0 && end % SUMMARY_BLOCK === 0) {
      return { from: end - SUMMARY_BLOCK + 1, to: end };
    }
    return null;
  }

  const MemoryManager = {
    checkShouldPrompt({ allMessages, contactId }) {
      if (!Array.isArray(allMessages)) {
        return { shouldPrompt: false, reason: null };
      }

const mainMsgs = countMainMessages(allMessages);
// ✅ 用“用户发言数”当作轮数：更稳定，不会被多出来的assistant消息/开场白等影响
const turnCount = mainMsgs.filter(m => m.role === 'user').length;
const charCount = calcChars(mainMsgs);


      let shouldPrompt = false;
      let reason = null;

      // 轮次触发：15/25/35...
      const summaryRange = calcSummaryRange(turnCount);
      if (summaryRange) {
        shouldPrompt = true;
        reason = 'turn';
      }

      // 字数触发（保留你的“任意满足就提示”的扩展性）
      if (charCount >= DEFAULT_CHAR_THRESHOLD) {
        shouldPrompt = true;
        reason = reason ? `${reason}+chars` : 'chars';
      }

      return {
        shouldPrompt,
        reason,
        turnCount,
        charCount,
        contactId,
        summaryRange // ✅ 关键：phoneEngine 读 from/to 不会再炸
      };
    },

// ✅ v3：真实生成（通过 phoneEngine 提供的全局生成器）
async generateSummary({ contactId, range, allMessages }) {
  const store = window.__YBM_MEMORY_STORE__;
  const editModal = window.__YBM_MEMORY_MODAL__;
  const gen = window.__YBM_SUMMARY_GENERATOR__;

  const from = range?.from ?? '?';
  const to = range?.to ?? '?';

  // 没有生成器就兜底（防止你调试时炸）
  if (!gen) {
    const fallback = [
      `【长期摘要（未接入模型）】`,
      `总结范围：${from}-${to}`,
      `提示：未找到 window.__YBM_SUMMARY_GENERATOR__`
    ].join('\n');
    store?.setSummary(contactId, fallback);
    store?.setLastRange(contactId, range);
    editModal?.show({
      summaryRangeText: `已生成长期摘要（范围：${from}-${to}）`,
      initialText: fallback,
      onSave(text) { store?.setSummary(contactId, text); },
      onSkip() {},
      onRegenerate(prev) { return prev; }
    });
    return fallback;
  }

  try {
    const text = await gen({ contactId, range, allMessages });

    store?.setSummary(contactId, text);
    store?.setLastRange(contactId, range);

    // ✅ 弹出编辑器：允许你人工改、也允许重新生成
    editModal?.show({
      summaryRangeText: `已生成长期摘要（范围：${from}-${to}）`,
      initialText: text,
      onSave(t) {
        store?.setSummary(contactId, t);
        console.log('[Memory] summary saved');
      },
      onSkip() {
        console.log('[Memory] edit skipped');
      },
      onRegenerate: async (prev) => {
        try {
          const next = await gen({
            contactId,
            range,
            allMessages,
            extraInstruction: `请基于上一次摘要进行改写与修正，避免重复，结构更清晰。\n\n上一次摘要：\n${prev}`
          });
          store?.setSummary(contactId, next);
          return next;
        } catch (e) {
          console.warn('[Memory] regenerate failed', e);
          return prev;
        }
      }
    });

    console.log('[Memory] summary generated', { contactId, range });
    return text;
  } catch (e) {
    console.warn('[Memory] generateSummary failed', e);
    const errText = `【长期摘要生成失败】\n范围：${from}-${to}\n错误：${e?.message || e}`;
    store?.setSummary(contactId, errText);
    store?.setLastRange(contactId, range);
    return errText;
  }
}

  };

  window.__YBM_MEMORY__ = { MemoryManager };
})();
