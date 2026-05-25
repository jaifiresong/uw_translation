# 浏览器划词翻译

> 选中即译。基于 AI 大模型的 Chrome 浏览器划词翻译扩展，为开发者打造的沉浸式英文阅读利器。

## 为什么选择智能划词翻译？

浏览英文技术文档、阅读论文、逛 Hacker News 时，频繁切换翻译工具打断思路？智能划词翻译让你**选中文字，即刻出结果**，无需离开当前页面。专为程序员深度优化的技术词汇库，读源码、啃论文、追技术博客如虎添翼。

## 核心功能

### 划词即译
在任意网页选中英文单词或句子，浮窗即刻呈现翻译结果。无需右键菜单，无需快捷键，选中即触发。

### 智能词句区分
自动识别选中内容是单词还是句子，匹配最佳翻译策略：
- **单词模式** — 完整词典级结果：音标（英/美）、词性、多条释义、例句、近义词、反义词、常用搭配、词根词源
- **句子模式** — 信达雅的中文翻译，精炼、自然、流畅

### 1,300+ 内置技术词汇库
内建覆盖**后端开发、前端开发、人工智能、通用编程**四大领域的预设词汇表，内置词翻译无需 API 调用，毫秒级即时响应。

### AI 大模型驱动
基于 OpenAI 兼容的 chat/completions API，开箱即用支持：
- **DeepSeek**（deepseek-chat）
- **火山引擎 / 字节方舟**（kimi-k2.6）
- 可自定义任意兼容 API（支持自定义 Base URL 和 Model）

### 智能缓存体系
- **单词缓存** — 查过的词永久保存，越用越快
- **句子缓存** — 7 天有效期，最多 500 条，自动淘汰旧条目
- **预设词库** — 启动时自动同步，版本化管理

### 随时开关
工具栏图标显示 ON/OFF 状态徽章；按 `Alt+T` 一键开关翻译功能，灵活控制。

## 技术亮点

- **Shadow DOM 样式隔离** — 浮窗采用 Shadow DOM 封装，不受宿主页面 CSS 影响，也不污染页面样式
- **零依赖 / 零构建** — 纯原生 JavaScript 开发，无需 `npm install`，无需打包工具，加载即用
- **Service Worker 生命周期韧性** — 针对 Chrome Manifest V3 的 Worker 休眠/唤醒机制进行深度优化
- **优雅的降级处理** — API 超时、缓存失败、JSON 解析异常等场景均有容错方案，用户无感知

## 快速上手

### 安装（Chrome / Edge 开发者模式）

1. 打开 `chrome://extensions/`（Edge 用户打开 `edge://extensions/`）
2. 开启右上角**「开发者模式」**
3. 点击**「加载已解压的扩展程序」**
4. 选择项目中的 `src/` 目录
5. 安装完成！

### 首次配置

1. 点击浏览器工具栏的扩展图标
2. 点击齿轮图标进入**设置页**
3. 选择 API 提供商（DeepSeek / 火山引擎）
4. 填入你的 **API Key**
5. 按需调整模型和 Base URL
6. 点击**保存**，搞定！

### 使用方式

| 操作 | 效果 |
|------|------|
| 选中英文单词 | 显示详细词典信息 |
| 选中英文句子 | 显示中文翻译 |
| `Alt+T` | 开关翻译功能 |
| 点击空白处 / Esc / 点 X | 关闭浮窗 |

## 项目结构

```
src/
├── manifest.json        # Manifest V3 声明
├── background.js        # Service Worker（API 调用、缓存、配置管理）
├── content.js           # 内容脚本（文本选取检测、Shadow DOM 浮窗渲染）
├── db.js                # IndexedDB 抽象层
├── popup.html / .js     # 工具栏弹窗
├── options.html / .js   # 设置页（API 配置 + 缓存管理）
├── styles.css           # 浮窗样式
└── preset-words.json    # 1,315 条预设技术词汇
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 平台 | Chrome Extension Manifest V3（兼容 Edge） |
| 语言 | Vanilla JavaScript (ES2020+) / HTML5 / CSS3 |
| UI 隔离 | Shadow DOM |
| 存储 | chrome.storage.sync + IndexedDB |
| API | OpenAI 兼容 chat/completions |
| 通信 | chrome.runtime.sendMessage |

## License

MIT
