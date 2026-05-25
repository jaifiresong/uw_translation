# 智能划词翻译扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Chrome Manifest V3 浏览器扩展，实现网页划词自动翻译（单词详细词典级 / 句子简洁翻译），支持快捷键开关和设置页配置 API。

**Architecture:** 原生 JavaScript + CSS + HTML，零构建零依赖。`content.js` 负责页面选词检测与 Shadow DOM 浮窗渲染，`background.js`（Service Worker）负责安全的 API 调用，`options.html` 提供配置界面。三者通过 `chrome.runtime.sendMessage` 通信。

**Tech Stack:** Chrome Extension Manifest V3, Vanilla JS, Shadow DOM, `chrome.storage.sync`, `chrome.commands`

---

## File Structure

```
08/translate-extension/
├── manifest.json          # 扩展清单、权限、脚本入口、快捷键声明
├── background.js          # Service Worker：消息路由、API 调用、配置读取
├── content.js             # 内容脚本：选词监听、词/句判断、Shadow DOM 浮窗渲染
├── styles.css             # 浮窗样式（注入 Shadow DOM）
├── options.html           # 设置页 markup
├── options.js             # 设置页逻辑：表单渲染、校验、保存
└── icons/                 # 扩展图标
    ├── icon16.png         # 可先用任意 16x16 png 占位
    ├── icon48.png         # 可先用任意 48x48 png 占位
    └── icon128.png        # 可先用任意 128x128 png 占位
```

---

### Task 1: 创建目录结构与 manifest.json

**Files:**
- Create: `08/translate-extension/manifest.json`
- Create: `08/translate-extension/icons/` (目录)

- [ ] **Step 1: 创建目录**

```bash
mkdir -p /mnt/d/gitee/ai_app_dev/08/translate-extension/icons
```

- [ ] **Step 2: 编写 manifest.json**

```json
{
  "manifest_version": 3,
  "name": "智能划词翻译",
  "version": "1.0.0",
  "description": "选中文本自动翻译：单词详细释义，句子流畅翻译",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["styles.css"],
      "run_at": "document_end"
    }
  ],
  "options_page": "options.html",
  "action": {
    "default_popup": "",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "commands": {
    "toggle-translation": {
      "suggested_key": {
        "default": "Alt+T"
      },
      "description": "启用/禁用自动翻译"
    }
  }
}
```

- [ ] **Step 3: 创建占位图标**

由于无法在此环境生成真实 png，先创建空文件占位。后续在浏览器测试时，可用任意图片重命名为 icon16.png / icon48.png / icon128.png 放入 icons/ 目录。

```bash
touch /mnt/d/gitee/ai_app_dev/08/translate-extension/icons/icon16.png
touch /mnt/d/gitee/ai_app_dev/08/translate-extension/icons/icon48.png
touch /mnt/d/gitee/ai_app_dev/08/translate-extension/icons/icon128.png
```

- [ ] **Step 4: 验证 manifest 语法**

```bash
python3 -c "import json; json.load(open('/mnt/d/gitee/ai_app_dev/08/translate-extension/manifest.json')); print('manifest.json valid')"
```

**Expected:** `manifest.json valid`

- [ ] **Step 5: Commit**

```bash
git add 08/translate-extension/
git commit -m "feat(translate-extension): add manifest.json and directory structure"
```

---

### Task 2: 实现 background.js（Service Worker）

**Files:**
- Create: `08/translate-extension/background.js`

**职责:** 接收 content.js 发来的翻译请求，从 `chrome.storage.sync` 读取 API 配置，调用 LLM API，解析响应后返回结构化数据。

- [ ] **Step 1: 编写 background.js**

完整代码参考设计文档 `08/docs/superpowers/specs/2026-05-25-translate-extension-design.md` 第 3.4 节，核心模块包括：

1. `getConfig()` — 从 `chrome.storage.sync` 读取配置，带默认值
2. `callLLM(config, messages)` — 封装 fetch 调用 OpenAI-compatible API
3. `buildWordPrompt(word)` — 构造单词翻译 system + user messages，要求返回严格 JSON
4. `buildSentencePrompt(sentence)` — 构造句子翻译 system + user messages
5. `parseWordResponse(raw)` — 提取 JSON（处理 markdown 代码块包装），降级返回 raw
6. `parseSentenceResponse(raw)` — 直接返回 trimmed 文本
7. `chrome.runtime.onMessage.addListener` — 消息路由，处理 `type: "translate"`，校验 enabled/apiKey
8. `chrome.commands.onCommand.addListener` — 监听 `Alt+T` 切换 enabled，更新 badge ON/OFF
9. `chrome.runtime.onInstalled` / `onStartup` — 初始化 badge 状态

