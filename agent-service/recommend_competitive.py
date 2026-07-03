"""
竞争式推荐 — 多策略并行推荐

三种策略并行执行：
  1. 弹药库推荐（arsenal）— 用户红心歌单
  2. 搜索推荐（search）— 基于关键词
  3. 氛围推荐（atmosphere）— 基于天气+时段
"""

import asyncio
from tools import search_song, pick_from_arsenal


async def recommend_competitive(context: dict, profile: dict, count: int = 5) -> list:
    """
    竞争式推荐：并行执行多策略，合并去重

    Args:
        context: 环境上下文 {weather, dayPhase, ...}
        profile: 用户画像 {favorite_genres, favorite_artists, ...}
        count: 最终返回数量

    Returns:
        去重后的歌曲列表
    """
    # 构建关键词
    keywords = []
    if profile.get("favorite_genres"):
        keywords.extend(profile["favorite_genres"][:2])
    if profile.get("favorite_artists"):
        keywords.append(profile["favorite_artists"][0])

    search_kw = " ".join(keywords) if keywords else "流行"

    # 并行执行三种策略
    arsenal_task = pick_from_arsenal(count, search_kw)
    search_task = search_song(search_kw, count)
    trending_task = search_song("热门歌曲", count)

    results = await asyncio.gather(
        arsenal_task,
        search_task,
        trending_task,
        return_exceptions=True,
    )

    # 合并去重
    seen = set()
    merged = []

    for r in results:
        if isinstance(r, Exception):
            continue
        if isinstance(r, list):
            for s in r:
                sid = str(s.get("id", ""))
                if sid and sid not in seen:
                    seen.add(sid)
                    merged.append(s)

    return merged[:count]
