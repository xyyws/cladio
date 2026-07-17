# Claudio — AI 电台主播系统

> 基于多 Agent 编排的智能音乐电台，具备环境感知、个性化推荐、流式可观测能力

## 项目简介

Claudio 是一个 AI 驱动的互联网电台系统。它像一个有品味的深夜 DJ，能根据**天气、时段、用户偏好**自动选歌、写串场词、与听众对话。系统采用**多 Agent 编排架构**，支持复合请求拆解、竞争式推荐、个性化歌单生成等场景，并通过 SSE 流式推送实现全程可观测。

### 核心亮点

- **多 Agent 编排**：Router → Orchestrator → 多个专业 Agent 并行协作
- **预搜索短路**：点歌请求 0 LLM 消耗，直接调用网易云 API 秒回
- **语义关键词扩展**：模糊词（"老歌"）自动映射为具体搜索词（"经典老歌""怀旧金曲"）
- **流式可观测**：SSE 实时推送 Agent 活动（路由分类、搜索、知识获取、推荐）
- **向量 RAG**：TF-IDF + 余弦相似度知识检索，支持语义匹配
- **自动记忆**：规则提取用户偏好/习惯，TF-IDF 语义检索，JSON 持久化
- **网易云扫码登录**：QR 码登录 + Cookie 持久化 + 红心歌单同步
- **播放引擎**：状态机驱动，支持顺序/单曲循环/随机三种模式
- **语音交互**：Web Speech API 语音转文本 + TTS 语音合成

---

## 系统架构

```
┌──────────────────────────────────────────────────────┐
│                  Client (Vue 3 + Vite)                │
│     状态机播放 · SSE 流式 · 语音输入 · 歌单管理        │
└────────────────────┬─────────────────────────────────┘
                     │ /api/* (proxy)
                     ▼
┌──────────────────────────────────────────────────────┐
│              BFF Server (Express.js)                  │
│                                                      │
│  ┌─ Router Agent (规则, 0 token) ────────────────┐   │
│  │  search    → 预搜索短路                        │   │
│  │  genre     → 风格预搜索                        │   │
│  │  liked     → 红心歌单短路                      │   │
│  │  complex   → Orchestrator (LLM 编排)          │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  ┌─ Agent Registry ──────────────────────────────┐   │
│  │  SearchAgent · RecommendAgent                 │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  ┌─ Services ────────────────────────────────────┐   │
│  │  netease · recommendEngine · playlistService  │   │
│  │  audioService · tts · stateDB · context       │   │
│  │  searchService (语义扩展) · mem0_memory        │   │
│  └───────────────────────────────────────────────┘   │
└────────────────────┬─────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌─────────────┐ ┌──────────┐ ┌──────────────────────┐
│ Netease API │ │ LLM API  │ │ Agent Service (Python)│
│   (:3000)   │ │ mimo-v2  │ │ FastAPI (:8001)       │
│ 网易云音乐   │ │ .5-pro   │ │ Orchestrator          │
│ 搜索/歌词/URL│ │          │ │ KnowledgeAgent        │
│ 扫码登录/红心│ │          │ │ Mem0Memory + RAG      │
└─────────────┘ └──────────┘ └──────────────────────┘
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + Vite + Tailwind CSS 4 + PWA |
| 后端 (BFF) | Node.js + Express |
| Agent 服务 | Python + FastAPI + LangChain |
| 大模型 | mimo-v2.5-pro (OpenAI 兼容接口) |
| 音乐数据 | 网易云音乐 NodeJS API (SVIP) |
| TTS | mimo-v2.5-tts |
| 数据库 | SQLite (better-sqlite3) + JSON 持久化 |
| RAG | TF-IDF + 余弦相似度 (纯 Python) |
| 记忆系统 | 规则提取 + 语义检索 + JSON 持久化 |
| 天气 | OpenWeather API |
| 语音识别 | Web Speech API |
| 流式协议 | SSE (Server-Sent Events) |

---

## 项目结构

```
cladio/
├── client/                        # 前端 (Vue 3)
│   └── src/
│       ├── App.vue                # 主界面 (聊天+播放器+歌单)
│       ├── components/
│       │   ├── NowPlayingCard.vue # 正在播放详情
│       │   ├── RadioView.vue      # 电台视图
│       │   ├── PlaylistView.vue   # 歌单管理 (网格卡片+详情)
│       │   ├── ProfileView.vue    # 用户资料
│       │   ├── SongDetailCard.vue # 歌曲详情
│       │   └── FloatingComments.vue
│       └── composables/
│           ├── useRadio.js        # 电台状态机 (顺序/循环/随机)
│           ├── AudioEngine.js     # 播放引擎 (全元素追踪)
│           ├── useUser.js         # 用户状态
│           └── useClock.js        # 实时时钟
│
├── server/                        # BFF 后端 (Node.js)
│   ├── agents/                    # Agent 基础设施
│   │   ├── router.js              # 路由 Agent (search/genre/liked/complex)
│   │   ├── registry.js            # Agent 注册表
│   │   ├── executor.js            # DAG 并行执行器
│   │   ├── recommend.js           # 推荐 Agent (5种策略)
│   │   ├── search.js              # 搜索 Agent
│   │   ├── events.js              # SSE 事件系统
│   │   └── types.js               # 类型定义
│   ├── controllers/
│   │   ├── chatController.js      # 聊天 + SSE 流式 + 路由分流
│   │   ├── qrLoginController.js   # 扫码登录 + Cookie 持久化
│   │   ├── arsenalController.js   # 弹药库管理 + 歌单切换
│   │   └── nextController.js      # 自动播流
│   └── services/
│       ├── netease.js             # 网易云 API (搜索/红心/音质)
│       ├── recommendEngine.js     # 推荐引擎 + 语义关键词映射
│       ├── searchService.js       # 搜索服务 + 语义扩展
│       ├── playlistService.js     # 弹药库管理
│       ├── audioService.js        # 可播放 URL 解析
│       ├── tts.js                 # 语音合成
│       ├── context.js             # 环境上下文组装
│       └── stateDB.js             # SQLite (聊天记录+偏好+歌曲)
│
├── agent-service/                 # Agent 服务 (Python)
│   ├── main.py                    # FastAPI 入口
│   ├── orchestrator.py            # 多 Agent 编排器 (4种场景)
│   ├── knowledge_agent.py         # 知识 Agent (歌词/热评/百科)
│   ├── recommend_competitive.py   # 竞争式推荐
│   ├── agent.py                   # LangChain Agent
│   ├── mem0_memory.py             # 自动记忆 (规则提取+语义检索)
│   ├── rag.py                     # 向量 RAG (TF-IDF + 余弦相似度)
│   └── tools.py                   # Agent 工具定义
│
└── NeteaseCloudMusicApiBackup-main/  # 网易云音乐 API (:3000)
```

---

## 多 Agent 编排

### 路由决策

```
用户消息 → Router Agent (正则, 0 token)
  ├─ search  → 预搜索短路 → 直接返回
  ├─ genre   → 风格搜索 → 直接返回
  ├─ liked   → 红心歌单 → 按收藏时间返回
  └─ complex → Orchestrator (LLM 编排)
