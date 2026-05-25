# 智能划词翻译浏览器扩展设计文档

- **日期**: 2026-05-25
- **项目**: 浏览器扩展 — 智能划词翻译（`08/translate-extension/`）
- **目标**: 帮助用户快速阅读英文网页，选中文本后自动翻译

---

## 1. 需求概述

### 1.1 核心功能
- **划词即译**：用户在任意网页选中文本，自动弹出翻译浮窗
- **智能区分**：
  - **单词**（无空格）：给出详细词典级翻译（音标、词性、多义、例句、同反义词、搭配、词根词缀）
  - **句子**（含空格）：给出简洁流畅的中文翻译
- **快捷键开关**：支持快捷键（如 `Alt+T`）一键启用/禁用自动翻译
- **设置页**：配置 API Key、模型、Base URL 等

### 1.2 非功能需求
- 样式隔离：使用 Shadow DOM，避免与网页 CSS 冲突
- 安全：API Key 存储在 background service worker，不暴露在页面上下文
- 兼容性：Chrome / Edge（Manifest V3）

---

## 2. 架构设计

### 2.1 文件结构

```
08/translate-extension/
├── manifest.json          # 扩展声明、权限、脚本入口
├── background.js          # Service Worker：接收翻译请求，调用 LLM API
├── content.js             # 内容脚本：监听选词、判断词/句、渲染浮窗
├── styles.css             # 浮窗样式（通过 Shadow DOM 注入）
├── options.html           # 设置页 UI
├── options.js             # 设置页逻辑
└── icons/                 # 扩展图标（16x16, 48x48, 128x128）
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### 2.2 职责拆分

| 文件 | 职责 | 禁止做的事 |
|------|------|-----------|
| `content.js` | 监听选词事件、判断词/句、通过 Shadow DOM 渲染浮窗、处理用户交互 | 绝不直接调用外部 API，绝不存储 API Key |
| `background.js` | 接收 `sendMessage` 请求、读取 `chrome.storage` 中的 API 配置、执行 `fetch` 调用 LLM API、返回结构化 JSON | 绝不操作 DOM |
| `options.js` | 渲染设置表单、校验输入、保存到 `chrome.storage.sync` | 绝不调用 API |

### 2.3 数据流

```
用户选中文本
    │
    ▼
content.js ──[判断词/句]──► chrome.runtime.sendMessage({type: 'translate', text, mode})
    │
    ▼
background.js ──[读取 storage 配置]──► fetch(LLM API)
    │
    ▼
background.js ──[解析 JSON]──► sendResponse(result)
    │
    ▼
content.js ──[渲染 Shadow DOM 浮窗]
```

### 2.4 通信协议

```javascript
// content.js → background.js
{
  type: "translate",
  text: "apple",          // 选中的文本
  mode: "word" | "sentence"
}

