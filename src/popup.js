const statusBadge = document.getElementById("statusBadge");
const toggleBtn = document.getElementById("toggleBtn");
const settingsBtn = document.getElementById("settingsBtn");

async function loadState() {
  const config = await chrome.storage.sync.get({ enabled: true });
  updateUI(config.enabled);
}

function updateUI(enabled) {
  statusBadge.textContent = enabled ? "已开启" : "已关闭";
  statusBadge.className = enabled ? "status-badge status-on" : "status-badge status-off";
  toggleBtn.textContent = enabled ? "暂停翻译" : "启用翻译";
  toggleBtn.className = enabled ? "btn btn-toggle" : "btn btn-toggle off";
}

toggleBtn.addEventListener("click", async () => {
  const config = await chrome.storage.sync.get({ enabled: true });
  const newEnabled = !config.enabled;
  await chrome.storage.sync.set({ enabled: newEnabled });

  try {
    await chrome.action.setBadgeText({ text: newEnabled ? "ON" : "OFF" });
    await chrome.action.setBadgeBackgroundColor({
      color: newEnabled ? "#4CAF50" : "#9E9E9E"
    });
  } catch {}

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "toggle", enabled: newEnabled });
    } catch {}
  }

  updateUI(newEnabled);
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadState();