```

### 语义关键词扩展

```
用户: "推荐几首老歌"
  → expandKeywords("老歌") → ["经典老歌", "怀旧金曲", "80年代", "90年代经典"]
  → 弹药库搜索 → 网易云全局搜索 → 去重合并
```

### 4 种编排场景

| 场景 | 示例 | 编排方式 |
|------|------|----------|
| 复合请求 | "推荐周杰伦快歌，讲讲他的故事" | SEARCH + KNOWLEDGE 并行 |
| 竞争推荐 | "推荐几首歌" | arsenal + search + trending 并行，择优合并 |
| 电台播流 | 自动模式 | 画像+环境 → 选歌 → 知识 → 串场词 |
| 个性化歌单 | "适合晚上学习的歌单" | LLM 策略 → 多关键词搜索 → 筛选 |

### SSE 事件流

```
event: routing     → 路由分类结果
event: agent_start → Agent 开始执行
event: thinking    → LLM 思考中
event: agent_done  → Agent 完成 (耗时)
event: reply       → 最终回复
event: tracks      → 歌曲列表
event: tts_ready   → TTS 语音就绪
event: done        → 流结束
```

---

## 记忆系统

```
┌──────────────────────────────────────────────────┐
│                   记忆架构                         │
├──────────┬──────────────┬────────────────────────┤
│ 短期记忆  │ 自动记忆      │ 知识检索               │
│ 滑动窗口  │ 规则提取      │ TF-IDF 向量            │
│ 最近10轮  │ 偏好/习惯/心情│ 余弦相似度             │
│ 原始对话  │ JSON 持久化   │ 热评/歌词/百科          │
│ 内存      │ mem0_store   │ knowledge.json         │
└──────────┴──────────────┴────────────────────────┘
```

- **自动记忆**：每条消息即时规则提取（"喜欢XXX" → preference，"睡前听" → habit）
- **去重合并**：TF-IDF 相似度 > 0.7 视为重复，更新置信度
- **语义检索**：搜索时综合相似度 × 置信度 × 新鲜度衰减排序
- **RAG 知识库**：歌曲播放时异步抓取热评/歌词/百科，TF-IDF 向量化存储

---

## 播放引擎

### 状态机

```
idle → loading → playing → paused → idle
                → speaking → idle
                → error → idle
