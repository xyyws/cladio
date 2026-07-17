"""
RAG 知识检索 — 向量 RAG (TF-IDF + 余弦相似度)

使用 TF-IDF 向量化 + 余弦相似度实现语义检索。
纯 Python 实现，无需 numpy/sklearn/外部 API。

存储位置：agent-service/data/knowledge.json

对比 FTS5 的优势：
  - 语义相似度匹配（"老歌" 能匹配 "怀旧金曲"）
  - TF-IDF 权重（罕见词权重更高）
  - 无需 SQLite FTS5 依赖
"""

import os
import re
import json
import math
from pathlib import Path
from typing import Optional
from collections import Counter

# ── 配置 ──

DATA_PATH = str(Path(__file__).parent / "data" / "knowledge.json")


# ══════════════════════════════════════════════
# TF-IDF 引擎（纯 Python）
# ══════════════════════════════════════════════

def tokenize(text: str) -> list[str]:
    """中英文分词（简单实现：中文逐字 + 英文按空格）"""
    text = text.lower()
    # 英文单词
    words = re.findall(r'[a-z]+', text)
    # 中文字符（每2字为一个 token，捕捉词组）
    chinese = re.findall(r'[一-鿿]+', text)
    bigrams = []
    for seg in chinese:
        for i in range(len(seg)):
            bigrams.append(seg[i])  # 单字
            if i + 1 < len(seg):
                bigrams.append(seg[i:i+2])  # 双字
    return words + bigrams


def cosine_similarity(vec_a: dict, vec_b: dict) -> float:
    """余弦相似度（稀疏向量表示）"""
    common_keys = set(vec_a.keys()) & set(vec_b.keys())
    if not common_keys:
        return 0.0

    dot = sum(vec_a[k] * vec_b[k] for k in common_keys)
    norm_a = math.sqrt(sum(v * v for v in vec_a.values()))
    norm_b = math.sqrt(sum(v * v for v in vec_b.values()))

    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def build_tfidf(documents: list[str]) -> tuple[list[dict], dict]:
    """
    构建 TF-IDF 索引

    Returns:
        doc_vectors: 每个文档的 TF-IDF 向量（稀疏 dict）
        idf: IDF 值 dict
    """
    n = len(documents)
    if n == 0:
        return [], {}

    # 分词
    tokenized = [tokenize(doc) for doc in documents]

    # 计算 DF
    df = Counter()
    for tokens in tokenized:
        for t in set(tokens):
            df[t] += 1

    # 计算 IDF
    idf = {t: math.log((n + 1) / (count + 1)) + 1 for t, count in df.items()}

    # 计算 TF-IDF 向量
    doc_vectors = []
    for tokens in tokenized:
        tf = Counter(tokens)
        total = len(tokens) or 1
        vec = {}
        for t, count in tf.items():
            vec[t] = (count / total) * idf.get(t, 1.0)
        doc_vectors.append(vec)

    return doc_vectors, idf


def tfidf_vectorize(text: str, idf: dict) -> dict:
    """将查询文本转为 TF-IDF 向量"""
    tokens = tokenize(text)
    tf = Counter(tokens)
    total = len(tokens) or 1
    vec = {}
    for t, count in tf.items():
        vec[t] = (count / total) * idf.get(t, 1.0)
    return vec


# ══════════════════════════════════════════════
# KnowledgeBase — 向量知识库
# ══════════════════════════════════════════════

