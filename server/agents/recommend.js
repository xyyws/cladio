/**
 * recommend.js — 推荐 Agent
 *
 * 负责歌曲推荐，支持多种策略：
 *   - arsenal: 弹药库（红心歌单）随机推荐
 *   - atmosphere: 基于天气+时段的氛围推荐
 *   - trending: 热门推荐
 *   - profile: 基于用户画像推荐
 *   - focus: 专注模式推荐（学习/工作）
 *
 * 复用: playlistService.js + recommendEngine.js + netease.js
 */

const netease = require('../services/netease');
const { loadArsenal, pickRandom, searchArsenal } = require('../services/playlistService');
const { TaskType, RecommendStrategy } = require('./types');

const AGENT_NAME = 'RecommendAgent';

// ── 氛围关键词映射 ──

const ATMOSPHERE_MAP = {
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
};

const FOCUS_KEYWORDS = ['轻音乐', '纯音乐', '钢琴', '学习', '专注', '白噪音', '氛围'];

// ── 推荐策略实现 ──

/**
 * 弹药库推荐（红心歌单随机）
 */
async function recommendByArsenal(keywords = '', count = 5, excludeIds = []) {
  if (keywords) {
    const matches = await searchArsenal(keywords, count);
    if (matches.length > 0) {
      return formatResults(matches);
    }
  }
  const songs = await pickRandom(count, excludeIds);
  return formatResults(songs);
}

/**
 * 氛围推荐（天气+时段 → 关键词搜索）
 */
async function recommendByAtmosphere(context = {}, count = 5) {
  const { weather, dayPhase } = context;
  const keywords = [];

  if (weather && ATMOSPHERE_MAP.weather[weather]) {
    keywords.push(...ATMOSPHERE_MAP.weather[weather]);
  }
  if (dayPhase && ATMOSPHERE_MAP.dayPhase[dayPhase]) {
    keywords.push(...ATMOSPHERE_MAP.dayPhase[dayPhase]);
  }

  if (keywords.length === 0) {
    keywords.push('轻快', '流行');
  }

  // 从弹药库和网易云全局各搜一轮
  const results = [];
  for (const kw of keywords.slice(0, 2)) {
    try {
      const arsenalHits = await searchArsenal(kw, 3);
      results.push(...arsenalHits);
    } catch (_) {}
    try {
      const globalHits = await netease.search(kw, { limit: 3 });
      results.push(...globalHits);
    } catch (_) {}
  }

  // 去重+打乱
  const seen = new Set();
  const unique = results.filter(s => {
    const id = String(s.id || s.songId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return shuffle(unique).slice(0, count).map(s => ({
    id: String(s.id || s.songId),
    name: s.name || s.title || '',
    artists: s.artists || s.artist || '',
  }));
}

/**
 * 基于用户画像推荐
 */
async function recommendByProfile(userProfile = {}, count = 5) {
  const keywords = [];

  if (userProfile.favorite_genres?.length) {
    keywords.push(...userProfile.favorite_genres.slice(0, 2));
  }
  if (userProfile.favorite_artists?.length) {
    keywords.push(userProfile.favorite_artists[0]);
  }
  if (userProfile.mood) {
    keywords.push(userProfile.mood);
  }

  if (keywords.length === 0) {
    return recommendByArsenal('', count);
  }

  const results = [];
  for (const kw of keywords.slice(0, 3)) {
    try {
      const songs = await netease.search(kw, { limit: 3 });
      results.push(...songs);
    } catch (_) {}
    try {
      const arsenalHits = await searchArsenal(kw, 2);
      results.push(...arsenalHits);
    } catch (_) {}
  }

  const seen = new Set();
  const unique = results.filter(s => {
    const id = String(s.id || s.songId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return shuffle(unique).slice(0, count).map(s => ({
    id: String(s.id || s.songId),
    name: s.name || s.title || '',
    artists: s.artists || s.artist || '',
  }));
}

/**
 * 专注模式推荐（学习/工作）
 */
async function recommendByFocus(count = 5) {
  const results = [];
  for (const kw of FOCUS_KEYWORDS.slice(0, 3)) {
    try {
      const songs = await netease.search(kw, { limit: 3 });
      results.push(...songs);
    } catch (_) {}
  }

  const seen = new Set();
  const unique = results.filter(s => {
    const id = String(s.id || s.songId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return shuffle(unique).slice(0, count).map(s => ({
    id: String(s.id || s.songId),
    name: s.name || s.title || '',
    artists: s.artists || s.artist || '',
  }));
}

/**
 * 竞争式推荐（多策略并行，返回所有候选）
 */
async function recommendCompetitive(context = {}, userProfile = {}, count = 5) {
  const strategies = await Promise.allSettled([
    recommendByArsenal('', count),
    recommendByAtmosphere(context, count),
    recommendByProfile(userProfile, count),
  ]);

  return {
    arsenal: strategies[0].status === 'fulfilled' ? strategies[0].value : [],
    atmosphere: strategies[1].status === 'fulfilled' ? strategies[1].value : [],
    profile: strategies[2].status === 'fulfilled' ? strategies[2].value : [],
  };
}

// ── Agent 接口 ──

function formatResults(songs) {
  return (songs || []).map(s => ({
    id: String(s.id || s.songId),
    name: s.name || s.title || '',
    artists: s.artists || s.artist || '',
  }));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Agent 定义
 */
const RecommendAgent = {
  name: AGENT_NAME,
  capabilities: ['RECOMMEND'],

  canHandle(taskType) {
    return taskType === TaskType.RECOMMEND;
  },

  async execute(taskType, params) {
    const { strategy, keywords, count = 5, excludeIds = [], _deps = {}, _shared = {} } = params;

    // 从依赖中获取用户画像和上下文
    const userProfile = _deps[_shared.memoryTaskId] || _shared.userProfile || {};
    const context = _deps[_shared.contextTaskId] || _shared.context || {};

    switch (strategy) {
      case RecommendStrategy.ARSENAL:
        return recommendByArsenal(keywords, count, excludeIds);

      case RecommendStrategy.ATMOSPHERE:
        return recommendByAtmosphere(context, count);

      case RecommendStrategy.PROFILE:
        return recommendByProfile(userProfile, count);

      case RecommendStrategy.FOCUS:
        return recommendByFocus(count);

      case RecommendStrategy.TRENDING:
        // 热门推荐：用"热门"关键词搜索
        try {
          const songs = await netease.search('热门', { limit: count });
          return formatResults(songs);
        } catch (_) {
          return recommendByArsenal('', count, excludeIds);
        }

      default:
        // 默认：竞争式推荐
        return recommendCompetitive(context, userProfile, count);
    }
  },
};

module.exports = RecommendAgent;
