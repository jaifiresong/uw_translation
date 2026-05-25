const DB_NAME = "TranslateExtensionDB";
const DB_VERSION = 1;
const STORE_WORDS = "word_cache";
const STORE_SENTENCES = "sentence_cache";
const STORE_META = "meta";

const SENTENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SENTENCE_MAX_COUNT = 500;

let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_WORDS)) {
        db.createObjectStore(STORE_WORDS, { keyPath: "word" });
      }
      if (!db.objectStoreNames.contains(STORE_SENTENCES)) {
        db.createObjectStore(STORE_SENTENCES, { keyPath: "text" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
  });
}

async function getDB() {
  if (!dbInstance) {
    dbInstance = await openDB();
  }
  return dbInstance;
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// === 单词缓存 ===

async function getCachedWord(word) {
  const db = await getDB();
  const tx = db.transaction(STORE_WORDS, "readonly");
  const store = tx.objectStore(STORE_WORDS);
  const record = await reqPromise(store.get(word.toLowerCase().trim()));
  return record || null;
}

async function setUserWordCache(word, data) {
  const db = await getDB();
  const tx = db.transaction(STORE_WORDS, "readwrite");
  const store = tx.objectStore(STORE_WORDS);
  const record = {
    word: word.toLowerCase().trim(),
    data: data,
    isPreset: false,
    cachedAt: Date.now(),
  };
  await reqPromise(store.put(record));
  await txPromise(tx);
}

// === 句子缓存 ===

async function getCachedSentence(text) {
  const db = await getDB();
  const tx = db.transaction(STORE_SENTENCES, "readonly");
  const store = tx.objectStore(STORE_SENTENCES);
  const record = await reqPromise(store.get(text.trim()));
  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    // 已过期，需要删除（开启新事务）
    const delTx = db.transaction(STORE_SENTENCES, "readwrite");
    const delStore = delTx.objectStore(STORE_SENTENCES);
    await reqPromise(delStore.delete(text.trim()));
    await txPromise(delTx);
    return null;
  }
  return record;
}

async function setSentenceCache(text, data) {
  const db = await getDB();
  const tx = db.transaction(STORE_SENTENCES, "readwrite");
  const store = tx.objectStore(STORE_SENTENCES);

  const now = Date.now();
  const record = {
    text: text.trim(),
    data: data,
    cachedAt: now,
    expiresAt: now + SENTENCE_TTL_MS,
  };
  await reqPromise(store.put(record));

  // 检查是否超限
  const count = await reqPromise(store.count());
  if (count > SENTENCE_MAX_COUNT) {
    // 获取所有条目，按 cachedAt 排序，删除最旧的
    const allRecords = [];
    const cursorReq = store.openCursor();
    await cursorPromise(cursorReq, (cursor) => {
      allRecords.push(cursor.value);
      cursor.continue();
    });

    allRecords.sort((a, b) => a.cachedAt - b.cachedAt);
    const toDelete = allRecords.slice(0, count - SENTENCE_MAX_COUNT);
    for (const item of toDelete) {
      await reqPromise(store.delete(item.text));
    }
  }

  await txPromise(tx);
}

// === 预设词库同步 ===

async function syncPresetWords(presetData) {
  const currentVersion = await getMeta("presetVersion");
  if (currentVersion === presetData.version) {
    return { updated: false, version: currentVersion };
  }

  const db = await getDB();
  const tx = db.transaction([STORE_WORDS, STORE_META], "readwrite");
  const wordStore = tx.objectStore(STORE_WORDS);
  const metaStore = tx.objectStore(STORE_META);

  // 删除旧预设
  const toDelete = [];
  const cursorReq = wordStore.openCursor();
  await cursorPromise(cursorReq, (cursor) => {
    if (cursor.value.isPreset) {
      toDelete.push(cursor.value.word);
    }
    cursor.continue();
  });

  for (const word of toDelete) {
    await reqPromise(wordStore.delete(word));
  }

  // 写入新预设（使用 data.word 作为缓存 key，与用户查询 key 一致）
  const words = presetData.words || {};
  const cachedAt = Date.now();
  for (const [, data] of Object.entries(words)) {
    const cacheKey = (data.word || "").toLowerCase().trim();
    if (!cacheKey) continue;
    const record = {
      word: cacheKey,
      data: data,
      isPreset: true,
      cachedAt: cachedAt,
    };
    await reqPromise(wordStore.put(record));
  }

  // 更新版本号
  await reqPromise(
    metaStore.put({ key: "presetVersion", version: presetData.version, syncedAt: cachedAt })
  );

  await txPromise(tx);

  return { updated: true, version: presetData.version, count: Object.keys(words).length };
}

