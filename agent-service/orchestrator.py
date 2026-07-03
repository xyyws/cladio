"""
Orchestrator — 多 Agent 编排器

LLM 驱动的任务拆解 + DAG 并行执行 + 结果合并。

支持 4 种编排场景：
  1. 复合请求拆解 — "推荐周杰伦快歌，讲讲他的故事"
  2. 电台自动播流 — 选歌+知识+串场词
  3. 竞争式推荐 — 多策略并行，择优合并
  4. 个性化歌单 — 画像驱动的歌单生成
"""

import json
import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Any

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from knowledge_agent import KnowledgeAgent


# ══════════════════════════════════════════════
# 数据模型
# ══════════════════════════════════════════════

class TaskType(str, Enum):
    SEARCH = "SEARCH"
    RECOMMEND = "RECOMMEND"
    KNOWLEDGE = "KNOWLEDGE"
    MEMORY_READ = "MEMORY_READ"
    CONTEXT = "CONTEXT"
    GENERATE_SEGUE = "GENERATE_SEGUE"
    SET_PLAYLIST = "SET_PLAYLIST"


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Task:
    id: str
    type: TaskType
    params: dict = field(default_factory=dict)
    deps: list = field(default_factory=list)
    status: TaskStatus = TaskStatus.PENDING
    result: Any = None
    error: str = None
    agent: str = None
    started_at: float = 0
    finished_at: float = 0


# ══════════════════════════════════════════════
# Orchestrator
# ══════════════════════════════════════════════

