"""
Memory Store — 用户记忆管理

使用 SQLite 存储用户偏好、习惯、事实等。
与 Node.js 端的 stateDB.js 共享同一个数据库文件。
"""
import sqlite3
import json
from pathlib import Path
from typing import Optional


class MemoryStore:
    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            # 默认使用 Node.js 端的同一个数据库
            db_path = str(
                Path(__file__).parent.parent / "server" / "data" / "claudio.db"
            )
        self.db_path = db_path
        self._init_tables()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_tables(self):
        """确保表存在（与 stateDB.js 兼容）"""
        conn = self._get_conn()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS user_memory (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    category   TEXT NOT NULL,
                    key        TEXT NOT NULL,
                    value      TEXT NOT NULL,
                    confidence REAL DEFAULT 0.5,
                    source     TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_user_memory_category
                    ON user_memory(category);

                CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memory_key
                    ON user_memory(category, key);

                CREATE TABLE IF NOT EXISTS chat_messages (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    role       TEXT NOT NULL,
                    content    TEXT NOT NULL,
                    tracks     TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
                    ON chat_messages(created_at DESC);
            """)
            conn.commit()
        finally:
            conn.close()

    def save(self, category: str, key: str, value: str,
             confidence: float = 0.5, source: str = "inferred"):
        """保存或更新记忆"""
        conn = self._get_conn()
        try:
            conn.execute("""
                INSERT INTO user_memory (category, key, value, confidence, source, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(category, key) DO UPDATE SET
                    value = excluded.value,
                    confidence = MAX(confidence, excluded.confidence),
                    source = excluded.source,
                    updated_at = datetime('now')
            """, (category, key, value, confidence, source))
            conn.commit()
        finally:
            conn.close()

    def get_all(self, category: Optional[str] = None) -> list[dict]:
        """获取所有记忆"""
        conn = self._get_conn()
        try:
            if category:
                rows = conn.execute(
                    "SELECT * FROM user_memory WHERE category = ? ORDER BY confidence DESC",
                    (category,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM user_memory ORDER BY category, confidence DESC"
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_context_string(self) -> str:
        """获取记忆上下文字符串（注入 prompt）"""
        conn = self._get_conn()
        try:
            rows = conn.execute(
                "SELECT category, key, value FROM user_memory WHERE confidence >= 0.5 ORDER BY confidence DESC LIMIT 20"
            ).fetchall()
            if not rows:
                return ""
            return "\n".join(
                f"[{r['category']}] {r['key']}: {r['value']}" for r in rows
            )
        finally:
            conn.close()

    def delete(self, memory_id: int):
        """删除记忆"""
        conn = self._get_conn()
        try:
            conn.execute("DELETE FROM user_memory WHERE id = ?", (memory_id,))
            conn.commit()
        finally:
            conn.close()

    def save_chat(self, role: str, content: str, tracks: Optional[list] = None):
        """保存聊天消息"""
        conn = self._get_conn()
        try:
            conn.execute(
                "INSERT INTO chat_messages (role, content, tracks) VALUES (?, ?, ?)",
                (role, content, json.dumps(tracks) if tracks else None)
            )
            conn.commit()
        finally:
            conn.close()

    def get_chat_history(self, limit: int = 50) -> list[dict]:
        """获取聊天历史"""
        conn = self._get_conn()
        try:
            rows = conn.execute(
                "SELECT role, content, tracks, created_at FROM chat_messages ORDER BY created_at DESC LIMIT ?",
                (limit,)
            ).fetchall()
            result = []
            for r in reversed(rows):
                d = dict(r)
                d["tracks"] = json.loads(d["tracks"]) if d["tracks"] else None
                result.append(d)
            return result
        finally:
            conn.close()