class KnowledgeBase:
    def __init__(self, data_path: Optional[str] = None):
        self.data_path = data_path or DATA_PATH
        os.makedirs(os.path.dirname(self.data_path), exist_ok=True)

        # 加载或初始化知识库
        self.entries: list[dict] = []
        self._doc_vectors: list[dict] = []
        self._idf: dict = {}
        self._load()

    def _load(self):
        """从 JSON 文件加载知识库"""
        if os.path.exists(self.data_path):
            try:
                with open(self.data_path, 'r', encoding='utf-8') as f:
                    self.entries = json.load(f)
                print(f"[RAG] 加载知识库: {len(self.entries)} 条")
            except Exception as e:
                print(f"[RAG] 加载失败: {e}")
                self.entries = []
        else:
            self.entries = []
            print(f"[RAG] 新建知识库: {self.data_path}")

        self._rebuild_index()

    def _save(self):
        """保存到 JSON 文件"""
        with open(self.data_path, 'w', encoding='utf-8') as f:
            json.dump(self.entries, f, ensure_ascii=False, indent=None)

    def _rebuild_index(self):
        """重建 TF-IDF 索引"""
        if not self.entries:
            self._doc_vectors = []
            self._idf = {}
            return

        documents = [e.get("content", "") for e in self.entries]
        self._doc_vectors, self._idf = build_tfidf(documents)

    def add_knowledge(
        self,
        song_id: str,
        title: str,
        artist: str,
        content: str,
        source: str,
        category: str = "story",
    ):
        """添加知识条目"""
        if not content or not content.strip():
            return

        # 去重检查
        for e in self.entries:
            if e.get("song_id") == str(song_id) and e.get("source") == source and e.get("content") == content:
                return

        entry = {
            "song_id": str(song_id),
            "title": title or "",
            "artist": artist or "",
            "content": content.strip(),
            "source": source,
            "category": category,
        }
        self.entries.append(entry)
        self._rebuild_index()
        self._save()

    def search(self, query: str, limit: int = 5) -> list[dict]:
        """语义相似度搜索"""
        if not query or not query.strip() or not self.entries:
            return []

        query_vec = tfidf_vectorize(query, self._idf)

        scores = []
        for i, doc_vec in enumerate(self._doc_vectors):
            sim = cosine_similarity(query_vec, doc_vec)
            scores.append((i, sim))

        # 按相似度降序排序
        scores.sort(key=lambda x: x[1], reverse=True)

        results = []
        for i, sim in scores[:limit]:
            entry = self.entries[i].copy()
            entry["similarity"] = round(sim, 4)
            entry["distance"] = round(1 - sim, 4)
            results.append(entry)

        return results

    def get_song_context(self, song_id: str) -> str:
        """获取歌曲的全部知识上下文"""
        parts = []
        for e in self.entries:
            if e.get("song_id") == str(song_id):
                source_label = {
                    "comment": "热评",
                    "lyrics": "歌词",
                    "wiki": "百科",
                }.get(e.get("source", ""), e.get("source", ""))
                parts.append(f"[{source_label}] {e['content']}")
        return "\n".join(parts)

    def is_indexed(self, song_id: str, source: str) -> bool:
        """检查歌曲是否已索引某类数据"""
        return any(
            e.get("song_id") == str(song_id) and e.get("source") == source
            for e in self.entries
        )

    def get_stats(self) -> dict:
        """获取知识库统计"""
        song_ids = set(e.get("song_id", "") for e in self.entries)
        return {
            "total_entries": len(self.entries),
            "indexed_songs": len(song_ids),
            "backend": "TF-IDF + Cosine Similarity (pure Python)",
            "data_path": self.data_path,
        }

    def migrate_from_fts(self, fts_db_path: str):
        """从旧的 SQLite FTS5 迁移数据"""
        import sqlite3

        if not os.path.exists(fts_db_path):
            print(f"[RAG] FTS 数据库不存在: {fts_db_path}")
            return 0

        conn = sqlite3.connect(fts_db_path)
        conn.row_factory = sqlite3.Row

        try:
            rows = conn.execute(
                "SELECT song_id, title, artist, content, source, category FROM song_knowledge"
            ).fetchall()

            if not rows:
                print("[RAG] FTS 数据库为空，无需迁移")
                return 0

            print(f"[RAG] 开始迁移 {len(rows)} 条知识...")

            count = 0
            for r in rows:
                self.add_knowledge(
                    song_id=str(r["song_id"]),
                    title=r["title"] or "",
                    artist=r["artist"] or "",
                    content=r["content"],
                    source=r["source"] or "",
                    category=r["category"] or "story",
                )
                count += 1

            self._save()
            print(f"[RAG] 迁移完成: {count} 条知识")
            return count

        finally:
            conn.close()
