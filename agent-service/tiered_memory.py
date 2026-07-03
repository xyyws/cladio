"""
Tiered Memory System — 分层记忆架构

三层记忆：
  1. 短期记忆（滑动窗口）：最近 N 轮原始对话
  2. 中期记忆（状态机）：LLM 提取的用户画像/偏好/任务进度
  3. 长期记忆（向量化）：旧对话摘要 + RAG 召回

每次请求时，动态组装 System Prompt。
"""
import json
import time
from typing import Optional
from dataclasses import dataclass, field, asdict

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage


# ══════════════════════════════════════════════
# 数据模型
# ══════════════════════════════════════════════

@dataclass
class UserProfile:
    """用户画像"""
    music_taste: str = ""          # 音乐品味描述
    favorite_artists: list = field(default_factory=list)  # 喜欢的歌手
    favorite_genres: list = field(default_factory=list)   # 喜欢的风格
    mood: str = ""                 # 当前心情
    listen_habits: str = ""        # 听歌习惯

@dataclass
class CurrentTask:
    """当前任务状态"""
    goal: str = ""                 # 用户目标
    progress: str = ""             # 进度
    pending_action: str = ""       # 待执行动作

@dataclass
class StateMachine:
    """中期记忆状态机"""
    user_profile: UserProfile = field(default_factory=UserProfile)
    current_task: CurrentTask = field(default_factory=CurrentTask)
    last_updated: float = 0.0
    interaction_count: int = 0

    def to_prompt_string(self) -> str:
        """转为可注入 prompt 的字符串"""
        parts = []

        # 用户画像
        p = self.user_profile
        if p.music_taste:
            parts.append(f"音乐品味: {p.music_taste}")
        if p.favorite_artists:
            parts.append(f"喜欢的歌手: {', '.join(p.favorite_artists)}")
        if p.favorite_genres:
            parts.append(f"喜欢的风格: {', '.join(p.favorite_genres)}")
        if p.mood:
            parts.append(f"当前心情: {p.mood}")
        if p.listen_habits:
            parts.append(f"听歌习惯: {p.listen_habits}")

        # 当前任务
        t = self.current_task
        if t.goal:
            parts.append(f"当前目标: {t.goal}")
        if t.progress:
            parts.append(f"进度: {t.progress}")
        if t.pending_action:
            parts.append(f"待执行: {t.pending_action}")

        if not parts:
            return ""

        return "【用户状态机】\n" + "\n".join(f"- {p}" for p in parts)


# ══════════════════════════════════════════════
# 意图分类器
# ══════════════════════════════════════════════

INTENT_KEYWORDS = {
    "music_search": ["搜索", "找歌", "来首", "想听", "放一首", "点一首", "播放", "来一首", "放首", "给我来", "来点"],
    "playlist": ["歌单", "收藏", "播放列表", "加载歌单", "导入歌单"],
    "recommend": ["推荐", "随便", "来几首", "来点", "选几首", "挑几首"],
    "info": ["谁唱的", "歌词", "评论", "热评", "故事", "介绍一下", "这是什么歌", "歌手"],
    "control": ["暂停", "继续", "下一首", "上一首", "音量", "停止"],
}

def classify_intent(message: str) -> str:
    """基于关键词的意图分类"""
    # 优先匹配具体意图
    for intent, keywords in INTENT_KEYWORDS.items():
        if any(kw in message for kw in keywords):
            return intent
    return "chat"


# ══════════════════════════════════════════════
# 动态工具过滤
# ══════════════════════════════════════════════

INTENT_TOOLS = {
    "music_search": ["search_song", "set_playlist", "get_weather"],
    "playlist": ["load_playlist", "set_playlist", "pick_from_arsenal"],
    "recommend": ["pick_from_arsenal", "set_playlist", "get_weather", "get_memory"],
    "chat": ["save_memory", "get_memory", "pick_from_arsenal", "set_playlist", "get_weather"],
    "info": ["get_song_comments", "get_song_lyrics", "get_artist_wiki", "get_song_context", "search_knowledge"],
    "control": ["set_playlist"],
}

def filter_tools(all_tools: list, intent: str) -> list:
    """根据意图过滤工具"""
    allowed = INTENT_TOOLS.get(intent, ["save_memory", "set_playlist"])
    return [t for t in all_tools if t.name in allowed]


# ══════════════════════════════════════════════
# 分层记忆管理器
# ══════════════════════════════════════════════

