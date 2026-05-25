# 划词翻译扩展 — 本地缓存优化设计文档

- **日期**: 2026-05-25
- **项目**: 浏览器扩展 — 智能划词翻译（`08/translate-extension/`）
- **目标**: 通过 IndexedDB 本地缓存 + 内置预设词库，让单词翻译达到毫秒级响应

---

## 1. 背景与动机

当前扩展每次选词都直接调用 LLM API，导致：
- **单词翻译延迟高**：通常 2-5 秒，影响阅读流畅度
- **重复查询浪费**："abandon" 等常用词每次重新推理
- **无离线能力**：断网时完全不可用

**解决方案**：引入 IndexedDB 本地缓存层，内置技术领域高频词库。单词缓存永久保存、不设上限；句子缓存设 7 天 TTL、上限 500 条（超限时自动删除最旧条目）。

---

## 2. 需求概述

### 2.1 功能需求

| 编号 | 需求 | 优先级 |
|------|------|--------|
| F1 | 单词翻译优先查本地缓存，命中则毫秒级返回 | P0 |
| F2 | 缓存未命中时调用 LLM API，结果自动写入缓存 | P0 |
| F3 | 内置约 2000-3000 个技术领域高频词预设缓存（后端/Web/AI 开发） | P0 |
| F4 | 预设词库在扩展启动时自动同步（版本号机制） | P0 |
| F5 | 设置页支持「导出缓存」：合并预设 + 用户缓存为 JSON 文件 | P1 |
| F6 | 设置页支持「清空用户缓存」：仅删除 API 请求产生的缓存，保留预设 | P1 |
| F7 | 句子模式也走缓存，TTL 7 天，上限 500 条，超限时删除最旧条目 | P0 |
| F8 | 清空用户缓存时同时清空句子缓存 | P1 |

### 2.2 非功能需求

- **速度**：缓存命中时展示延迟 < 50ms（从选词到浮窗出现）
- **容量**：单词缓存无上限；句子缓存上限 500 条
- **持久性**：单词缓存永久保存；句子缓存 TTL 7 天，超期或超限自动淘汰
- **兼容性**：Chrome / Edge（Manifest V3），IndexedDB 在 Service Worker 中可用

---

## 3. 架构设计

### 3.1 缓存架构：双 Store 分离缓存

```
IndexedDB: TranslateExtensionDB
├── Store: word_cache
│   ├── Key: word（小写化，去首尾空格）
│   ├── Value: { word, data, isPreset, cachedAt }
│   └── 索引：无（word 本身即 key）
│
├── Store: sentence_cache
│   ├── Key: text（trim 后的原始句子）
│   ├── Value: { text, data, cachedAt, expiresAt }
│   └── 索引：无（text 本身即 key）
│
└── Store: meta（元数据）
    ├── Key: "presetVersion"
    └── Value: { version: "1.0.0", syncedAt: 1745587200000 }
```

### 3.2 数据模型

```typescript
interface CacheRecord {
  word: string;          // 小写缓存键，如 "database"
  data: WordResult;      // 与 background.js 返回的 word 结构完全一致
  isPreset: boolean;     // true = 内置预设，false = 用户 API 缓存
  cachedAt: number;      // 写入时间戳（预设用打包时间，用户用请求时间）
}

interface WordResult {
  type: "word";
  word: string;
  phonetic: { uk: string; us: string };
  meanings: Array<{
    pos: string;
    definitions: string[];
    examples: Array<{ en: string; zh: string }>;
  }>;
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  etymology: string;
}

interface SentenceCacheRecord {
  text: string;          // trim 后的原始句子（key）
  data: SentenceResult;  // 与 background.js 返回的 sentence 结构一致
  cachedAt: number;      // 写入时间戳
  expiresAt: number;     // 过期时间戳（cachedAt + 7 days）
}

interface SentenceResult {
  type: "sentence";
  original: string;
  translation: string;
}
```

### 3.3 查询流程

```
用户选中文本
    │
    ▼
content.js 判断 mode
    │
    ├─ "word" → chrome.runtime.sendMessage({type: 'translate', text, mode: 'word'})
    │            background.js: 小写化 → 查 word_cache
    │            ├─ 命中 → sendResponse(cacheRecord.data) 【毫秒级】
    │            └─ 未命中 → callLLM → parseWordResponse → 写入 word_cache → sendResponse
    │
    └─ "sentence" → chrome.runtime.sendMessage({type: 'translate', text, mode: 'sentence'})
                   background.js: trim → 查 sentence_cache
                   ├─ 命中且未过期 → sendResponse(cacheRecord.data) 【毫秒级】
                   └─ 未命中或已过期 → callLLM → parseSentenceResponse
                            │
                            ▼
                      写入 sentence_cache（TTL=7天）
                      若超限（>500条）→ 删除最旧条目（按 cachedAt）
                            │
                            ▼
                      sendResponse(result)
```

### 3.4 预设词库同步机制