```

### 播放模式

| 模式 | 说明 |
|------|------|
| 顺序播放 | 播完一首播下一首 |
| 单曲循环 | 当前歌曲反复播放 |
| 随机播放 | 随机选下一首 |

### Audio 生命周期管理

- `_allAudioEls` Set 追踪所有 Audio 元素，`stopAll()` 时全部销毁
- 暂停时保留元素（可恢复），切歌时销毁旧元素
- 防止音频泄漏和旧歌继续播放

---

## 用户系统

- **扫码登录**：直接调用 NeteaseCloudMusicApi 函数（绕过设备风控）
- **Cookie 持久化**：`.cookie` 文件，优先级：环境变量 > .cookie > cookie.txt
- **红心同步**：登录时从网易云 `/likelist` 同步真实红心状态
- **收藏意图**："播放我很久之前收藏的歌" → 按收藏时间排序返回
- **音质切换**：标准/较高/极高/无损 四级切换

---

## 快速启动

### 环境要求

- Node.js >= 18
- Python >= 3.11

### 1. 安装依赖

```bash
cd server && npm install
cd client && npm install
cd agent-service && pip install -r requirements.txt
```

### 2. 配置环境变量

在 `server/` 下创建 `.env`：

```env
LLM_API_KEY=your_api_key
LLM_BASE_URL=https://api.mimo.one/v1
LLM_MODEL=mimo-v2.5-pro
OPENWEATHER_API_KEY=your_key
```

### 3. 启动服务 (4 个终端)

```bash
# 终端 1: 网易云音乐 API
cd NeteaseCloudMusicApiBackup-main && npm start       # :3000

# 终端 2: BFF 后端
cd server && npm run dev                              # :8080

# 终端 3: Agent 服务
cd agent-service && python main.py                    # :8001

# 终端 4: 前端
cd client && npm run dev                              # :5173
```

### 4. 访问

浏览器打开 `http://localhost:5173`

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | 聊天（JSON 响应） |
| POST | `/api/chat/stream` | 聊天（SSE 流式） |
| GET | `/api/next` | 获取下一首歌 |
| GET | `/api/search` | 搜索歌曲 |
| GET | `/api/lyrics/:id` | 获取歌词 |
| GET | `/api/comments/:id` | 获取热评 |
| GET | `/api/artist/:id` | 歌手百科 |
| POST | `/api/tts` | 语音合成 |
| GET | `/api/context` | 环境上下文 |
| POST | `/api/arsenal` | 切换弹药库 |
| GET | `/api/arsenal/tracks` | 歌单歌曲列表 |
| POST | `/api/qr/create` | 生成扫码二维码 |
| GET | `/api/qr/check/:key` | 轮询扫码状态 |
| GET | `/api/login/status` | 登录状态 |
| POST | `/api/logout` | 登出 |
| GET | `/api/likelist` | 红心歌曲 ID 列表 |
| GET | `/api/liked` | 红心歌曲详情（按时间） |
| GET/POST | `/api/quality` | 音质查询/切换 |
| POST | `/api/llm` | 轻量 LLM 代理 |

---

## 开发阶段

| 阶段 | 内容 | 状态 |
|------|------|:---:|
| Phase 1 | 基础电台（播放、天气感知、自动播流） | ✅ |
| Phase 2 | AI 对话（Agent、Function Calling、记忆） | ✅ |
| Phase 3 | 多 Agent 编排（Router、Orchestrator、并行） | ✅ |
| Phase 4 | 流式可观测（SSE、Agent 活动面板） | ✅ |
| Phase 5 | 用户系统（扫码登录、红心同步、歌单管理） | ✅ |
| Phase 6 | 播放增强（音质切换、播放模式、语音输入） | ✅ |

---

## License

MIT
