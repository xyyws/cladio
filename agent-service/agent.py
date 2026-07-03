"""
Claudio Agent — LangChain Agent 核心

使用分层记忆架构：
  - 短期记忆：滑动窗口（最近 N 轮）
  - 中期记忆：LLM 自动提取状态机
  - 长期记忆：旧对话摘要 + RAG 召回
  - 动态 Prompt 裁剪：意图识别 + 工具过滤
"""
import json
import asyncio
from typing import Optional

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langchain_core.tools import tool

from memory import MemoryStore
from tiered_memory import TieredMemory, classify_intent
from rag import KnowledgeBase
import tools as api_tools


# ══════════════════════════════════════════════
# System Prompt
# ══════════════════════════════════════════════

SYSTEM_PROMPT = """你是 Claudio，一位有品味的 AI 电台主播。

## 你的工具

| 工具 | 何时使用 | 示例 |
|------|----------|------|
| search_song | 用户指定歌曲/歌手/风格 | "来首周杰伦的晴天" → search_song("周杰伦 晴天") |
| pick_from_arsenal | 用户没指定具体歌曲，随机推荐 | "推荐几首歌" → pick_from_arsenal(5) |
| set_playlist | 决策完成后提交歌曲列表 | 每次回复必须调用 |
| get_song_comments | 用户问评论/热评 | "这首歌有什么评论" |
| get_song_lyrics | 用户问歌词 | "歌词是什么" |
| get_artist_wiki | 用户问歌手信息 | "这个歌手是谁" |
| save_memory | 用户表达偏好/习惯 | "我喜欢民谣" → save_memory("preference", "喜欢的风格", "民谣") |
| get_memory | 需要了解用户偏好 | 推荐歌曲前先读取记忆 |
| search_knowledge | 搜索歌曲知识库 | 生成串场词时使用 |

## 行为准则（必须严格遵守）

1. **点歌流程**：search_song → 拿到结果 → 立即调用 set_playlist 提交歌曲 ID
2. **推荐流程**：pick_from_arsenal → 拿到结果 → 立即调用 set_playlist
3. **每次回复必须调用 set_playlist**，这是强制要求
4. **不要重复搜索**：search_song 只调用一次
5. **不要做多余操作**：拿到歌曲后直接提交，不要额外解释

## 示例

用户: "来首周杰伦的晴天"
你: search_song(keywords="周杰伦 晴天", limit=5)
→ 拿到结果后:
你: set_playlist(reply="周杰伦的《晴天》送给你~", song_ids=["347230"], reason="用户指定")

用户: "推荐几首轻快的歌"
你: pick_from_arsenal(count=5, keywords="轻快")
→ 拿到结果后:
你: set_playlist(reply="挑了几首轻快的歌，希望你喜欢~", song_ids=["123","456"], reason="用户想要轻快的歌")

用户: "今天天气怎么样"
你: get_weather()
→ 拿到结果后:
你: set_playlist(reply="今天多云，适合听点慵懒的歌~", song_ids=["789"], reason="根据天气推荐")

## 回复风格
- 温暖自然，像朋友聊天
- 1-3 句话，不要太长
- 可以引用歌词、热评、歌手故事

## 记忆系统
通过 save_memory 保存用户偏好，通过 get_memory 读取。
"""


# ══════════════════════════════════════════════
# Agent 类
# ══════════════════════════════════════════════