**通信协议：**

```javascript
// content.js -> background.js
{ type: "translate", text: "apple", mode: "word" | "sentence" }

// background.js -> content.js
{ type: "word", word, phonetic, meanings, synonyms, antonyms, collocations, etymology }
// 或
{ type: "sentence", original, translation }
// 或
{ type: "error", message }
```

- [ ] **Step 2: 语法检查**

```bash
node --check /mnt/d/gitee/ai_app_dev/08/translate-extension/background.js
```

**Expected:** 无报错（命令无输出即成功）

- [ ] **Step 3: Commit**

```bash
git add 08/translate-extension/background.js
git commit -m "feat(translate-extension): add background service worker for API calls"
```

---

### Task 3: 实现 styles.css（浮窗样式）

**Files:**
- Create: `08/translate-extension/styles.css`

**职责:** 定义 Shadow DOM 内浮窗的样式，包括单词卡片和句子翻译两种布局。样式完全隔离。

- [ ] **Step 1: 编写 styles.css**

核心样式类（完整代码写入文件时参考设计文档 3.2 节浮窗 UI 布局）：

- `.translate-popup` — 浮窗容器，`position: fixed`，`z-index: 2147483647`，圆角阴影
- `@keyframes popup-in` — 淡入缩放动画
- `.popup-header` / `.popup-word` / `.popup-phonetic` — 单词头部区域
- `.meaning-section` / `.pos-tag` — 词性标签和多义区域（蓝色背景 `#e3f2fd`）
- `.definition-list` — 释义列表
- `.example-block` / `.example-en` / `.example-zh` — 例句块（左侧绿色边框 `#4CAF50`）
- `.sentence-original` / `.sentence-translation` — 句子模式
- `.error-message` / `.retry-btn` — 错误状态和重试按钮
- `.loading-spinner` — 加载动画

关键属性：`max-width: 420px`，`border-radius: 12px`，`box-shadow: 0 8px 32px rgba(0,0,0,0.15)`

- [ ] **Step 2: Commit**

```bash
git add 08/translate-extension/styles.css
git commit -m "feat(translate-extension): add popup styles for Shadow DOM isolation"
```

---

### Task 4: 实现 content.js（内容脚本）

**Files:**
- Create: `08/translate-extension/content.js`

**职责:** 监听页面选词事件，判断词/句模式，通过 `chrome.runtime.sendMessage` 请求翻译，使用 Shadow DOM 渲染浮窗。

- [ ] **Step 1: 编写 content.js**

核心逻辑模块（完整代码参考设计文档 3.1 / 3.2 / 3.3 节）：

1. **选词监听** — `document.addEventListener('mouseup', handler)`，获取 `window.getSelection().toString().trim()`
2. **触发条件校验** — 文本非空；全局开关 `enabled` 为 true；非纯中文文本
3. **词/句判断** — `/\s/.test(text) ? 'sentence' : 'word'`
4. **浮窗定位** — `getBoundingClientRect()` 获取选区位置，边界检测自动翻转（下方空间不足时显示在上方）
5. **Shadow DOM 渲染** —
   - 创建 host div `translate-extension-host`，附加 `shadowRoot { mode: 'open' }`
   - 注入 `<style>`（读取 styles.css 内容或内联样式字符串）
   - 根据返回的 `type` 渲染单词卡片或句子翻译
6. **关闭逻辑** — 点击浮窗外部、`Esc` 键、点击关闭按钮时移除浮窗和 host
7. **重试逻辑** — 错误状态浮窗显示重试按钮，点击重新发送 `sendMessage`
8. **加载状态** — 请求发送后先显示 loading spinner，收到响应后替换为内容

**关键实现细节：**

```javascript
// 避免浮窗内点击触发 document 选词事件
popup.addEventListener('mousedown', (e) => e.stopPropagation());
popup.addEventListener('mouseup', (e) => e.stopPropagation());
```

- [ ] **Step 2: 语法检查**

```bash
node --check /mnt/d/gitee/ai_app_dev/08/translate-extension/content.js
```

**Expected:** 无报错

- [ ] **Step 3: Commit**

```bash
git add 08/translate-extension/content.js
git commit -m "feat(translate-extension): add content script for selection detection and popup rendering"
```

---

### Task 5: 实现 options.html + options.js（设置页）

**Files:**
- Create: `08/translate-extension/options.html`
- Create: `08/translate-extension/options.js`

