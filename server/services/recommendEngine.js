/**
 * 模块二：AI 主播选歌池（推荐引擎）
 *
 * 策略：
 *   1. 从私有弹药库（网易云红心歌单）随机取"安全牌"
 *   2. 结合天气/时段生成关键词，从弹药库中搜索匹配
 *   3. 用氛围关键词从网易云全局搜索注入新鲜感
 *   4. 返回混合后的候选歌曲 ID 列表
 */
const netease = require('./netease');
const { loadArsenal, pickRandom, searchArsenal } = require('./playlistService');

// ── 氛围关键词映射 ──

const ATMOSPHERE_KEYWORDS = {
  weather: {
    rain: ['雨天', '治愈', '温暖', '安静'],
    sunny: ['阳光', '轻快', '元气', '清新'],
    cloudy: ['慵懒', '氛围', '民谣'],
    snow: ['冬天', '温暖', '钢琴', '纯音乐'],
  },
  dayPhase: {
    morning: ['早安', '轻快', '元气'],
    afternoon: ['午后', '放松', '轻音乐'],
    evening: ['夜晚', '氛围', '浪漫'],
    night: ['助眠', '纯音乐', '安静', '钢琴'],
  },
  mood: {
    work: ['专注', '轻音乐', '纯音乐', '学习'],
    relax: ['放松', '民谣', '治愈'],
    workout: ['运动', '节奏', '电子'],
    commute: ['通勤', '流行', '轻快'],
  },
};

function getAtmosphereKeywords(weather, dayPhase, mood) {
  const keywords = [];

  if (weather && ATMOSPHERE_KEYWORDS.weather[weather]) {
    keywords.push(...ATMOSPHERE_KEYWORDS.weather[weather]);
  }
  if (dayPhase && ATMOSPHERE_KEYWORDS.dayPhase[dayPhase]) {
    keywords.push(...ATMOSPHERE_KEYWORDS.dayPhase[dayPhase]);
  }
  if (mood && ATMOSPHERE_KEYWORDS.mood[mood]) {
    keywords.push(...ATMOSPHERE_KEYWORDS.mood[mood]);
  }

  return [...new Set(keywords)].slice(0, 3);
}

// ── 选歌主逻辑 ──

/**
 * 构建候选歌曲池
 *
 * @param {object} context - { weather, dayPhase, mood }
 * @param {number} count - 候选数量
 * @param {string[]} excludeIds - 排除的歌曲 ID（今日已播）
 * @returns {Promise<string[]>} 候选歌曲 ID 列表
 */
async function buildSongPool(context = {}, count = 10, excludeIds = []) {
  const { weather, dayPhase, mood } = context;
  const keywords = getAtmosphereKeywords(weather, dayPhase, mood);

  // 1. 从弹药库随机取"安全牌"（用户红心歌单）
  const safePool = await pickRandom(Math.min(8, count), excludeIds);
  const safeIds = safePool.map(t => String(t.id));

  // 2. 从弹药库中按氛围关键词搜索
  const arsenalMatches = [];
  for (const kw of keywords.slice(0, 2)) {
    try {
      const matches = await searchArsenal(kw, 5);
      arsenalMatches.push(...matches.map(t => String(t.id)));
    } catch (_) {}
  }

  // 3. 用多个氛围关键词从网易云全局搜索注入新鲜感
  const freshPool = [];
  for (const kw of keywords.slice(0, 2)) {
    try {
      const songs = await netease.search(kw, { limit: 5 });
      freshPool.push(...songs.map(s => String(s.id)));
    } catch (err) {
      console.warn(`[Recommend] 全局搜索 "${kw}" 失败:`, err.message);
    }
  }

  // 4. 合并去重，排除已播歌曲，打乱顺序
  const excludeSet = new Set(excludeIds);
  const combined = [...new Set([...safeIds, ...arsenalMatches, ...freshPool])]
    .filter(id => !excludeSet.has(id));

  console.log(`[Recommend] 候选池: ${combined.length} 首 (安全牌${safeIds.length} + 弹药库${arsenalMatches.length} + 新鲜${freshPool.length})`);

  return shuffle(combined).slice(0, count);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { buildSongPool };
