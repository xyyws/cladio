# Claudio — AI 电台主播系统

> 基于多 Agent 编排的智能音乐电台，具备环境感知、个性化推荐、流式可观测能力

## 项目简介

Claudio 是一个 AI 驱动的互联网电台系统。它像一个有品味的深夜 DJ，能根据**天气、时段、用户偏好**自动选歌、写串场词、与听众对话。系统采用**多 Agent 编排架构**，支持复合请求拆解、竞争式推荐、个性化歌单生成等场景，并通过 SSE 流式推送实现全程可观测。

### 核心亮点

- **多 Agent 编排**：Router → Orchestrator → 多个专业 Agent 并行协作
- **预搜索短路**：点歌请求 0 LLM 消耗，直接调用网易云 API 秒回
- **流式可观测**：SSE 实时推送 Agent 活动（路由分类、搜索、知识获取、推荐）
- **分层记忆**：短期（滑动窗口）+ 中期（LLM 状态机提取）+ 长期（向量化 RAG）
- **环境感知**：OpenWeather 天气 + 时段 + 用户心情，动态调整选歌策略

---

## 系统架构

```
┌──────────────────────────────────────────────────────┐
│                  Client (Vue 3 + Vite)                │
│            状态机驱动播放 · SSE 流式消费               │
└────────────────────┬─────────────────────────────────┘
                     │ /api/* (proxy)
                     ▼
┌──────────────────────────────────────────────────────┐
│              BFF Server (Express.js)                  │
│                                                      │
│  ┌─ Router Agent (规则) ─────────────────────────┐   │
│  │  search → 预搜索短路 (0 LLM)                  │   │
│  │  genre  → 风格预搜索 (0 LLM)                  │   │
│  │  complex → Orchestrator (LLM 编排)            │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  ┌─ Agent Registry ──────────────────────────────┐   │
│  │  SearchAgent · RecommendAgent · ...           │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  ┌─ Services ────────────────────────────────────┐   │
│  │  netease · recommendEngine · playlistService  │   │
│  │  audioService · tts · stateDB · context       │   │
│  └───────────────────────────────────────────────┘   │
└────────────────────┬─────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌─────────────┐ ┌──────────┐ ┌──────────────────────┐
│ Netease API │ │ OpenAI   │ │ Agent Service (Python)│
│   (:3000)   │ │ SDK      │ │ FastAPI (:8001)       │
│ 网易云音乐   │ │ mimo-v2  │ │ Orchestrator          │
│ 搜索/歌词/URL│ │ .5-pro   │ │ KnowledgeAgent        │
└─────────────┘ └──────────┘ │ TieredMemory + RAG    │
                              └──────────────────────┘
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + Vite + Tailwind CSS 4 + PWA |
| 后端 (BFF) | Node.js + Express |
| Agent 服务 | Python + FastAPI + LangChain |
| 大模型 | mimo-v2.5-pro (OpenAI 兼容接口) |
| 音乐数据 | 网易云音乐 NodeJS API |
| TTS | mimo-v2.5-tts |
| 数据库 | SQLite (better-sqlite3) |
| 天气 | OpenWeather API |
| 流式协议 | SSE (Server-Sent Events) |

---

## 项目结构

```
cladio/
├── client/                    # 前端 (Vue 3)
│   └── src/
│       ├── App.vue            # 主界面
│       ├── components/        # UI 组件
│       │   ├── NowPlayingCard.vue
│       │   ├── RadioView.vue
│       │   └── FloatingComments.vue
│       └── composables/       # 逻辑层
│           ├── useRadio.js    # 电台状态机
│           └── AudioEngine.js # 播放引擎
│
├── server/                    # BFF 后端 (Node.js)
│   ├── agents/                # Agent 基础设施
│   │   ├── router.js          # 路由 Agent (规则分类)
│   │   ├── registry.js        # Agent 注册表
│   │   ├── executor.js        # DAG 并行执行器
│   │   ├── recommend.js       # 推荐 Agent (5种策略)
│   │   ├── search.js          # 搜索 Agent
│   │   ├── events.js          # SSE 事件系统
│   │   └── types.js           # 类型定义
│   ├── controllers/           # 路由控制器
│   │   ├── chatController.js  # 聊天 + SSE 流式
│   │   └── nextController.js  # 自动播流
│   └── services/              # 业务服务
│       ├── netease.js         # 网易云 API 客户端
│       ├── recommendEngine.js # 推荐引擎
│       ├── playlistService.js # 弹药库管理
│       ├── tts.js             # 语音合成
│       └── stateDB.js         # SQLite 记忆库
│
├── agent-service/             # Agent 服务 (Python)
│   ├── main.py                # FastAPI 入口
│   ├── orchestrator.py        # 多 Agent 编排器
│   ├── knowledge_agent.py     # 知识 Agent
│   ├── recommend_competitive.py # 竞争式推荐
│   ├── agent.py               # LangChain Agent
│   ├── tiered_memory.py       # 分层记忆系统
│   └── rag.py                 # RAG 知识库
│
└── NeteaseCloudMusicApiBackup-main/  # 网易云音乐 API
```

---

## 多 Agent 编排

### 路由决策

```
用户消息 → Router Agent (正则, 0 token)
  ├─ search  → 预搜索短路 → 直接返回
  ├─ genre   → 风格搜索 → 直接返回
  └─ complex → Orchestrator (LLM 编排)
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

## 快速启动

### 环境要求

- Node.js >= 18
- Python >= 3.11

### 1. 安装依赖

```bash
# 后端
cd server && npm install

# 前端
cd client && npm install

# Agent 服务
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
| POST | `/api/arsenal` | 弹药库管理 |

---

## 记忆系统

```
┌─────────────────────────────────────────────┐
│              分层记忆架构                     │
├──────────┬──────────┬───────────────────────┤
│ 短期记忆  │ 中期记忆  │ 长期记忆              │
│ 滑动窗口  │ LLM 提取  │ 摘要 + RAG           │
│ 最近10轮  │ 用户画像  │ 向量检索              │
│ 原始对话  │ 偏好/心情 │ 旧对话归档            │
└──────────┴──────────┴───────────────────────┘
```

---

## 开发阶段

| 阶段 | 内容 | 状态 |
|------|------|:---:|
| Phase 1 | 基础电台（播放、天气感知、自动播流） | ✅ |
| Phase 2 | AI 对话（Agent、Function Calling、记忆） | ✅ |
| Phase 3 | 多 Agent 编排（Router、Orchestrator、并行） | ✅ |
| Phase 4 | 流式可观测（SSE、Agent 活动面板） | ✅ |

---

## License

MIT