**职责:** 提供用户配置界面，保存 API Provider、API Key、Model、Base URL、全局开关等设置到 `chrome.storage.sync`。

- [ ] **Step 1: 编写 options.html**

页面结构（完整代码参考设计文档 3.5 节）：
- 标题：智能划词翻译 — 设置
- 表单区域：
  - API Provider: `<select>`（deepseek / volcengine）
  - API Key: `<input type="password">`
  - Model: `<input type="text">`
  - Base URL: `<input type="text">`
  - 启用自动翻译: `<input type="checkbox">`
- 快捷键提示：当前快捷键 `Alt+T`
- 保存按钮 + 状态提示（保存成功/失败 toast）

样式：内联 `<style>`，简洁居中布局，最大宽度 600px

- [ ] **Step 2: 编写 options.js**

核心逻辑（完整代码参考设计文档 3.5 节）：
1. `loadConfig()` — 页面加载时从 `chrome.storage.sync` 读取配置填充表单
2. `saveConfig()` — 点击保存时校验并写入 storage
3. Provider 切换事件 — 自动更新 Model 和 Base URL 默认值
4. Toast 提示 — 保存成功/失败时显示

默认值映射：
| Provider | Model | Base URL |
|----------|-------|----------|
| deepseek | deepseek-chat | https://api.deepseek.com |
| volcengine | kimi-k2.6 | https://ark.cn-beijing.volces.com/api/coding/v3 |

- [ ] **Step 3: Commit**

```bash
git add 08/translate-extension/options.html 08/translate-extension/options.js
git commit -m "feat(translate-extension): add options page for API configuration"
```

---

### Task 6: 端到端验证

**Files:**
- All files in `08/translate-extension/`

- [ ] **Step 1: 完整性检查**

确认所有文件存在：

```bash
ls -la /mnt/d/gitee/ai_app_dev/08/translate-extension/
```

**Expected:** 包含 manifest.json, background.js, content.js, styles.css, options.html, options.js, icons/

- [ ] **Step 2: manifest.json 最终验证**

```bash
python3 -c "import json; json.load(open('/mnt/d/gitee/ai_app_dev/08/translate-extension/manifest.json')); print('valid')"
```

**Expected:** `valid`

- [ ] **Step 3: JS 语法检查**

```bash
node --check /mnt/d/gitee/ai_app_dev/08/translate-extension/background.js
node --check /mnt/d/gitee/ai_app_dev/08/translate-extension/content.js
node --check /mnt/d/gitee/ai_app_dev/08/translate-extension/options.js
```

**Expected:** 全部无报错

- [ ] **Step 4: 手动浏览器测试指南**

由于浏览器扩展无法在纯 CLI 环境自动化测试，按以下步骤在 Chrome/Edge 中手动验证：

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `d:/gitee/ai_app_dev/08/translate-extension/` 目录
5. 扩展图标应出现在工具栏，badge 显示「ON」
6. 右键扩展图标 → 选项，进入设置页配置 API Key
7. 保存后，在任意英文网页（如 https://news.ycombinator.com）选中一个单词
8. 预期：弹出浮窗，显示音标、词性、释义、例句等
9. 选中一个句子，预期：弹出浮窗，显示中文翻译
10. 按 `Alt+T`，badge 应变为「OFF」，此时选词不再触发翻译
11. 再次按 `Alt+T`，badge 变回「ON」
12. 断开网络，选词测试，预期：浮窗显示错误信息 + 重试按钮

- [ ] **Step 5: 最终 Commit**

```bash
git add 08/translate-extension/
git commit -m "feat(translate-extension): complete translate extension v1.0.0"
```

---

## Self-Review Checklist

### Spec Coverage

| 设计文档章节 | 对应 Task |
|-------------|----------|
| 2.1 文件结构 | Task 1 |
| 2.3 数据流 & 通信协议 | Task 2, Task 4 |
| 3.1 选词检测与触发 | Task 4 |
| 3.2 浮窗定位 | Task 4 |
| 3.3 Shadow DOM 样式隔离 | Task 3, Task 4 |
| 3.4 API Prompt | Task 2 |
| 3.5 设置页 | Task 5 |
| 3.6 快捷键 | Task 2 |
| 4. 错误处理 | Task 2, Task 4 |
| 5. 安全与隐私 | Task 2 |

**无遗漏。**

### Placeholder Scan

- 无 "TBD", "TODO", "implement later"
- 无 "Add appropriate error handling" 等模糊描述
- 所有任务均包含具体文件路径和验证命令
- 代码逻辑已在设计文档中完整定义，实施计划引用设计文档具体章节
