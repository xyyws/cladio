"""
Mem0 Memory — 自动记忆提取 + 语义检索

混合方案：
  - LLM 自动提取记忆事实（用 Mem0 的核心能力）
  - TF-IDF 向量检索（纯 Python，不依赖 numpy/sklearn）
  - JSON 持久化（不依赖 qdrant/chromadb）

替代 tiered_memory.py，实现：
  - 自动从对话中提取用户偏好/习惯
  - 语义检索相关记忆
  - 记忆去重合并
  - 持久化存储
"""

import os
import json
import time
import httpx
from pathlib import Path
from typing import Optional

# ── 配置 ──

DATA_PATH = str(Path(__file__).parent / "data" / "mem0_store.json")


# ══════════════════════════════════════════════
# 记忆数据模型
# ══════════════════════════════════════════════

class MemoryEntry:
    """单条记忆"""
    def __init__(self, text: str, category: str = "general", confidence: float = 0.8):
        self.text = text
        self.category = category  # preference / habit / mood / fact / task
        self.confidence = confidence
        self.created_at = time.time()
        self.updated_at = time.time()
        self.access_count = 0

    def to_dict(self):
        return {
            "text": self.text,
            "category": self.category,
            "confidence": self.confidence,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "access_count": self.access_count,
        }

    @staticmethod
    def from_dict(d):
        entry = MemoryEntry(d["text"], d.get("category", "general"), d.get("confidence", 0.8))
        entry.created_at = d.get("created_at", time.time())
        entry.updated_at = d.get("updated_at", time.time())
        entry.access_count = d.get("access_count", 0)
        return entry


# ══════════════════════════════════════════════
# LLM 记忆提取
# ══════════════════════════════════════════════

EXTRACT_PROMPT = """你是一个记忆提取器。从用户的消息中提取值得记住的事实。

只提取以下类型的信息：
- preference: 用户的偏好（喜欢什么歌手、风格、歌曲）
- habit: 听歌习惯（什么时候听、怎么听）
- mood: 当前心情或情绪
- fact: 用户提到的个人信息

规则：
- 只提取明确提到的信息，不要推测
- 每条记忆用一句话概括
- 如果没有值得记住的信息，返回空数组

用户消息: "{message}"

返回纯 JSON 数组（不要 Markdown）：
[{{"text": "记忆内容", "category": "类型", "confidence": 0.8}}]

如果没有值得记住的信息，返回: []"""


BFF_BASE = os.getenv("BFF_URL", "http://localhost:8080")

# ── 规则提取（无需 LLM）──

PREFERENCE_PATTERNS = [
    (r'喜欢(.{1,10})', 'preference'),
    (r'爱听(.{1,10})', 'preference'),
    (r'最爱(.{1,10})', 'preference'),
    (r'迷(.{1,10})', 'preference'),
    (r'(.{1,6})是我的(本命|最爱|偶像|青春)', 'preference'),
]

HABIT_PATTERNS = [
    (r'(睡前|睡觉前|晚上).{0,4}(听|放)', 'habit'),
    (r'(早上|起床|通勤).{0,4}(听|放)', 'habit'),
    (r'(工作|学习|看书).{0,4}(听|放)', 'habit'),
    (r'(开车|跑步|运动).{0,4}(听|放)', 'habit'),
]

MOOD_PATTERNS = [
    (r'(心情|感觉)(很好|不错|糟糕|低落|开心|难过|放松|焦虑)', 'mood'),
    (r'(今天|现在)(很|有点|特别).{0,2}(开心|难过|无聊|兴奋|累)', 'mood'),
]

FACT_PATTERNS = [
    (r'我是(.{1,15})', 'fact'),
    (r'我在(.{1,15})', 'fact'),
]


