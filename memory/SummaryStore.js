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
  const k = makeKey(contactId);
  const v = String(text || '');

  // ===== 1) summary text =====
  const db = load(KEY_SUMMARY);

  // ✅ 如果摘要被清空（等同删除），就把“总结进度”一起清零
  if (!v.trim()) {
    // 删除摘要
    delete db[k];
    save(KEY_SUMMARY, db);

    // 清空 lastRange（总结到哪一轮）
    const meta = load(KEY_META);
    if (meta[k]) {
      meta[k].lastRange = null;
      save(KEY_META, meta);
    }

    // 顺便清空 skip（防止“跳过”状态影响重新总结）
    const sk = load(KEY_SKIP);
    if (k in sk) {
      delete sk[k];
      save(KEY_SKIP, sk);
    }

    // 通知 UI
    try {
      window.dispatchEvent(new CustomEvent('ybm:summary-updated', {
        detail: { contactId, text: '' }
      }));
    } catch {}

    return;
  }

  // 正常写入摘要
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