class TieredMemory:
    def __init__(
        self,
        llm: ChatOpenAI,
        max_short_term: int = 10,     # 短期记忆：最近 N 条消息
        extract_interval: int = 3,     # 每 N 轮对话提取一次中期记忆
    ):
        self.llm = llm
        self.max_short_term = max_short_term
        self.extract_interval = extract_interval

        # 短期记忆：滑动窗口
        self.short_term: list[dict] = []

        # 中期记忆：状态机
        self.state = StateMachine()

        # 长期记忆：对话摘要列表
        self.long_term_summaries: list[str] = []

        # 对话计数器
        self._turn_count = 0

    # ── 短期记忆 ──

    def add_message(self, role: str, content: str):
        """添加消息到短期记忆"""
        self.short_term.append({"role": role, "content": content})
        # 滑动窗口：只保留最近 N 条
        if len(self.short_term) > self.max_short_term:
            overflow = self.short_term[:-self.max_short_term]
            self.short_term = self.short_term[-self.max_short_term:]
            # 溢出的消息异步归档到长期记忆
            self._archive_messages(overflow)

        self._turn_count += 1

        # 每 N 轮提取一次中期记忆
        if self._turn_count % self.extract_interval == 0:
            return True  # 返回 True 表示需要异步提取
        return False

    def get_short_term(self) -> list[dict]:
        """获取短期记忆"""
        return self.short_term.copy()

    # ── 中期记忆（状态机）──

    async def extract_state(self, recent_messages: list[dict]):
        """用轻量级 LLM 提取用户状态"""
        conversation = "\n".join(
            f"{m['role']}: {m['content']}" for m in recent_messages
        )

        prompt = f"""从以下对话中提取用户信息，返回纯 JSON（不要 Markdown）：

{{
  "user_profile": {{
    "music_taste": "用户音乐品味的一句话描述",
    "favorite_artists": ["歌手1", "歌手2"],
    "favorite_genres": ["风格1", "风格2"],
    "mood": "当前心情",
    "listen_habits": "听歌习惯"
  }},
  "current_task": {{
    "goal": "用户当前想做什么",
    "progress": "做到哪了",
    "pending_action": "接下来要做什么"
  }}
}}

只提取对话中明确提到或可推断的信息，不确定的字段留空字符串。
如果对话中没有有价值的信息，返回空字段。

对话：
{conversation}"""

        try:
            response = await self.llm.ainvoke([HumanMessage(content=prompt)])
            raw = response.content.strip()

            # 清洗 Markdown
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

            data = json.loads(raw)

            # 更新状态机（合并而非覆盖）
            self._merge_state(data)
            self.state.last_updated = time.time()
            self.state.interaction_count = self._turn_count

            print(f"[Memory] 状态机更新: {json.dumps(data, ensure_ascii=False)[:100]}...")

        except Exception as e:
            print(f"[Memory] 状态提取失败: {e}")

    def _merge_state(self, new_data: dict):
        """合并新数据到状态机（不覆盖已有值）"""
        up = new_data.get("user_profile", {})
        if up.get("music_taste") and len(up["music_taste"]) > len(self.state.user_profile.music_taste):
            self.state.user_profile.music_taste = up["music_taste"]
        if up.get("favorite_artists"):
            existing = set(self.state.user_profile.favorite_artists)
            for a in up["favorite_artists"]:
                if a and a not in existing:
                    self.state.user_profile.favorite_artists.append(a)
        if up.get("favorite_genres"):
            existing = set(self.state.user_profile.favorite_genres)
            for g in up["favorite_genres"]:
                if g and g not in existing:
                    self.state.user_profile.favorite_genres.append(g)
        if up.get("mood"):
            self.state.user_profile.mood = up["mood"]
        if up.get("listen_habits"):
            self.state.user_profile.listen_habits = up["listen_habits"]

        ct = new_data.get("current_task", {})
        if ct.get("goal"):
            self.state.current_task.goal = ct["goal"]
        if ct.get("progress"):
            self.state.current_task.progress = ct["progress"]
        if ct.get("pending_action"):
            self.state.current_task.pending_action = ct["pending_action"]

    def get_state_string(self) -> str:
        """获取状态机的 prompt 字符串"""
        return self.state.to_prompt_string()

    # ── 长期记忆 ──

    def _archive_messages(self, messages: list[dict]):
        """将溢出的消息归档（简单摘要）"""
        if not messages:
            return
        summary = " | ".join(
            f"{m['role']}: {m['content'][:50]}" for m in messages
        )
        self.long_term_summaries.append(summary)
        # 只保留最近 20 条摘要
        if len(self.long_term_summaries) > 20:
            self.long_term_summaries = self.long_term_summaries[-20:]

    def get_long_term_context(self) -> str:
        """获取长期记忆上下文"""
        if not self.long_term_summaries:
            return ""
        return "【历史对话摘要】\n" + "\n".join(
            f"- {s}" for s in self.long_term_summaries[-5:]
        )

    # ── 动态 Prompt 组装 ──

    def build_system_prompt(
        self,
        base_prompt: str,
        env_context: str = "",
        memory_context: str = "",
    ) -> str:
        """动态组装 System Prompt"""
        parts = [base_prompt]

        # 环境上下文
        if env_context:
            parts.append(f"\n\n环境信息: {env_context}")

        # 中期记忆（状态机）
        state_str = self.get_state_string()
        if state_str:
            parts.append(f"\n\n{state_str}")

        # 外部记忆（SQLite）
        if memory_context:
            parts.append(f"\n\n用户记忆:\n{memory_context}")

        # 长期记忆（摘要）
        long_term = self.get_long_term_context()
        if long_term:
            parts.append(f"\n\n{long_term}")

        return "\n".join(parts)

    def get_intent(self, message: str) -> str:
        """获取用户意图"""
        return classify_intent(message)

    def get_filtered_tools(self, all_tools: list, intent: str) -> list:
        """获取过滤后的工具"""
        return filter_tools(all_tools, intent)