// background.js → content.js
{
  type: "word",
  word: "apple",
  phonetic: { uk: "...", us: "..." },
  meanings: [...],
  synonyms: [...],
  antonyms: [...],
  collocations: [...],
  etymology: "..."
}
// 或
{
  type: "sentence",
  original: "The quick brown fox...",
  translation: "那只敏捷的棕色狐狸..."
}
// 或
{
  type: "error",
  message: "翻译失败，请检查 API 配置"
}
```

---

## 3. 详细设计

### 3.1 选词检测与触发

**触发条件：**
1. `mouseup` 事件触发
2. `window.getSelection().toString().trim()` 非空
3. 当前全局开关处于开启状态（存储在 `chrome.storage`）
4. 选中文本不包含纯中文字符（可选优化：如果全是中文则不触发）

**词/句判断：**
```javascript
const mode = /\s/.test(selectedText) ? "sentence" : "word";
```

**防抖：** 如果用户在浮窗内操作（如点击重试），需标记浮窗区域，避免选词事件与浮窗点击冲突。

### 3.2 浮窗定位

- 使用 `getBoundingClientRect()` 获取选中文本最后一个字符的位置
- 浮窗默认出现在选区下方 8px
- **边界检测**：若下方空间不足，翻转至上方
- `position: fixed`，`z-index: 2147483647`
- 点击浮窗外部或按 `Esc` 关闭浮窗

### 3.3 样式隔离（Shadow DOM）

```javascript
const host = document.createElement("div");
host.id = "translate-extension-host";
const shadow = host.attachShadow({ mode: "open" });
const style = document.createElement("style");
style.textContent = `/* 注入 styles.css 内容 */`;
shadow.appendChild(style);
// 再 append 浮窗 DOM
```

### 3.4 API Prompt 设计

**单词 Prompt：**
```
请作为英语词典，详细解释单词 "{word}"，返回严格 JSON，不要 markdown 代码块：
{
  "word": "原词",
  "phonetic": { "uk": "英音音标", "us": "美音音标" },
  "meanings": [
    {
      "pos": "词性缩写",
      "definitions": ["中文释义1", "中文释义2"],
      "examples": [
        { "en": "英文例句", "zh": "中文翻译" }
      ]
    }
  ],
  "synonyms": ["同义词1", "同义词2"],
  "antonyms": ["反义词1"],
  "collocations": ["常用搭配1", "常用搭配2"],
  "etymology": "词根词缀解析文字"
}
```

**句子 Prompt：**
```
请将以下英文翻译成自然流畅的中文，只返回翻译文本，不要解释：
"{sentence}"
```

### 3.5 设置页（options.html）

配置项：
- **API Provider**：下拉选择 `deepseek` | `volcengine`
- **API Key**：`<input type="password">`
- **Model**：文本输入，默认 `deepseek-chat`（DeepSeek）或 `kimi-k2.6`（火山）
- **Base URL**：文本输入，预填 `https://api.deepseek.com` 或 `https://ark.cn-beijing.volces.com/api/coding/v3`
- **全局开关**：复选框「启用自动翻译」
- **快捷键显示**：只读文本，显示当前快捷键（如 `Alt+T`），通过 `chrome.commands` 配置

存储键名：
```javascript
chrome.storage.sync.set({
  apiProvider: "deepseek",
  apiKey: "sk-...",
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com",
  enabled: true
});
```

### 3.6 快捷键

在 `manifest.json` 中声明：
```json
"commands": {
  "toggle-translation": {
    "suggested_key": { "default": "Alt+T" },
    "description": "启用/禁用自动翻译"
  }
}
```

`background.js` 监听 `chrome.commands.onCommand`，切换 `enabled` 状态，并通过 `chrome.action.setBadgeText` 在扩展图标上显示「ON」/「OFF」。

---

## 4. 错误处理

| 场景 | 处理策略 |
|------|----------|
| API 返回 4xx/5xx | 浮窗显示「API 请求失败（{status}），请检查配置」 |
| 网络超时（>10s） | 浮窗显示「请求超时，请重试」，带重试按钮 |
| API 返回非预期 JSON | 降级显示原始响应文本 |
| 用户未配置 API Key | 首次使用时弹窗提示「请先在扩展设置中配置 API Key」 |
| 选中文本为空/纯中文 | 静默忽略，不触发翻译 |

---

## 5. 安全与隐私

- API Key 仅存在于 `background.js`（Service Worker 上下文），`content.js` 无法直接访问
- 使用 `chrome.storage.sync` 存储配置，Chrome 会加密同步数据
- 不收集、不上传用户选中的原文到任何第三方（仅发送至用户自配的 LLM API）

---

## 6. 后续可扩展点（本期不做，留作备注）

- 划词后显示「译」按钮（先 hover 再触发）选项
- 支持 PDF 页面翻译（需额外权限和解析逻辑）
- 翻译历史记录本地存储
- 多语言支持（英→中、中→英等）

---

## 7. 技术栈

- **标准**: Chrome Extension Manifest V3
- **语言**: 原生 JavaScript（ES2020+），无框架
- **样式**: 原生 CSS（通过 Shadow DOM 隔离）
- **包管理**: 无（零构建，零依赖）
- **API**: 用户自配 DeepSeek / 火山引擎 OpenAI-compatible API
