// memory/SummaryStore.js
// v2: store skip + summary per contact

(function () {
  const KEY_SKIP = '__YBM_MEMORY_SKIP__';
  const KEY_SUMMARY = '__YBM_MEMORY_SUMMARY__';
  const KEY_META = '__YBM_MEMORY_META__';

  function load(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch {
      return {};
    }
  }

  function save(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function makeKey(contactId) {
    return String(contactId || 'default');
  }

  window.__YBM_MEMORY_STORE__ = {
    // ===== skip =====
    hasSkipped(contactId, turnCount) {
      const db = load(KEY_SKIP);
      const k = makeKey(contactId);
      return db[k] === turnCount;
    },
    markSkipped(contactId, turnCount) {
      const db = load(KEY_SKIP);
      const k = makeKey(contactId);
      db[k] = turnCount;
      save(KEY_SKIP, db);
    },

    // ===== summary text =====
    getSummary(contactId) {
      const db = load(KEY_SUMMARY);
      const k = makeKey(contactId);
      return db[k] || '';
    },
setSummary(contactId, text) {
  const db = load(KEY_SUMMARY);
  const k = makeKey(contactId);
  const v = String(text || '');
  db[k] = v;
  save(KEY_SUMMARY, db);

  // ✅ 通知 UI（总结模块面板 / 其他地方）
  try {
    window.dispatchEvent(new CustomEvent('ybm:summary-updated', {
      detail: { contactId, text: v }
    }));
  } catch {}
},


    // ===== meta (last range) =====
    getLastRange(contactId) {
      const db = load(KEY_META);
      const k = makeKey(contactId);
      return db[k]?.lastRange || null;
    },
    setLastRange(contactId, range) {
      const db = load(KEY_META);
      const k = makeKey(contactId);
      db[k] = db[k] || {};
      db[k].lastRange = range || null;
      save(KEY_META, db);
    }
  };
})();
