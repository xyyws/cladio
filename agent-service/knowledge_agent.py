"""
Knowledge Agent — 歌曲知识获取

负责获取歌词、热评、歌手百科、RAG 知识搜索。
通过 HTTP 调用 Node.js BFF 的 API。

能力:
  - getSongKnowledge(songId) — 完整知识（歌词+热评+歌手）
  - getSongLyrics(songId) — 歌词
  - getSongComments(songId) — 热评
  - getArtistWiki(artistId) — 歌手百科
  - searchKnowledge(query) — RAG 知识搜索
  - generateSegue(song1, song2, context) — 生成串场词
"""

import os
import asyncio
import httpx
from typing import Optional

BFF_BASE = os.getenv("BFF_URL", "http://localhost:8080")


async def _bff_get(endpoint: str, params: dict = None) -> dict:
    """调用 BFF GET 接口"""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"{BFF_BASE}{endpoint}", params=params)
        return resp.json()


class KnowledgeAgent:
    """歌曲知识获取 Agent"""

    def __init__(self, llm=None):
        self.llm = llm  # 用于生成串场词

    async def get_song_knowledge(self, song_id: str) -> dict:
        """获取歌曲完整知识（并行获取歌词+热评）"""
        lyrics_task = self.get_song_lyrics(song_id)
        comments_task = self.get_song_comments(song_id, limit=3)

        lyrics, comments = await asyncio.gather(
            lyrics_task, comments_task,
            return_exceptions=True,
        )

        return {
            "song_id": song_id,
            "lyrics": lyrics if not isinstance(lyrics, Exception) else None,
            "comments": comments if not isinstance(comments, Exception) else [],
        }

    async def get_song_lyrics(self, song_id: str) -> dict:
        """获取歌曲歌词"""
        try:
            data = await _bff_get(f"/api/lyrics/{song_id}")
            return data.get("data", data)
        except Exception as e:
            return {"error": str(e)}

    async def get_song_comments(self, song_id: str, limit: int = 5) -> list:
        """获取歌曲热门评论"""
        try:
            data = await _bff_get(f"/api/comments/{song_id}", {"limit": limit})
            return data.get("data", [])
        except Exception as e:
            return []

    async def get_artist_wiki(self, artist_id: str) -> dict:
        """获取歌手百科信息"""
        try:
            data = await _bff_get(f"/api/artist/{artist_id}")
            return data.get("data", {})
        except Exception as e:
            return {"error": str(e)}

    async def get_batch_knowledge(self, song_ids: list) -> dict:
        """并行获取多首歌曲的知识"""
        tasks = {
            song_id: self.get_song_knowledge(song_id)
            for song_id in song_ids
        }

        results = {}
        for song_id, task in tasks.items():
            results[song_id] = await task

        return results

    async def generate_segue(
        self,
        song1: dict,
        song2: dict,
        knowledge1: dict,
        knowledge2: dict,
        context: dict = None,
    ) -> str:
        """生成两首歌之间的串场词"""
        if not self.llm:
            return ""

        prompt = f"""你是一个有品味的电台 DJ。请为以下两首歌写一段串场词。

第一首：{song1.get('name', '未知')} - {song1.get('artists', '未知')}
热评：{(knowledge1.get('comments') or [{}])[0].get('content', '无')}

第二首：{song2.get('name', '未知')} - {song2.get('artists', '未知')}
热评：{(knowledge2.get('comments') or [{}])[0].get('content', '无')}

当前环境：{context or '未知'}

要求：
- 自然引入第一首歌，可以讲它的故事或引用热评
- 两首歌之间流畅过渡
- 2-4 句话，温暖自然
- 不要提到"第一首""第二首"，用自然的方式连接"""

        try:
            from langchain_core.messages import HumanMessage
            response = await self.llm.ainvoke([HumanMessage(content=prompt)])
            return response.content.strip()
        except Exception as e:
            print(f"[KnowledgeAgent] 串场词生成失败: {e}")
            return ""