**触发时机：** `chrome.runtime.onInstalled` + `chrome.runtime.onStartup`

**同步流程：**

```
1. fetch(chrome.runtime.getURL('preset-words.json'))
   → 获取内置 JSON（含 version 字段）
   │
2. 查 meta store 中 presetVersion
   │
   ├─ 版本号一致 → 跳过同步
   │
   └─ 版本号不一致 / 首次安装 → 继续
         │
3. 开启 IDB 事务：
   a. 删除 word_cache 中所有 isPreset=true 的记录
   b. 批量写入新预设词（isPreset=true, cachedAt=打包时间）
   c. 更新 meta.presetVersion = 新版本号
   │
4. 同步完成
```

**注意：** 同步使用 IndexedDB 批量事务，异步执行，不阻塞用户请求。

### 3.5 更新后的文件结构

```
08/translate-extension/
├── manifest.json               # 扩展声明（无变化）
├── background.js               # 增加缓存查询/写入/同步逻辑
├── db.js                       # 新增：IndexedDB 封装层（初始化、CRUD、导出、清空）
├── preset-words.json           # 新增：内置预设词库（含 version 字段）
├── content.js                  # 无变化（仅发送消息，不感知缓存）
├── styles.css                  # 无变化
├── options.html                # 新增：缓存管理 UI 区域
├── options.js                  # 新增：缓存管理逻辑（导出、清空、统计）
├── popup.js                    # 无变化
└── icons/
```

### 3.6 职责拆分（新增部分）

| 文件 | 新增职责 | 禁止做的事 |
|------|---------|-----------|
| `db.js` | 封装所有 IndexedDB 操作：init、get、set、clearUserCache、exportAll、syncPreset | 绝不直接调用 API，绝不操作 DOM |
| `background.js` | 翻译请求时先查缓存；未命中时调 API 并写入缓存；启动时触发预设同步 | 绝不直接操作 IDB（通过 db.js） |
| `options.js` | 渲染缓存统计、处理导出/清空按钮点击 | 绝不直接操作 IDB（通过 db.js） |

---

## 4. 详细设计

### 4.1 预设词库范围

覆盖 3 大类技术词汇，约 2000-3000 个，每个词条包含完整 `WordResult` 结构：

| 类别 | 示例词 | 数量预估 |
|------|--------|----------|
| **后端开发** | `middleware`, `concurrency`, `transaction`, `replication`, `idempotency`, `serialization`, `deserialization`, `ORM`, `migration`, `sharding`, `eventual-consistency` | ~800 |
| **网站开发** | `viewport`, `hydration`, `SSR`, `CSR`, `cross-origin`, `polyfill`, `debounce`, `throttle`, `responsive`, `layout`, `reflow`, `repaint` | ~700 |
| **AI 应用开发** | `embedding`, `tokenization`, `fine-tuning`, `hallucination`, `RAG`, `prompt-engineering`, `inference`, `benchmark`, `multimodal`, `agentic`, `chain-of-thought` | ~500 |
| **通用技术高频词** | `algorithm`, `dependency`, `refactor`, `deprecated`, `immutable`, `asynchronous`, `callback`, `closure`, `recursion`, `encapsulation` | ~500 |

**`preset-words.json` 格式：**

```json
{
  "version": "1.0.0",
  "generatedAt": "2026-05-25",
  "count": 2487,
  "words": {
    "database": {
      "type": "word",
      "word": "database",
      "phonetic": { "uk": "\u02c8de\u026at\u0259be\u026as", "us": "\u02c8de\u026at\u0259be\u026as" },
      "meanings": [
        {
          "pos": "n.",
          "definitions": ["数据库", "资料库"],
          "examples": [
            { "en": "The application stores user data in a relational database.", "zh": "该应用将用户数据存储在关系型数据库中。" }
          ]
        }
      ],
      "synonyms": ["datastore", "repository"],
      "antonyms": [],
      "collocations": ["relational database", "NoSQL database", "database schema"],
      "etymology": "data + base，20世纪60年代由计算机科学家创造。"
    }
  }
}
```

### 4.2 IndexedDB 封装层（db.js）

```javascript
const DB_NAME = "TranslateExtensionDB";
const DB_VERSION = 1;
const STORE_WORDS = "word_cache";
const STORE_META = "meta";

// 初始化数据库
async function initDB() { ... }

// === 单词缓存 ===
async function getCachedWord(word) { ... }
async function setUserWordCache(word, data) { ... }

// === 句子缓存 ===
async function getCachedSentence(text) { ... }   // 同时检查是否过期
async function setSentenceCache(text, data) { ... }  // 写入 + 超限清理

// === 预设词库 ===
async function syncPresetWords(presetData) { ... }

// === 导出 / 清空 / 统计 ===
async function exportAllCache() { ... }   // 包含 words + sentences
async function clearUserCache() { ... }     // 清空 word_cache 中 isPreset=false + 全部 sentence_cache
async function getCacheStats() { ... }      // 返回 presetCount, userWordCount, sentenceCount, presetVersion
```

