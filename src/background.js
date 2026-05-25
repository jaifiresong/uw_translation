importScripts("db.js");

const DEFAULT_CONFIG = {
  apiProvider: "deepseek",
  apiKey: "",
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com",
  enabled: true
};

let cacheReady = false;
let cacheInitPromise = null;

async function initCache() {
  if (cacheInitPromise) return cacheInitPromise;
  cacheInitPromise = (async () => {
    try {
      await TranslateDB.initDB();
      const response = await fetch(chrome.runtime.getURL("preset-words.json"));
      const presetData = await response.json();
      if (presetData.words && Object.keys(presetData.words).length > 0) {
        const result = await TranslateDB.syncPresetWords(presetData);
        if (result.updated) {
          console.log(`[Translate] Preset words synced: ${result.count} words (v${result.version})`);
        }
      }
      cacheReady = true;
    } catch (err) {
      console.error("[Translate] Cache init failed:", err);
      cacheReady = false;
    }
  })();
  return cacheInitPromise;
}

async function getConfig() {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
  const config = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    config[key] = stored[key] !== undefined ? stored[key] : DEFAULT_CONFIG[key];
  }
  return config;
}

async function callLLM(config, messages) {
  let baseUrl = config.baseUrl;
  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const url = baseUrl + "/chat/completions";

  const body = {
    model: config.model,
    messages: messages,
    temperature: 0.3,
    stream: false
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("请求超时");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function buildWordPrompt(word) {
  const system = "你是一个专业英语词典。请用严格 JSON 格式返回单词解释，不要 markdown 代码块。";

  const jsonTemplate = {
    word: word,
    phonetic: { uk: "", us: "" },
    meanings: [
      {
        pos: "词性（如 n., v., adj. 等）",
        definitions: ["释义"],
        examples: [{ en: "英文例句", zh: "中文翻译" }]
      }
    ],
    synonyms: ["近义词"],
    antonyms: ["反义词"],
    collocations: ["常见搭配"],
    etymology: "词源简介"
  };

  const user = `请详细解释单词 "${word}"，返回如下 JSON 格式（不要包含任何 markdown 标记）：\n${JSON.stringify(jsonTemplate, null, 2)}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function buildSentencePrompt(sentence) {
  const system = "你是一个专业翻译。只返回翻译结果，不要解释。";
  const user = `请将以下英文翻译成自然流畅的中文，只返回翻译文本：\n"${sentence}"`;

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function parseWordResponse(raw, word) {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(json)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?```\s*$/, "");

  try {
    const parsed = JSON.parse(cleaned);

    const sanitizeArray = (arr) => (Array.isArray(arr) ? arr : []);

    const meanings = sanitizeArray(parsed.meanings).map((m) => ({
      pos: m.pos || "",
      definitions: sanitizeArray(m.definitions),
      examples: sanitizeArray(m.examples).map((ex) => ({
        en: ex.en || "",
        zh: ex.zh || ""
      }))
    }));

    return {
      type: "word",
      word: parsed.word || word,
      phonetic: {
        uk: parsed.phonetic?.uk || "",
        us: parsed.phonetic?.us || ""
      },
      meanings: meanings,
      synonyms: sanitizeArray(parsed.synonyms),
      antonyms: sanitizeArray(parsed.antonyms),
      collocations: sanitizeArray(parsed.collocations),
      etymology: parsed.etymology || ""
    };
  } catch {
    return { type: "word", raw: raw };
  }
}

function parseSentenceResponse(raw, original) {
  return {
    type: "sentence",
    original: original,
    translation: raw.trim()
  };
}

function updateBadge(enabled) {
  const text = enabled ? "ON" : "OFF";
  const color = enabled ? "#4CAF50" : "#9E9E9E";
  chrome.action.setBadgeText({ text: text });
  chrome.action.setBadgeBackgroundColor({ color: color });
}

async function initBadge() {
  const config = await getConfig();
  updateBadge(config.enabled);
}

async function initExtension() {
  await initCache();
  await initBadge();
}

chrome.runtime.onStartup.addListener(initExtension);
chrome.runtime.onInstalled.addListener(initExtension);

// Top-level init: runs when Service Worker starts (including wakes from message events)
initCache().catch(err => console.error("[Translate] Top-level cache init failed:", err));

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-translation") {
    const config = await getConfig();
    config.enabled = !config.enabled;
    await chrome.storage.sync.set({ enabled: config.enabled });
    updateBadge(config.enabled);
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "toggle", enabled: config.enabled });
      } catch {}
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== "translate") return false;

  (async () => {
    const config = await getConfig();

    if (!config.enabled) {
      sendResponse({ type: "error", message: "翻译功能已禁用" });
      return;
    }

    if (!config.apiKey) {
      sendResponse({ type: "error", message: "请先在选项页配置 API Key" });
      return;
    }

    try {
      const isWord = request.mode === "word";
      const cacheKey = request.text.trim().toLowerCase();

      // === 确保缓存已初始化 ===
      if (!cacheReady) {
        await initCache();
      }

      // === 先查缓存 ===
      if (isWord) {
        const cached = await TranslateDB.getCachedWord(cacheKey);
        if (cached) {
          sendResponse(cached.data);
          return;
        }
      }

      if (!isWord) {
        const cached = await TranslateDB.getCachedSentence(request.text.trim());
        if (cached) {
          sendResponse(cached.data);
          return;
        }
      }

      // 未命中，调用 API
      const messages = isWord
        ? buildWordPrompt(request.text)
        : buildSentencePrompt(request.text);

      const raw = await callLLM(config, messages);

      const result = isWord
        ? parseWordResponse(raw, request.text)
        : parseSentenceResponse(raw, request.text);

      // === 写入缓存 ===
      if (isWord && result.type === "word" && !result.raw) {
        await TranslateDB.setUserWordCache(cacheKey, result);
      } else if (!isWord && result.type === "sentence") {
        await TranslateDB.setSentenceCache(request.text.trim(), result);
      }

      sendResponse(result);
    } catch (err) {
      sendResponse({ type: "error", message: err.message });
    }
  })().catch((err) => {
    sendResponse({ type: "error", message: err.message || "未知错误" });
  });

  return true;
});