class Orchestrator:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.mimo.one/v1",
        model: str = "mimo-v2.5-pro",
        memory_store=None,
    ):
        self.llm = ChatOpenAI(
            api_key=api_key,
            base_url=base_url,
            model=model,
            temperature=0.3,
            max_tokens=1024,
        )

        self.knowledge_agent = KnowledgeAgent(llm=self.llm)
        self.memory_store = memory_store

    # ── 核心编排方法 ──

    async def orchestrate(
        self,
        message: str,
        history: list = None,
        context: dict = None,
        scenario: str = "auto",
    ) -> dict:
        """
        主编排入口

        Args:
            message: 用户消息
            history: 对话历史
            context: 环境上下文（天气、时段等）
            scenario: 编排场景（auto / compound / radio / competitive / playlist）
        """
        start = time.time()

        # 1. 选择编排场景
        if scenario == "auto":
            scenario = self._detect_scenario(message)

        # 2. 按场景编排
        if scenario == "compound":
            result = await self._orchestrate_compound(message, context)
        elif scenario == "competitive":
            result = await self._orchestrate_competitive(message, context)
        elif scenario == "playlist":
            result = await self._orchestrate_playlist(message, context)
        elif scenario == "radio":
            result = await self._orchestrate_radio(context)
        else:
            # 降级：简单推荐
            result = await self._orchestrate_competitive(message, context)

        result["orchestration_time"] = round(time.time() - start, 2)
        result["scenario"] = scenario
        return result

    # ── 场景检测 ──

    def _detect_scenario(self, message: str) -> str:
        """基于规则的场景检测"""
        # 复合请求：包含多个意图
        has_search = any(kw in message for kw in ['来首', '想听', '播放', '搜索', '搜', '推荐', '来点'])
        has_info = any(kw in message for kw in ['故事', '介绍', '歌词', '评论', '谁唱', '讲讲', '说说'])
        has_playlist = any(kw in message for kw in ['歌单', '适合', '学习', '工作', '睡觉', '运动'])

        if has_search and has_info:
            return "compound"
        if has_playlist:
            return "playlist"
        if has_search:
            return "competitive"

        return "competitive"

    # ── 场景 1: 复合请求拆解 ──

    async def _orchestrate_compound(self, message: str, context: dict = None) -> dict:
        """
        复合请求：搜索 + 知识 并行

        示例: "推荐几首周杰伦的快歌，顺便讲讲他的故事"
        → SEARCH("周杰伦 快歌") + KNOWLEDGE(artist="周杰伦") 并行
        """
        # LLM 拆解任务
        tasks = await self._decompose_compound(message)

        # 并行执行
        results = {}
        search_task = None
        knowledge_task = None

        for task_def in tasks:
            if task_def["type"] == "SEARCH":
                search_task = self._exec_search(task_def["params"])
            elif task_def["type"] == "KNOWLEDGE":
                knowledge_task = self._exec_knowledge(task_def["params"])

        # 并行等待
        gathered = await asyncio.gather(
            search_task or asyncio.coroutine(lambda: [])(),
            knowledge_task or asyncio.coroutine(lambda: {})(),
            return_exceptions=True,
        )

        songs = gathered[0] if not isinstance(gathered[0], Exception) else []
        knowledge = gathered[1] if not isinstance(gathered[1], Exception) else {}

        # 生成回复
        reply = await self._generate_reply(message, songs, knowledge, context)

        return {
            "reply": reply,
            "songs": [str(s.get("id", "")) for s in songs[:5]],
            "knowledge": knowledge,
            "activity_log": [
                {"tool": "search", "args": {"keywords": message}, "result_count": len(songs)},
                {"tool": "knowledge", "args": {"query": message}, "result": knowledge},
            ],
        }

    async def _decompose_compound(self, message: str) -> list:
        """LLM 拆解复合请求为子任务"""
        prompt = f"""分析以下用户消息，拆解为 JSON 任务列表。

用户消息: "{message}"

返回纯 JSON 数组（不要 Markdown），每个元素：
{{"type": "SEARCH|KNOWLEDGE|RECOMMEND|MEMORY_READ", "params": {{...}}}}

示例：
用户: "推荐几首周杰伦的快歌，顺便讲讲他的故事"
返回: [{{"type": "SEARCH", "params": {{"keywords": "周杰伦 快歌"}}}}, {{"type": "KNOWLEDGE", "params": {{"query": "周杰伦", "type": "artist"}}}}]

只返回 JSON 数组，不要其他文字。"""

        try:
            response = await self.llm.ainvoke([HumanMessage(content=prompt)])
            raw = response.content.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            return json.loads(raw.strip())
        except Exception as e:
            print(f"[Orchestrator] 拆解失败: {e}")
            # 降级：整个消息当搜索关键词
            return [{"type": "SEARCH", "params": {"keywords": message}}]

    # ── 场景 2: 电台自动播流 ──

    async def _orchestrate_radio(self, context: dict = None) -> dict:
        """
        电台自动播流：选歌 + 知识 + 串场词

        Phase 1: 读取用户画像 + 环境上下文
        Phase 2: 多策略竞争推荐
        Phase 3: 并行获取歌曲知识
        Phase 4: 生成串场词
        """
        # Phase 1: 上下文
        profile = self._get_user_profile()

        # Phase 2: 竞争推荐
        from recommend_competitive import recommend_competitive
        candidates = await recommend_competitive(context or {}, profile, count=10)

        # 从候选中选 2 首
        selected = candidates[:2] if len(candidates) >= 2 else candidates

        if not selected:
            return {
                "reply": "让我想想给你放什么歌...",
                "songs": [],
                "segue": "",
                "activity_log": [],
            }

        # Phase 3: 并行获取知识
        knowledge_tasks = {
            s["id"]: self.knowledge_agent.get_song_knowledge(s["id"])
            for s in selected
        }

        knowledge = {}
        for sid, task in knowledge_tasks.items():
            knowledge[sid] = await task

        # Phase 4: 生成串场词
        segue = ""
        if len(selected) >= 2:
            segue = await self.knowledge_agent.generate_segue(
                selected[0], selected[1],
                knowledge.get(selected[0]["id"], {}),
                knowledge.get(selected[1]["id"], {}),
                context,
            )

        return {
            "reply": segue or f"为你播放 {selected[0].get('name', '')}",
            "songs": [s["id"] for s in selected],
            "segue": segue,
            "knowledge": knowledge,
            "activity_log": [
                {"tool": "recommend", "strategy": "competitive", "candidates": len(candidates)},
                {"tool": "knowledge", "songs": [s["id"] for s in selected]},
                {"tool": "segue", "generated": bool(segue)},
            ],
        }

    # ── 场景 3: 竞争式推荐 ──

    async def _orchestrate_competitive(self, message: str, context: dict = None) -> dict:
        """
        竞争式推荐：多策略并行，LLM 择优

        并行执行:
          - 弹药库推荐
          - 氛围推荐
          - 热门推荐
        LLM 从候选中选出最佳组合
        """
        # 提取搜索关键词
        keywords = self._extract_keywords(message)

        # 并行获取三种推荐
        from tools import search_song, pick_from_arsenal

        arsenal_task = pick_from_arsenal(5, keywords)
        search_task = search_song(keywords, 5) if keywords else asyncio.coroutine(lambda: [])()

        results = await asyncio.gather(
            arsenal_task,
            search_task,
            return_exceptions=True,
        )

        arsenal_songs = results[0] if not isinstance(results[0], Exception) else []
        search_songs = results[1] if not isinstance(results[1], Exception) else []

        # 合并去重
        all_songs = self._merge_candidates(arsenal_songs, search_songs)

        # 生成回复
        reply = await self._generate_reply(message, all_songs, {}, context)

        return {
            "reply": reply,
            "songs": [str(s.get("id", "")) for s in all_songs[:5]],
            "activity_log": [
                {"tool": "recommend", "strategy": "arsenal", "count": len(arsenal_songs)},
                {"tool": "search", "keywords": keywords, "count": len(search_songs)},
            ],
        }

    # ── 场景 4: 个性化歌单 ──

    async def _orchestrate_playlist(self, message: str, context: dict = None) -> dict:
        """
        个性化歌单生成

        Phase 1: 读取用户画像 + 分析请求
        Phase 2: LLM 生成歌单策略
        Phase 3: 并行搜索
        Phase 4: LLM 筛选排序
        """
        profile = self._get_user_profile()

        # Phase 2: LLM 生成策略
        strategy = await self._generate_playlist_strategy(message, profile, context)

        # Phase 3: 并行搜索
        from tools import search_song
        search_tasks = [
            search_song(kw, 5)
            for kw in strategy.get("keywords", ["轻音乐"])
        ]

        results = await asyncio.gather(*search_tasks, return_exceptions=True)

        candidates = []
        for r in results:
            if not isinstance(r, Exception):
                candidates.extend(r)

        # 去重
        seen = set()
        unique = []
        for s in candidates:
            sid = str(s.get("id", ""))
            if sid and sid not in seen:
                seen.add(sid)
                unique.append(s)

        # Phase 4: 筛选（取前 10 首）
        selected = unique[:10]

        reply = strategy.get("intro", f"为你生成了一个歌单，共 {len(selected)} 首歌~")

        return {
            "reply": reply,
            "songs": [str(s.get("id", "")) for s in selected],
            "strategy": strategy,
            "activity_log": [
                {"tool": "strategy", "keywords": strategy.get("keywords", [])},
                {"tool": "search", "total_candidates": len(candidates), "selected": len(selected)},
            ],
        }

    async def _generate_playlist_strategy(self, message: str, profile: dict, context: dict) -> dict:
        """LLM 生成歌单策略"""
        prompt = f"""根据用户请求，生成歌单搜索策略。

用户请求: "{message}"
用户偏好: {json.dumps(profile, ensure_ascii=False)}
当前环境: {json.dumps(context or {}, ensure_ascii=False)}

返回纯 JSON（不要 Markdown）：
{{
  "keywords": ["搜索关键词1", "搜索关键词2", "搜索关键词3"],
  "intro": "给用户的一句话介绍",
  "mood": "歌单氛围描述"
}}

只返回 JSON，不要其他文字。"""

        try:
            response = await self.llm.ainvoke([HumanMessage(content=prompt)])
            raw = response.content.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            return json.loads(raw.strip())
        except Exception as e:
            print(f"[Orchestrator] 策略生成失败: {e}")
            return {"keywords": ["轻音乐", "纯音乐"], "intro": "为你准备了一些好听的歌~", "mood": "放松"}

    # ── 辅助方法 ──

    async def _exec_search(self, params: dict) -> list:
        """执行搜索任务"""
        from tools import search_song
        return await search_song(params.get("keywords", ""), params.get("limit", 5))

    async def _exec_knowledge(self, params: dict) -> dict:
        """执行知识获取任务"""
        query = params.get("query", "")
        knowledge_type = params.get("type", "general")

        if knowledge_type == "artist":
            # 搜索歌手 ID 然后获取百科
            from tools import search_song
            songs = await search_song(query, 1)
            if songs and songs[0].get("id"):
                # 尝试获取歌手信息
                return await self.knowledge_agent.get_artist_wiki(
                    str(songs[0].get("artistId", ""))
                )

        return {"query": query, "note": "知识获取需要具体的 songId 或 artistId"}

    async def _generate_reply(
        self,
        message: str,
        songs: list,
        knowledge: dict,
        context: dict = None,
    ) -> str:
        """LLM 生成自然语言回复"""
        if not songs:
            return "暂时没找到合适的歌，换一首试试？"

        song_names = [f"{s.get('name', '')} - {s.get('artists', '')}" for s in songs[:3]]

        knowledge_str = ""
        if knowledge:
            knowledge_str = f"\n歌曲知识: {json.dumps(knowledge, ensure_ascii=False)[:200]}"

        prompt = f"""你是 Claudio，一位有品味的 AI 电台主播。

用户说: "{message}"
找到的歌曲: {', '.join(song_names)}
{knowledge_str}

用 1-2 句话自然地回复用户，温暖自然，像朋友聊天。不要输出 Markdown。"""

        try:
            response = await self.llm.ainvoke([HumanMessage(content=prompt)])
            return response.content.strip()
        except Exception:
            return f"为你找到了 {'、'.join(song_names[:2])}，希望你喜欢~"

    def _get_user_profile(self) -> dict:
        """获取用户画像"""
        if self.memory_store:
            try:
                memories = self.memory_store.get_all()
                profile = {}
                for m in memories:
                    if m.get("category") == "preference":
                        profile[m.get("key", "")] = m.get("value", "")
                return profile
            except Exception:
                pass
        return {}

    def _extract_keywords(self, message: str) -> str:
        """从消息中提取搜索关键词"""
        import re
        keywords = re.sub(
            r'播放|来一首|想听|来首|放一首|放首|给我来|点一首|点首|'
            r'推荐|搜索|搜|的歌|歌|音乐|的|吧|吗|呢|啊|顺便|讲讲|说说|'
            r'介绍|一下|故事|歌词|评论|帮我|生成|一个|适合',
            '', message
        ).strip()
        return keywords

    def _merge_candidates(self, *song_lists) -> list:
        """合并多个歌曲列表，去重"""
        seen = set()
        merged = []
        for songs in song_lists:
            if isinstance(songs, list):
                for s in songs:
                    sid = str(s.get("id", ""))
                    if sid and sid not in seen:
                        seen.add(sid)
                        merged.append(s)
        return merged
