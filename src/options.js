const DEFAULT_CONFIGS = {
  deepseek: {
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com"
  },
  volcengine: {
    model: "kimi-k2.6",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3"
  }
};

let currentProvider = "deepseek";
let lastAutoFilled = { model: "", baseUrl: "" };

function showToast(message, type) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = "toast " + type + " show";
  setTimeout(() => {
    toast.className = toast.className.replace(" show", "");
  }, 2000);
}

function loadConfig() {
  chrome.storage.sync.get(
    {
      apiProvider: "deepseek",
      apiKey: "",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      enabled: true
    },
    function (items) {
      document.getElementById("apiProvider").value = items.apiProvider;
      document.getElementById("apiKey").value = items.apiKey;
      document.getElementById("model").value = items.model;
      document.getElementById("baseUrl").value = items.baseUrl;
      document.getElementById("enabled").checked = items.enabled;

      currentProvider = items.apiProvider;
      lastAutoFilled.model = items.model;
      lastAutoFilled.baseUrl = items.baseUrl;
    }
  );
}

function onProviderChange() {
  const newProvider = document.getElementById("apiProvider").value;
  const defaults = DEFAULT_CONFIGS[newProvider];
  if (!defaults) return;

  const modelInput = document.getElementById("model");
  const baseUrlInput = document.getElementById("baseUrl");

  const prevDefaults = DEFAULT_CONFIGS[currentProvider];
  if (
    modelInput.value === prevDefaults.model ||
    modelInput.value === lastAutoFilled.model
  ) {
    modelInput.value = defaults.model;
  }

  if (
    baseUrlInput.value === prevDefaults.baseUrl ||
    baseUrlInput.value === lastAutoFilled.baseUrl
  ) {
    baseUrlInput.value = defaults.baseUrl;
  }

  lastAutoFilled.model = defaults.model;
  lastAutoFilled.baseUrl = defaults.baseUrl;
  currentProvider = newProvider;
}

function saveConfig(e) {
  e.preventDefault();

  const apiProvider = document.getElementById("apiProvider").value;
  const apiKey = document.getElementById("apiKey").value.trim();
  const model = document.getElementById("model").value.trim();
  const baseUrl = document.getElementById("baseUrl").value.trim();
  const enabled = document.getElementById("enabled").checked;

  if (!apiKey) {
    showToast("请输入 API Key", "error");
    return;
  }

  try {
    new URL(baseUrl);
  } catch {
    showToast("Base URL 格式不正确", "error");
    return;
  }

  chrome.storage.sync.set(
    {
      apiProvider: apiProvider,
      apiKey: apiKey,
      model: model,
      baseUrl: baseUrl,
      enabled: enabled
    },
    function () {
      if (chrome.runtime.lastError) {
        showToast("保存失败: " + chrome.runtime.lastError.message, "error");
      } else {
        showToast("保存成功", "success");
      }
    }
  );
}

// === 缓存管理 ===

async function loadCacheStats() {
  try {
    await TranslateDB.initDB();
    const stats = await TranslateDB.getCacheStats();
    document.getElementById("presetCount").textContent = stats.presetCount;
    document.getElementById("presetVersion").textContent = "(" + stats.presetVersion + ")";
    document.getElementById("userWordCount").textContent = stats.userWordCount;
    document.getElementById("sentenceCount").textContent = stats.sentenceCount;
  } catch (err) {
    console.error("[Translate] Load cache stats failed:", err);
    document.getElementById("presetCount").textContent = "错误";
    document.getElementById("presetVersion").textContent = "";
    document.getElementById("userWordCount").textContent = "错误";
    document.getElementById("sentenceCount").textContent = "错误";
  }
}

async function exportCache() {
  try {
    await TranslateDB.initDB();
    const data = await TranslateDB.exportAllCache();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `translate-cache-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("导出成功", "success");
  } catch (err) {
    console.error("[Translate] Export cache failed:", err);
    showToast("导出失败: " + err.message, "error");
  }
}

async function clearCache() {
  if (!confirm("确定要清空所有用户缓存吗？\n预设词库不会被删除。\n句子缓存也会被清空。")) {
    return;
  }
  try {
    await TranslateDB.initDB();
    await TranslateDB.clearUserCache();
    loadCacheStats();
    showToast("用户缓存已清空", "success");
  } catch (err) {
    console.error("[Translate] Clear cache failed:", err);
    showToast("清空失败: " + err.message, "error");
  }
}

document.addEventListener("DOMContentLoaded", function () {
  loadConfig();
  loadCacheStats();
  document
    .getElementById("apiProvider")
    .addEventListener("change", onProviderChange);
  document
    .getElementById("options-form")
    .addEventListener("submit", saveConfig);
  document
    .getElementById("exportCacheBtn")
    .addEventListener("click", exportCache);
  document
    .getElementById("clearCacheBtn")
    .addEventListener("click", clearCache);
});