def extract_memories_rule_based(message: str) -> list[dict]:
    """规则提取记忆（无需 LLM，即时可用）"""
    results = []

    for pattern, category in PREFERENCE_PATTERNS:
        m = re.search(pattern, message)
        if m:
            results.append({"text": m.group(0), "category": category, "confidence": 0.8})

    for pattern, category in HABIT_PATTERNS:
        m = re.search(pattern, message)
        if m:
            results.append({"text": m.group(0), "category": category, "confidence": 0.85})

    for pattern, category in MOOD_PATTERNS:
        m = re.search(pattern, message)
        if m:
            results.append({"text": m.group(0), "category": category, "confidence": 0.7})

    for pattern, category in FACT_PATTERNS:
        m = re.search(pattern, message)
        if m:
            results.append({"text": m.group(0), "category": category, "confidence": 0.75})

    return results


async def extract_memories_with_llm(message: str) -> list[dict]:
    """用 LLM 从消息中提取记忆。LLM 不可用时自动降级到规则提取。"""
    prompt = EXTRACT_PROMPT.format(message=message)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{BFF_BASE}/api/llm",
                json={"prompt": prompt, "temperature": 0.1, "max_tokens": 300},
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("reply", "").strip()

            if content.startswith("```"):
                content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

            memories = json.loads(content)
            if isinstance(memories, list) and memories:
                return memories

        # LLM 返回空结果，降级
        return extract_memories_rule_based(message)

    except Exception:
        # LLM 不可用，降级到规则提取（静默）
        return extract_memories_rule_based(message)


# ══════════════════════════════════════════════
# TF-IDF 检索引擎（复用 rag.py 的逻辑）
# ══════════════════════════════════════════════

import re
import math
from collections import Counter


def tokenize(text: str) -> list[str]:
    text = text.lower()
    words = re.findall(r'[a-z]+', text)
    chinese = re.findall(r'[一-鿿]+', text)
    bigrams = []
    for seg in chinese:
        for i in range(len(seg)):
            bigrams.append(seg[i])
            if i + 1 < len(seg):
                bigrams.append(seg[i:i+2])
    return words + bigrams


def cosine_sim(a: dict, b: dict) -> float:
    common = set(a.keys()) & set(b.keys())
    if not common:
        return 0.0
    dot = sum(a[k] * b[k] for k in common)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na > 0 and nb > 0 else 0.0


# ══════════════════════════════════════════════
# Mem0Memory — 自动记忆管理器
# ══════════════════════════════════════════════

