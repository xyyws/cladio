/**
 * router.js — 路由 Agent
 *
 * 规则驱动的意图分类器，决定消息走哪条路径：
 *   - search:  简单搜索/点歌 → 预搜索短路（0 LLM）
 *   - genre:   风格推荐 → 预搜索短路（0 LLM）
 *   - liked:   收藏/红心歌曲 → 红心列表短路（0 LLM）
 *   - complex: 复合请求 → Python Orchestrator（LLM 编排）
 *   - chat:    普通对话 → Python Agent（LLM 对话）
 */

// ── 搜索意图正则 ──
const SEARCH_RE = /来.{0,2}首|想听|播放|放一首|点一首|来一首|放首|给我来|搜索|搜|的歌/;

// ── 收藏/红心意图正则 ──
const LIKED_RE = /收藏|红心|喜欢的|喜欢听|常听|最近听|之前听|很久之前|老歌|经典/;

// ── 风格推荐正则 ──
const GENRE_RE = /推荐.*(rap|嘻哈|说唱|摇滚|民谣|电子|古典|爵士|r&b|流行|古风|国风|轻音乐|纯音乐|hiphop|hip-hop|indie|lofi|lo-fi|华语|粤语|日语|韩语|英语|欧美|民歌|戏曲|蓝调|blues|jazz|country|folk|edm|metal|punk|soul|funk)/i;

// ── 知识意图正则 ──
const KNOWLEDGE_RE = /故事|介绍|歌词|评论|热评|谁唱|讲讲|说说|百科|背景/;

// ── 个性化歌单正则 ──
const PLAYLIST_RE = /歌单|适合.*(学习|工作|睡觉|运动|跑步|瑜伽|冥想|开车|通勤)|生成.*歌单/;

// ── 竞争式推荐正则 ──
const COMPETITIVE_RE = /推荐几首|推荐一些|来几首|随便来|给我推荐|选几首|挑几首/;

/**
 * 分类用户消息
 *
 * @param {string} message - 用户消息
 * @returns {{ route: string, params: object }}
 *
 * route:
 *   - 'search'   → 预搜索短路
 *   - 'genre'    → 风格预搜索短路
 *   - 'compound' → 复合请求编排
 *   - 'playlist' → 个性化歌单编排
 *   - 'competitive' → 竞争式推荐编排
 *   - 'chat'     → 普通对话
 */
function classify(message) {
  // 1. 收藏/红心歌曲（最高优先级——比搜索更具体）
  const hasLiked = LIKED_RE.test(message);
  const hasPlayIntent = /播放|来首|放首|点首|推荐|来几首|来点|放点|想听/.test(message);
  if (hasLiked && hasPlayIntent) {
    let timeRange = 'all';
    if (/很久之前|早期|最早|最初/.test(message)) timeRange = 'oldest';
    else if (/最近|最新|刚/.test(message)) timeRange = 'newest';
    return { route: 'liked', params: { timeRange } };
  }

  // 2. 搜索意图
  if (SEARCH_RE.test(message)) {
    const keywords = message
      .replace(/播放|来一首|想听|来首|放一首|放首|给我来|点一首|点首|推荐|搜索|搜|的歌|歌|音乐|的|吧|吗|呢|啊/g, '')
      .trim();
    return { route: 'search', params: { keywords } };
  }

  // 3. 风格推荐
  const genreMatch = message.match(
    /(?:推荐|来点|来几首|放点|想听|来首)\s*(?:一些|一点|几首)?\s*(rap|嘻哈|说唱|摇滚|民谣|电子|古典|爵士|r&b|流行|古风|国风|轻音乐|纯音乐|hiphop|hip-hop|indie|lofi|lo-fi|华语|粤语|日语|韩语|英语|欧美|民歌|戏曲|蓝调|blues|jazz|country|folk|edm|metal|punk|soul|funk)/i
  );
  if (genreMatch) {
    return { route: 'genre', params: { genre: genreMatch[1] } };
  }

  // 4. 个性化歌单
  if (PLAYLIST_RE.test(message)) {
    return { route: 'complex', params: { scenario: 'playlist' } };
  }

  // 4. 复合请求（搜索 + 知识）
  const hasSearch = /推荐|来点|来几首|想听/.test(message);
  const hasKnowledge = KNOWLEDGE_RE.test(message);
  if (hasSearch && hasKnowledge) {
    return { route: 'complex', params: { scenario: 'compound' } };
  }

  // 5. 竞争式推荐
  if (COMPETITIVE_RE.test(message)) {
    return { route: 'complex', params: { scenario: 'competitive' } };
  }

  // 6. 普通对话
  return { route: 'chat', params: {} };
}

module.exports = { classify };