async function getMeta(key) {
  const db = await getDB();
  const tx = db.transaction(STORE_META, "readonly");
  const store = tx.objectStore(STORE_META);
  const record = await reqPromise(store.get(key));
  return record ? record.version : null;
}

// === 导出 / 清空 / 统计 ===

async function exportAllCache() {
  const db = await getDB();

  // 导出单词
  const words = {};
  const wordTx = db.transaction(STORE_WORDS, "readonly");
  const wordStore = wordTx.objectStore(STORE_WORDS);
  await cursorPromise(wordStore.openCursor(), (cursor) => {
    words[cursor.value.word] = cursor.value.data;
    cursor.continue();
  });

  // 导出句子
  const sentences = {};
  const sentenceTx = db.transaction(STORE_SENTENCES, "readonly");
  const sentenceStore = sentenceTx.objectStore(STORE_SENTENCES);
  await cursorPromise(sentenceStore.openCursor(), (cursor) => {
    sentences[cursor.value.text] = cursor.value.data;
    cursor.continue();
  });

  const stats = await getCacheStats();

  return {
    exportedAt: new Date().toISOString(),
    source: "translate-extension",
    version: stats.presetVersion || "unknown",
    stats: {
      presetCount: stats.presetCount,
      userWordCount: stats.userWordCount,
      sentenceCount: stats.sentenceCount,
      totalCount: stats.totalCount,
    },
    words: words,
    sentences: sentences,
  };
}

async function clearUserCache() {
  const db = await getDB();
  const tx = db.transaction([STORE_WORDS, STORE_SENTENCES], "readwrite");
  const wordStore = tx.objectStore(STORE_WORDS);
  const sentenceStore = tx.objectStore(STORE_SENTENCES);

  // 删除用户单词缓存（isPreset = false）
  const userWords = [];
  await cursorPromise(wordStore.openCursor(), (cursor) => {
    if (!cursor.value.isPreset) {
      userWords.push(cursor.value.word);
    }
    cursor.continue();
  });

  for (const word of userWords) {
    await reqPromise(wordStore.delete(word));
  }

  // 清空所有句子缓存
  const sentenceKeys = [];
  await cursorPromise(sentenceStore.openCursor(), (cursor) => {
    sentenceKeys.push(cursor.value.text);
    cursor.continue();
  });

  for (const text of sentenceKeys) {
    await reqPromise(sentenceStore.delete(text));
  }

  await txPromise(tx);
}

async function getCacheStats() {
  const db = await getDB();

  let presetCount = 0;
  let userWordCount = 0;

  const wordTx = db.transaction(STORE_WORDS, "readonly");
  const wordStore = wordTx.objectStore(STORE_WORDS);
  await cursorPromise(wordStore.openCursor(), (cursor) => {
    if (cursor.value.isPreset) {
      presetCount++;
    } else {
      userWordCount++;
    }
    cursor.continue();
  });

  let sentenceCount = 0;
  const sentenceTx = db.transaction(STORE_SENTENCES, "readonly");
  const sentenceStore = sentenceTx.objectStore(STORE_SENTENCES);
  await cursorPromise(sentenceStore.openCursor(), (cursor) => {
    sentenceCount++;
    cursor.continue();
  });

  const presetVersion = await getMeta("presetVersion");

  return {
    presetCount,
    userWordCount,
    sentenceCount,
    totalCount: presetCount + userWordCount + sentenceCount,
    presetVersion: presetVersion || "未加载",
  };
}

// === 辅助函数 ===

function txPromise(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error("Transaction aborted"));
  });
}

function cursorPromise(req, onItem) {
  return new Promise((resolve, reject) => {
    req.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        onItem(cursor);
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// 暴露到全局
self.TranslateDB = {
  initDB: getDB, // initDB 就是 getDB（首次调用会初始化）
  getCachedWord,
  setUserWordCache,
  getCachedSentence,
  setSentenceCache,
  syncPresetWords,
  exportAllCache,
  clearUserCache,
  getCacheStats,
};
