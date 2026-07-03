"""
Tools — Agent 工具定义

通过 HTTP 调用 Node.js 后端的网易云 API。
"""
import os
import httpx


BFF_BASE = os.getenv("BFF_URL", "http://localhost:8080")


async def _bff_get(endpoint: str, params: dict = None) -> dict:
    """调用 Node.js 后端 GET 接口"""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"{BFF_BASE}{endpoint}", params=params)
        return resp.json()


async def _bff_post(endpoint: str, data: dict = None) -> dict:
    """调用 Node.js 后端 POST 接口"""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(f"{BFF_BASE}{endpoint}", json=data)
        return resp.json()


# ══════════════════════════════════════════════
# 工具函数（供 Agent 调用）
# ══════════════════════════════════════════════

async def search_song(keywords: str, limit: int = 5) -> list:
    """搜索歌曲。返回歌曲列表。"""
    try:
        result = await _bff_get("/api/search", {"keywords": keywords, "limit": limit})
        songs = result.get("data", result.get("songs", []))
        return [
            {
                "id": str(s.get("id", "")),
                "name": s.get("name", s.get("title", "")),
                "artists": s.get("artists", s.get("artist", "")),
            }
            for s in songs
        ]
    except Exception as e:
        return [{"error": str(e)}]


async def pick_from_arsenal(count: int = 5, keywords: str = "") -> list:
    """从用户的私人歌库中随机挑选歌曲。"""
    try:
        params = {"limit": count}
        if keywords:
            params["keywords"] = keywords
        result = await _bff_get("/api/arsenal/play", params)
        playlist = result.get("data", {}).get("playlist", [])
        return [
            {
                "id": str(s.get("songId", s.get("id", ""))),
                "name": s.get("title", s.get("name", "")),
                "artists": s.get("artist", s.get("artists", "")),
            }
            for s in playlist[:count]
        ]
    except Exception as e:
        return [{"error": str(e)}]


async def get_weather() -> dict:
    """获取当前天气状况。"""
    try:
        result = await _bff_get("/api/context")
        env = result.get("data", {}).get("env", {})
        return {
            "weather": env.get("weather", "未知"),
            "temperature": env.get("temperature", "未知"),
            "dayPhase": env.get("dayPhase", "未知"),
        }
    except Exception as e:
        return {"error": str(e)}


async def get_play_history(limit: int = 10) -> list:
    """获取用户最近的播放记录。"""
    try:
        result = await _bff_get("/api/history", {"limit": limit})
        return result.get("data", [])
    except Exception as e:
        return [{"error": str(e)}]


async def get_song_comments(song_id: str, limit: int = 5) -> list:
    """获取歌曲的热门评论。"""
    try:
        result = await _bff_get(f"/api/comments/{song_id}", {"limit": limit})
        return result.get("data", [])
    except Exception as e:
        return [{"error": str(e)}]


async def get_song_lyrics(song_id: str) -> dict:
    """获取歌曲歌词。"""
    try:
        result = await _bff_get(f"/api/lyrics/{song_id}")
        return result.get("data", {})
    except Exception as e:
        return {"error": str(e)}


async def get_artist_wiki(artist_id: str) -> dict:
    """获取歌手百科信息。"""
    try:
        result = await _bff_get(f"/api/artist/{artist_id}")
        return result.get("data", {})
    except Exception as e:
        return {"error": str(e)}


async def get_song_details(song_id: str) -> dict:
    """获取歌曲详情。"""
    try:
        result = await _bff_get(f"/api/track/{song_id}")
        return result.get("data", {})
    except Exception as e:
        return {"error": str(e)}


async def load_playlist(playlist_id: str) -> dict:
    """加载网易云歌单。"""
    try:
        result = await _bff_get(f"/api/arsenal/play", {"playlist_id": playlist_id, "limit": 20})
        return result.get("data", {})
    except Exception as e:
        return {"error": str(e)}