class ClaudioAgent:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.mimo.one/v1",
        model: str = "mimo-v2.5-pro",
        memory_store: Optional[MemoryStore] = None,
    ):
        self.llm = ChatOpenAI(
            api_key=api_key,
            base_url=base_url,
            model=model,
            temperature=0.7,
            max_tokens=1024,
        )

        # 轻量级 LLM（用于记忆提取）
        self.light_llm = ChatOpenAI(
            api_key=api_key,
            base_url=base_url,
            model=model,
            temperature=0.3,
            max_tokens=512,
        )

        self.memory_store = memory_store
        self.knowledge_base = KnowledgeBase()
        self.all_tools = self._create_tools()

        # 分层记忆系统
        self.tiered_memory = TieredMemory(
            llm=self.light_llm,
            max_short_term=10,
            extract_interval=3,
        )

    def _create_tools(self) -> list:
        """创建 Agent 工具"""
        memory_store = self.memory_store
        kb = self.knowledge_base

        @tool
        async def search_song(keywords: str, limit: int = 5):
            """搜索歌曲。当用户想听特定歌曲、歌手、或风格时使用。

            使用场景：
            - 用户说"来首周杰伦的晴天" → search_song("周杰伦 晴天")
            - 用户说"我想听民谣" → search_song("民谣")
            - 用户说"播放薛之谦的歌" → search_song("薛之谦")

            返回：歌曲列表，每首包含 id, name, artists。
            拿到结果后必须立即调用 set_playlist 提交歌曲 ID。
            """
            results = await api_tools.search_song(keywords, limit)
            return results

        @tool
        async def pick_from_arsenal(count: int = 5, keywords: str = ""):
            """从用户的私人歌库中随机挑选歌曲。

            使用场景：
            - 用户说"推荐几首歌" → pick_from_arsenal(5)
            - 用户说"随便来几首" → pick_from_arsenal(5)
            - 用户说"来点轻松的" → pick_from_arsenal(5, "轻松")

            返回：歌曲列表，每首包含 id, name, artists。
            拿到结果后必须立即调用 set_playlist 提交歌曲 ID。
            """
            results = await api_tools.pick_from_arsenal(count, keywords)
            return results

        @tool
        def set_playlist(reply: str, song_ids: list[str], reason: str = ""):
            """设置最终推荐的歌曲列表。这是必须调用的终止工具。

            何时调用：
            - 每次回复都必须调用此工具
            - 在 search_song 或 pick_from_arsenal 拿到结果后立即调用
            - song_ids 必须是歌曲 ID 字符串数组，如 ["347230", "186016"]

            参数：
            - reply: 给用户的回复文字（1-3 句话）
            - song_ids: 歌曲 ID 列表（从 search_song 或 pick_from_arsenal 结果中提取）
            - reason: 推荐理由（可选）
            """
            return {"reply": reply, "song_ids": song_ids, "reason": reason}

        @tool
        async def get_weather():
            """获取当前天气和时段信息。

            使用场景：
            - 用户问"今天天气怎么样"
            - 推荐歌曲前了解环境

            返回：weather, temperature, dayPhase。
            """
            return await api_tools.get_weather()

        @tool
        async def get_play_history(limit: int = 10):
            """获取用户最近的播放记录。

            使用场景：
            - 避免重复推荐同一首歌
            - 了解用户的听歌习惯

            返回：最近播放的歌曲列表。
            """
            return await api_tools.get_play_history(limit)

        @tool
        async def get_song_comments(song_id: str, limit: int = 5):
            """获取歌曲的热门评论（网易云热评）。

            使用场景：
            - 用户问"这首歌有什么评论"
            - 生成串场词时引用热评

            返回：评论列表，每条包含 content, user, likedCount。
            """
            return await api_tools.get_song_comments(song_id, limit)

        @tool
        async def get_song_lyrics(song_id: str):
            """获取歌曲歌词。

            使用场景：
            - 用户问"歌词是什么"
            - 生成串场词时引用歌词

            返回：歌词文本。
            """
            return await api_tools.get_song_lyrics(song_id)

        @tool
        async def get_artist_wiki(artist_id: str):
            """获取歌手百科信息。

            使用场景：
            - 用户问"这个歌手是谁"
            - 生成串场词时介绍歌手

            返回：歌手简介、演艺经历。
            """
            return await api_tools.get_artist_wiki(artist_id)

        @tool
        def save_memory(category: str, key: str, value: str):
            """保存用户记忆/偏好。

            使用场景：
            - 用户说"我喜欢民谣" → save_memory("preference", "喜欢的风格", "民谣")
            - 用户说"我心情不好" → save_memory("mood", "当前心情", "低落")
            - 用户经常在晚上听歌 → save_memory("habit", "听歌时段", "夜晚")

            category 可选值：preference(偏好), fact(事实), habit(习惯), mood(心情)
            """
            if memory_store:
                memory_store.save(category, key, value, confidence=0.7, source="inferred")
            return {"status": "saved", "category": category, "key": key}

        @tool
        def get_memory(category: str = ""):
            """获取用户记忆/偏好。

            使用场景：
            - 推荐歌曲前先了解用户偏好
            - 个性化回复

            返回：用户记忆列表。
            """
            if memory_store:
                memories = memory_store.get_all(category if category else None)
                return {"memories": memories[:10]}
            return {"memories": []}

        @tool
        def search_knowledge(query: str):
            """搜索歌曲知识库（热评、歌词、歌手故事）。

            使用场景：
            - 生成串场词时搜索相关知识
            - 了解歌曲背景

            返回：相关知识条目。
            """
            results = kb.search(query, limit=3)
            return {"results": results}

        @tool
        def get_song_context(song_id: str):
            """获取歌曲的全部知识上下文（热评+歌词+百科）。

            使用场景：
            - 深入了解一首歌
            - 生成详细的串场词

            返回：歌曲的完整知识上下文。
            """
            context = kb.get_song_context(song_id)
            return {"context": context or "暂无知识"}

        return [
            search_song, pick_from_arsenal, set_playlist,
            get_weather, get_play_history,
            get_song_comments, get_song_lyrics, get_artist_wiki,
            save_memory, get_memory, search_knowledge, get_song_context,
        ]

    async def run(
        self,
        message: str,
        history: list = None,
        context: dict = None,
    ) -> dict:
        """
        运行 Agent 对话（分层记忆架构）
        """
        # ── Step 1: 意图识别 ──
        intent = classify_intent(message)
        filtered_tools = self.tiered_memory.get_filtered_tools(self.all_tools, intent)

        # ── Step 2: 添加消息到短期记忆 ──
        need_extract = self.tiered_memory.add_message("user", message)

        # ── Step 3: 组装 System Prompt ──
        env_context = ""
        if context:
            env_info = [f"{k}: {v}" for k, v in context.items() if v]
            env_context = "；".join(env_info)

        memory_context = ""
        if self.memory_store:
            memory_context = self.memory_store.get_context_string()

        system_content = self.tiered_memory.build_system_prompt(
            base_prompt=SYSTEM_PROMPT,
            env_context=env_context,
            memory_context=memory_context,
        )

        # ── Step 4: 构建消息列表 ──
        messages = [SystemMessage(content=system_content)]

        for msg in self.tiered_memory.get_short_term():
            if msg["role"] == "user":
                messages.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                messages.append(AIMessage(content=msg["content"]))

        # ── Step 5: Agent 循环（最多 4 轮） ──
        MAX_LOOPS = 4
        activity_log = []

        for loop in range(MAX_LOOPS):
            llm_with_tools = self.llm.bind_tools(filtered_tools)
            response = await llm_with_tools.ainvoke(messages)

            if not response.content and not response.tool_calls:
                break

            messages.append(response)

            # 没有工具调用 → 直接回复
            if not response.tool_calls:
                reply = response.content or "..."
                break

            # 处理工具调用
            for tc in response.tool_calls:
                func_name = tc["name"]
                func_args = tc["args"]

                activity_log.append({
                    "tool": func_name,
                    "args": func_args,
                    "intent": intent,
                })

                # set_playlist 是终止信号
                if func_name == "set_playlist":
                    self._save_conversation(message, func_args.get("reply", "..."))
                    return {
                        "reply": func_args.get("reply", "..."),
                        "songs": [str(s) for s in func_args.get("song_ids", [])],
                        "activity_log": activity_log,
                        "intent": intent,
                    }

                # 执行工具
                result = await self._execute_tool(func_name, func_args)
                activity_log[-1]["result"] = result

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result, ensure_ascii=False),
                })
        else:
            reply = "我来给你挑几首歌吧"

        # ── Step 6: 兜底 — 从日志中提取歌曲 ──
        collected_songs = []
        for log in activity_log:
            if log["tool"] in ("search_song", "pick_from_arsenal") and isinstance(log.get("result"), list):
                for s in log["result"]:
                    if isinstance(s, dict) and s.get("id"):
                        collected_songs.append(str(s["id"]))

        unique_songs = list(dict.fromkeys(collected_songs))[:5]

        self._save_conversation(message, reply)

        return {
            "reply": reply,
            "songs": unique_songs,
            "activity_log": activity_log,
            "intent": intent,
        }

    async def _execute_tool(self, name: str, args: dict):
        """执行工具"""
        tool_map = {
            "search_song": lambda a: api_tools.search_song(a.get("keywords", ""), a.get("limit", 5)),
            "pick_from_arsenal": lambda a: api_tools.pick_from_arsenal(a.get("count", 5), a.get("keywords", "")),
            "get_weather": lambda a: api_tools.get_weather(),
            "get_play_history": lambda a: api_tools.get_play_history(a.get("limit", 10)),
            "get_song_comments": lambda a: api_tools.get_song_comments(a.get("song_id", ""), a.get("limit", 5)),
            "get_song_lyrics": lambda a: api_tools.get_song_lyrics(a.get("song_id", "")),
            "get_artist_wiki": lambda a: api_tools.get_artist_wiki(a.get("artist_id", "")),
        }

        fn = tool_map.get(name)
        if fn:
            try:
                return await fn(args)
            except Exception as e:
                return {"error": str(e)}

        # 尝试从 self.all_tools 中查找（save_memory, get_memory 等）
        for t in self.all_tools:
            if t.name == name:
                try:
                    return t.invoke(args)
                except Exception as e:
                    return {"error": str(e)}

        return {"error": f"未知工具: {name}"}

    def _save_conversation(self, user_msg: str, ai_reply: str):
        """保存对话到记忆"""
        self.tiered_memory.add_message("assistant", ai_reply)
        if self.memory_store:
            self.memory_store.save_chat("user", user_msg)
            self.memory_store.save_chat("assistant", ai_reply)

        # 异步提取中期记忆
        if self.tiered_memory._turn_count % self.tiered_memory.extract_interval == 0:
            asyncio.create_task(
                self.tiered_memory.extract_state(
                    self.tiered_memory.get_short_term()
                )
            )
