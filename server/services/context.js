/**
 * Context.js — 上下文组装器
 *
 * buildDJPrompt() 动态组装：
 *   1. 系统设定（DJ Claudio 人设）
 *   2. 真实环境感知（OpenWeather 天气 + 时间）
 *   3. 播放历史（StateDB 最近播放记录）
 *   4. 歌曲故事（选中歌曲的详情 + 网友热评）
 *   5. 输出约束（强制 JSON 格式）
 */
const { senseEnvironment } = require('./environment');
const { getRecentPlays, getTodayPlayedIds } = require('./stateDB');
const { getCommentsForPlaylist } = require('./commentService');
const netease = require('./netease');

// ── 系统设定 ──

const SYSTEM_PERSONA = `你是一个有品味的深夜电台 DJ Claudio。
你的任务是根据当前环境和用户状态，挑选 2 首歌，并写一段有温度的串场词。

你的风格：
- 温暖、文艺、有洞察力，像一个老朋友在深夜陪你聊天
- 你不会机械地播报歌名，而是用自然的语言引入音乐
- 你会讲歌曲背后的故事：创作背景、歌手经历、专辑年代、网友神评论
- 前奏响起时，你会用一两句话点出这首歌的灵魂
- 曲终时，你会用一句有余韵的话过渡到下一首
- 偶尔引用网易云热评，但要自然融入你的串场词，不要生硬引用`;

// ── 输出约束 ──

const OUTPUT_FORMAT = `你必须严格返回以下 JSON 格式，不允许包含任何 Markdown 标记、代码块、解释性文字或多余的换行：
{
  "say": "串场词，自然口语化，2-4 句话，要有温度和画面感",
  "play": ["歌曲ID_1", "歌曲ID_2"],
  "reason": "你选择这些歌并这么说的内在逻辑",
  "segue": "音频过渡方式建议，如 crossfade:3000、fadeout:5000、cut"
}`;

// ── 组装器 ──

/**
 * 为自动电台构建带歌曲故事的 DJ prompt
 *
 * @param {string[]} songIds - 选中的歌曲 ID 列表
 * @returns {Promise<string>} 完整 prompt
 */
async function buildDJPrompt(songIds) {
  // 并行获取：环境 + 播放历史 + 歌曲详情 + 热评
  const [env, recentPlays, todayPlayedIds, songDetails, commentsMap] = await Promise.all([
    senseEnvironment().catch(() => ({
      weather: { condition: '未知', temp: 20, mood: '平静', keywords: [] },
      calendar: { timeStr: new Date().toLocaleString('zh-CN'), dayPhase: 'night', status: '未知', label: '深夜' },
    })),
    Promise.resolve().then(() => getRecentPlays(10)).catch(() => []),
    Promise.resolve().then(() => getTodayPlayedIds()).catch(() => []),
    // 获取歌曲详情
    Promise.all(songIds.map(id =>
      netease.getSongDetail(id).catch(() => null)
    )).then(results => results.filter(Boolean)),
    // 获取热评
    getCommentsForPlaylist(songIds, 1).catch(() => new Map()),
  ]);

  const { weather, calendar } = env;

  // ── 环境段 ──
  const envSection = [
    `## 当前环境`,
    `- 时间: ${calendar.timeStr}（${calendar.label}）`,
    `- 天气: ${weather.condition}，${weather.temp}°C（体感${weather.feelsLike}°C），湿度${weather.humidity}%`,
    `- 氛围关键词: ${weather.keywords.join('、')}`,
  ].join('\n');

  // ── 歌曲信息段 ──
  const songLines = songDetails.map((s, i) => {
    const comments = commentsMap.get(String(s.id)) || [];
    const commentStr = comments.length > 0
      ? `\n  网友热评: 「${comments[0].content}」—— ${comments[0].user}`
      : '';
    return `${i + 1}. [ID:${s.id}] 「${s.name}」— ${s.artists}（专辑《${s.album}》，热度 ${s.pop}）${commentStr}`;
  });

  const songSection = [
    `## 即将播放的歌曲`,
    ...songLines,
    '',
    `请为这两首歌写一段串场词。要求：`,
    `- 自然引入第一首歌，可以讲它的创作故事、歌手背景、或引用网友评论`,
    `- 两首歌之间的过渡要流畅，像一个真正的 DJ 在说话`,
    `- 总长度 3-5 句话，不要太长`,
    `- 不要提到"第一首""第二首"这样的序号，用自然的方式连接`,
    `- play 字段必须使用方括号中的歌曲 ID（如 "347230"），不要使用歌名`,
  ].join('\n');

  // ── 播放历史段 ──
  const recentPlayedText = recentPlays.length > 0
    ? recentPlays.map(p => `"${p.title || p.songId}"-${p.artist || '未知'}`).join('、')
    : '（暂无播放记录）';

  const musicSection = [
    `## 音乐上下文`,
    `- 最近播放: ${recentPlayedText}`,
    `- 避免重复推荐今天已播过的歌曲`,
  ].join('\n');

  // ── 拼接 ──
  return [
    SYSTEM_PERSONA,
    '',
    '---',
    '',
    envSection,
    '',
    songSection,
    '',
    musicSection,
    '',
    '---',
    '',
    OUTPUT_FORMAT,
  ].join('\n');
}

/**
 * 获取当前环境快照（供 AI 日志记录用）
 */
async function getEnvironmentSnapshot() {
  try {
    const env = await senseEnvironment();
    return {
      weather: env.weather.condition,
      temperature: `${env.weather.temp}°C`,
      dayPhase: env.calendar.dayPhase,
    };
  } catch (_) {
    return { weather: '未知', temperature: '未知', dayPhase: 'night' };
  }
}

module.exports = { buildDJPrompt, getEnvironmentSnapshot };