### 4.3 background.js 缓存集成

```javascript
// 在 translate 消息处理器中
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== "translate") return false;

  (async () => {
    const config = await getConfig();
    if (!config.enabled) { ... }
    if (!config.apiKey) { ... }

    const isWord = request.mode === "word";
    const cacheKey = request.text.trim().toLowerCase();

    // === 新增：单词模式先查缓存 ===
    if (isWord) {
      const cached = await db.getCachedWord(cacheKey);
      if (cached) {
        sendResponse(cached.data);
        return;
      }
    }

    // === 新增：句子模式先查缓存 ===
    if (!isWord) {
      const cached = await db.getCachedSentence(request.text.trim());
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

    // === 新增：写入用户缓存 ===
    if (isWord && result.type === "word" && !result.raw) {
      await db.setUserWordCache(cacheKey, result);
    } else if (!isWord && result.type === "sentence") {
      await db.setSentenceCache(request.text.trim(), result);
    }

    sendResponse(result);
  })().catch(...);

  return true;
});
```

### 4.4 设置页缓存管理（options.html / options.js）

**UI 布局（在现有表单下方新增区域）：**

```html
<section class="cache-section">
  <h2>缓存管理</h2>
  <div class="cache-stats">
    <p>预设词库: <span id="presetCount">--</span> 个单词 (<span id="presetVersion">--</span>)</p>
    <p>用户缓存: <span id="userCount">--</span> 个单词</p>
  </div>
  <div class="cache-actions">
    <button id="exportCacheBtn" class="btn btn-primary">导出缓存</button>
    <button id="clearCacheBtn" class="btn btn-danger">清空用户缓存</button>
  </div>
  <p class="cache-hint">导出时合并预设词库和用户缓存；清空仅删除 API 请求产生的缓存。</p>
</section>
```

**options.js 新增逻辑：**

```javascript
// 加载时显示统计
async function loadCacheStats() {
  const stats = await db.getCacheStats();
  document.getElementById("presetCount").textContent = stats.presetCount;
  document.getElementById("presetVersion").textContent = stats.presetVersion;
  document.getElementById("userCount").textContent = stats.userCount;
}

// 导出缓存
async function exportCache() {
  const data = await db.exportAllCache();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `translate-cache-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("导出成功", "success");
}

// 清空用户缓存
async function clearUserCache() {
  if (!confirm("确定要清空所有用户缓存吗？预设词库不会被删除。")) return;
  await db.clearUserCache();
  loadCacheStats();
  showToast("用户缓存已清空", "success");
}
```

### 4.5 导出 JSON 格式

```json
{
  "exportedAt": "2026-05-25T08:30:00.000Z",
  "source": "translate-extension",
  "version": "1.0.0",
  "stats": {
    "presetCount": 2487,
    "userCount": 156,
    "totalCount": 2643
  },
  "words": {
    "database": { /* WordResult */ },
    "middleware": { /* WordResult */ }
  }
}
```

---

## 5. 错误处理

| 场景 | 处理策略 |
|------|----------|
| IndexedDB 初始化失败（如隐私模式） | 降级为无缓存模式，每次直接走 API，浮窗提示「缓存不可用」 |
| 预设词库 JSON 加载失败 | 跳过同步，不影响用户缓存，后台记录错误 |
| 预设同步过程中用户发起翻译 | 同步为后台异步事务，不影响实时查询 |
| 导出时 IDB 为空 | 导出空 JSON（words 为空对象），正常下载 |
| 清空用户缓存时 IDB 不可用 | 提示「缓存操作失败」 |

---

## 6. 安全与隐私

- 缓存数据仅存储在浏览器本地 IndexedDB，不上传任何服务器
- 导出文件为用户主动行为，文件内容不包含 API Key 等敏感配置
- 预设词库为静态 JSON，无动态执行代码

---

## 7. 性能预估

| 指标 | 预估 |
|------|------|
| 缓存命中查询耗时 | < 5ms（IndexedDB 本地读取） |
| 预设词库同步耗时 | ~200-500ms（2000+ 条批量写入） |
| 首次安装后单词翻译 | 预设词库中 → 5ms 内展示 |
| 非预设词首次翻译 | 2-5s（API 调用），之后 < 5ms |
| 预设词库 JSON 体积 | ~1.5-2.5MB（2000-3000 条完整词条） |

---

## 8. 后续可扩展点（本期不做）

- **导入缓存**：支持从 JSON 文件导入缓存数据（与导出配对）
- **缓存 LRU 淘汰**：当缓存过大时自动淘汰低频词条（当前永久保存，不设上限）
- **句子缓存（短句）**：对常见短语（如 "in terms of"）做特殊缓存
- **跨设备同步**：通过 `chrome.storage.sync` 同步缓存元数据（不同步完整词条，体积限制）
