"""
RAG 知识检索 — 歌曲知识库

使用 SQLite FTS5 全文搜索（无需向量数据库）。
数据来源：网易云热评 + 歌词 + 歌手百科。

流程：
  1. 歌曲播放时，异步抓取热评/歌词/百科
  2. 存入 FTS5 知识库
  3. DJ 生成串场词时，检索相关知识注入 prompt
"""
import sqlite3
import json
from pathlib import Path
from typing import Optional


class KnowledgeBase:
    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            db_path = str(
                Path(__file__).parent.parent / "server" / "data" / "claudio.db"
            )
        self.db_path = db_path
        self._init_fts()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_fts(self):
        """初始化 FTS5 全文搜索表"""
        conn = self._get_conn()
        try:
            conn.executescript("""
                -- 歌曲知识库（FTS5 全文搜索）
                CREATE VIRTUAL TABLE IF NOT EXISTS song_knowledge USING fts5(
                    content,
                    song_id,
                    title,
                    artist,
                    source,
                    category,
                    content=song_knowledge,
                    content_rowid=rowid
                );

                -- 元数据表（记录已索引的歌曲）
                CREATE TABLE IF NOT EXISTS knowledge_indexed (
                    song_id TEXT PRIMARY KEY,
                    indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    sources TEXT  -- JSON: ["comment", "lyrics", "wiki"]
                );
            """)
            conn.commit()
        finally:
            conn.close()

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
        conn = self._get_conn()
        try:
            conn.execute(
                "INSERT INTO song_knowledge (song_id, title, artist, content, source, category) VALUES (?, ?, ?, ?, ?, ?)",
                (song_id, title, artist, content, source, category)
            )
            conn.commit()
        finally:
            conn.close()

    def search(self, query: str, limit: int = 5) -> list[dict]:
        """全文搜索知识库"""
        conn = self._get_conn()
        try:
            rows = conn.execute("""
                SELECT song_id, title, artist, content, source, category,
                       rank
                FROM song_knowledge
                WHERE song_knowledge MATCH ?
                ORDER BY rank
                LIMIT ?
            """, (query, limit)).fetchall()
            return [dict(r) for r in rows]
        except Exception:
            return []
        finally:
            conn.close()

    def get_song_context(self, song_id: str) -> str:
        """获取歌曲的全部知识上下文"""
        conn = self._get_conn()
        try:
            rows = conn.execute(
                "SELECT content, source FROM song_knowledge WHERE song_id = ?",
                (song_id,)
            ).fetchall()
            if not rows:
                return ""
            parts = []
            for r in rows:
                source_label = {
                    "comment": "热评",
                    "lyrics": "歌词",
                    "wiki": "百科",
                }.get(r["source"], r["source"])
                parts.append(f"[{source_label}] {r['content']}")
            return "\n".join(parts)
        finally:
            conn.close()

    def is_indexed(self, song_id: str, source: str) -> bool:
        """检查歌曲是否已索引某类数据"""
        conn = self._get_conn()
        try:
            row = conn.execute(
                "SELECT sources FROM knowledge_indexed WHERE song_id = ?",
                (song_id,)
            ).fetchone()
            if not row:
                return False
            sources = json.loads(row["sources"])
            return source in sources
        finally:
            conn.close()

    def mark_indexed(self, song_id: str, source: str):
        """标记歌曲已索引"""
        conn = self._get_conn()
        try:
            row = conn.execute(
                "SELECT sources FROM knowledge_indexed WHERE song_id = ?",
                (song_id,)
            ).fetchone()
            if row:
                sources = json.loads(row["sources"])
                if source not in sources:
                    sources.append(source)
                conn.execute(
                    "UPDATE knowledge_indexed SET sources = ? WHERE song_id = ?",
                    (json.dumps(sources), song_id)
                )
            else:
                conn.execute(
                    "INSERT INTO knowledge_indexed (song_id, sources) VALUES (?, ?)",
                    (song_id, json.dumps([source]))
                )
            conn.commit()
        finally:
            conn.close()

    def get_stats(self) -> dict:
        """获取知识库统计"""
        conn = self._get_conn()
        try:
            total = conn.execute("SELECT COUNT(*) as c FROM song_knowledge").fetchone()["c"]
            songs = conn.execute("SELECT COUNT(*) as c FROM knowledge_indexed").fetchone()["c"]
            return {"total_entries": total, "indexed_songs": songs}
        finally:
            conn.close()