class Mem0Memory:
    def __init__(self, data_path: Optional[str] = None):
        self.data_path = data_path or DATA_PATH
        os.makedirs(os.path.dirname(self.data_path), exist_ok=True)

        # 记忆存储：{user_id: [MemoryEntry, ...]}
        self._store: dict[str, list[MemoryEntry]] = {}
        # TF-IDF 索引
        self._idf: dict = {}
        self._doc_vectors: dict[str, list[dict]] = {}  # user_id -> [vectors]

        self._load()

    def _load(self):
        """从 JSON 加载"""
        if os.path.exists(self.data_path):
            try:
                with open(self.data_path, 'r', encoding='utf-8') as f:
                    raw = json.load(f)
                for uid, entries in raw.items():
                    self._store[uid] = [MemoryEntry.from_dict(e) for e in entries]
                print(f"[Mem0] 加载记忆: {sum(len(v) for v in self._store.values())} 条, {len(self._store)} 用户")
            except Exception as e:
                print(f"[Mem0] 加载失败: {e}")

        self._rebuild_index()

    def _save(self):
        """保存到 JSON"""
        raw = {}
        for uid, entries in self._store.items():
            raw[uid] = [e.to_dict() for e in entries]
        with open(self.data_path, 'w', encoding='utf-8') as f:
            json.dump(raw, f, ensure_ascii=False)

    def _rebuild_index(self):
        """重建 TF-IDF 索引"""
        all_texts = []
        self._doc_vectors = {}
        for uid, entries in self._store.items():
            texts = [e.text for e in entries]
            self._doc_vectors[uid] = texts
            all_texts.extend(texts)

        if not all_texts:
            self._idf = {}
            return

        tokenized = [tokenize(t) for t in all_texts]
        df = Counter()
        for tokens in tokenized:
            for t in set(tokens):
                df[t] += 1
        n = len(all_texts)
        self._idf = {t: math.log((n + 1) / (c + 1)) + 1 for t, c in df.items()}

    def _text_vector(self, text: str) -> dict:
        tokens = tokenize(text)
        tf = Counter(tokens)
        total = len(tokens) or 1
        return {t: (c / total) * self._idf.get(t, 1.0) for t, c in tf.items()}

    # ── 核心 API ──

    async def add(self, message: str, user_id: str = "default") -> list[dict]:
        """
        从消息中自动提取记忆并存储。
        返回新提取的记忆列表。
        """
        # LLM 提取
        extracted = await extract_memories_with_llm(message)
        if not extracted:
            return []

        if user_id not in self._store:
            self._store[user_id] = []

        new_memories = []
        for item in extracted:
            text = item.get("text", "").strip()
            if not text:
                continue

            category = item.get("category", "general")
            confidence = item.get("confidence", 0.8)

            # 去重：检查是否已有相似记忆
            existing = self._find_similar(text, user_id)
            if existing:
                # 更新置信度
                existing.confidence = min(1.0, max(existing.confidence, confidence))
                existing.updated_at = time.time()
                existing.access_count += 1
                continue

            # 新增
            entry = MemoryEntry(text, category, confidence)
            self._store[user_id].append(entry)
            new_memories.append(entry.to_dict())

        if new_memories:
            self._rebuild_index()
            self._save()
            print(f"[Mem0] 新增 {len(new_memories)} 条记忆 (user={user_id})")

        return new_memories

    def search(self, query: str, user_id: str = "default", limit: int = 5) -> list[dict]:
        """语义搜索用户记忆"""
        if user_id not in self._store or not self._store[user_id]:
            return []

        entries = self._store[user_id]
        query_vec = self._text_vector(query)

        scored = []
        for i, entry in enumerate(entries):
            entry_vec = self._text_vector(entry.text)
            sim = cosine_sim(query_vec, entry_vec)
            # 综合分数：相似度 * 置信度 * 新鲜度
            freshness = 1.0 / (1.0 + (time.time() - entry.updated_at) / 86400)  # 天数衰减
            score = sim * entry.confidence * (0.7 + 0.3 * freshness)
            scored.append((i, score, sim))

        scored.sort(key=lambda x: x[1], reverse=True)

        results = []
        for i, score, sim in scored[:limit]:
            entry = entries[i]
            entry.access_count += 1
            results.append({
                "text": entry.text,
                "category": entry.category,
                "confidence": entry.confidence,
                "similarity": round(sim, 4),
                "score": round(score, 4),
            })

        return results

    def get_context_string(self, user_id: str = "default", limit: int = 10) -> str:
        """获取用户记忆的 prompt 注入字符串"""
        if user_id not in self._store:
            return ""

        entries = sorted(
            self._store[user_id],
            key=lambda e: e.confidence * e.access_count,
            reverse=True,
        )[:limit]

        if not entries:
            return ""

        lines = []
        for e in entries:
            lines.append(f"- [{e.category}] {e.text}")
        return "\n".join(lines)

    def get_all(self, user_id: str = "default") -> list[dict]:
        """获取用户所有记忆"""
        if user_id not in self._store:
            return []
        return [e.to_dict() for e in self._store[user_id]]

    def delete(self, text: str, user_id: str = "default"):
        """删除匹配的记忆"""
        if user_id not in self._store:
            return
        self._store[user_id] = [e for e in self._store[user_id] if e.text != text]
        self._rebuild_index()
        self._save()

    def get_stats(self) -> dict:
        """统计信息"""
        total = sum(len(v) for v in self._store.values())
        return {
            "total_memories": total,
            "users": len(self._store),
            "data_path": self.data_path,
        }

    # ── 内部方法 ──

    def _find_similar(self, text: str, user_id: str) -> Optional[MemoryEntry]:
        """查找相似记忆（相似度 > 0.7 视为重复）"""
        if user_id not in self._store:
            return None

        text_vec = self._text_vector(text)
        best_sim = 0.0
        best_entry = None

        for entry in self._store[user_id]:
            entry_vec = self._text_vector(entry.text)
            sim = cosine_sim(text_vec, entry_vec)
            if sim > best_sim:
                best_sim = sim
                best_entry = entry

        return best_entry if best_sim > 0.7 else None
