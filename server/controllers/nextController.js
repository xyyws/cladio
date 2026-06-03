/**
 * GET /api/next — 中枢控制路由（单曲 + 智能时机）
 *
 * 流程：
 *   Step 0: 从弹药库选 1 首歌
 *   Step 1: 并行采集素材（歌词带时间戳 + 热评 + 歌手百科）
 *   Step 2: 分析歌词时间轴，找 ≥15s 的间隙
 *   Step 3: 有间隙 → LLM 生成介绍 → TTS 合成
 *   Step 4: 返回 { say, djAudio, djTiming, playlist }
 *
 * djTiming:
 *   { mode: "intro",     offset: 0 }          → 前奏 ≥15s，歌曲开始时播放 DJ
 *   { mode: "interlude", offset: <秒数> }     → 间奏/尾奏有间隙，歌曲播到该秒时播放 DJ
 *   { mode: "none" }                          → 无合适间隙，不播放 DJ
 */
const netease = require('../services/netease');
const { askBrainSimple } = require('../services/claude');
const { getPlayableTracks } = require('../services/audioService');
const { buildSongPool } = require('../services/recommendEngine');
const { generateSpeech } = require('../services/tts');
const { getTodayPlayedIds, logPlay, logAI } = require('../services/stateDB');
const { getEnvironmentSnapshot } = require('../services/context');

const LLM_TIMEOUT_MS = 30000;
const OVERALL_TIMEOUT_MS = 60000;
const MIN_GAP_SECONDS = 15;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT: ${label} 超时 (${ms}ms)`)), ms)
    ),
  ]);
}

// ── 路由处理 ──

async function getNext(_req, res, next) {
  const startTime = Date.now();
  try {
    const result = await withTimeout(executeRadioCycle(), OVERALL_TIMEOUT_MS, '整体接口');
    console.log(`[Next] 完成，耗时 ${Date.now() - startTime}ms`);
    res.json(result);
  } catch (err) {
    console.error(`[Next] 失败 (${Date.now() - startTime}ms):`, err.message);
    const code = err.message?.startsWith('TIMEOUT') ? 504 : 500;
    res.status(code).json({ status: code, error: { message: err.message } });
  }
}

// ── 歌词时间轴间隙分析 ──

function analyzeGaps(timestamps, songDurationMs) {
  if (!timestamps || timestamps.length === 0) {
    // 无歌词（纯音乐）→ 整首都是前奏
    return { mode: 'intro', offset: 0 };
  }

  const firstVocal = timestamps[0];

  // 前奏 ≥ 15s → 歌曲开始时播放 DJ
  if (firstVocal >= MIN_GAP_SECONDS) {
    return { mode: 'intro', offset: 0 };
  }

  // 扫描间奏：找相邻歌词之间的间隙 ≥ 15s（跳过前 10 秒，避免把前奏误判为间奏）
  for (let i = 0; i < timestamps.length - 1; i++) {
    const gap = timestamps[i + 1] - timestamps[i];
    if (gap >= MIN_GAP_SECONDS && timestamps[i] >= 10) {
      return { mode: 'interlude', offset: timestamps[i] };
    }
  }

  // 尾奏：最后一句歌词到歌曲结尾
  if (songDurationMs > 0) {
    const songDurationSec = songDurationMs / 1000;
    const lastLyric = timestamps[timestamps.length - 1];
    const outroGap = songDurationSec - lastLyric;
    if (outroGap >= MIN_GAP_SECONDS) {
      return { mode: 'interlude', offset: lastLyric };
    }
  }

  // 无合适间隙
  return { mode: 'none' };
}

// ── 核心编排 ──

async function executeRadioCycle() {
  // ── Step 0: 选一首歌 ──
  const todayPlayed = getTodayPlayedIds();
  const env = await getEnvironmentSnapshot().catch(() => ({}));

  let songPool = [];
  try {
    songPool = await buildSongPool({
      weather: env.weather === '雨天' ? 'rain' : env.weather === '晴' ? 'sunny' : 'cloudy',
      dayPhase: env.dayPhase,
    }, 10, todayPlayed);
  } catch (err) {
    console.warn('[Next] 选歌池构建失败:', err.message);
  }

  // ── Step 1: 选一首可播放的歌 ──
  let songId = null;
  let preloadedTrack = null;

  for (const candidate of songPool) {
    const tracks = await getPlayableTracks([candidate]).catch(() => []);
    if (tracks.length > 0 && tracks[0].playable) {
      songId = candidate;
      preloadedTrack = tracks[0];
      break;
    }
  }
  if (!songId) songId = songPool[0] || '186016';

  // ── Step 2: 并行采集素材 ──
  const [detail, lyrics, comments, artistWiki] = await Promise.all([
    netease.getSongDetail(songId).catch(() => null),
    netease.getLyrics(songId).catch(() => ({ lyric: '', timestamps: [] })),
    netease.getHotComments(songId, 3).catch(() => []),
    netease.getSongDetail(songId)
      .then(d => d?.artistId ? netease.getArtistDesc(d.artistId) : null)
      .catch(() => null),
  ]);

  // ── Step 2: 间隙分析 ──
  const songDurationMs = detail?.duration || 0;
  const djTiming = analyzeGaps(lyrics.timestamps, songDurationMs);

  console.log(`[Next] 歌曲: ${detail?.name}, 前奏: ${lyrics.timestamps?.[0]?.toFixed(1) || '?'}s, 时机: ${djTiming.mode}${djTiming.mode === 'interlude' ? ` @${djTiming.offset.toFixed(1)}s` : ''}`);

  // ── Step 3: 有间隙才生成介绍 + TTS ──
  let say = null;
  let djAudio = null;

  if (djTiming.mode !== 'none') {
    // LLM 生成介绍
    const introPrompt = buildIntroPrompt(songId, detail, lyrics, comments, artistWiki, env, djTiming);
    try {
      const response = await withTimeout(askBrainSimple(introPrompt), LLM_TIMEOUT_MS, 'LLM 介绍');
      say = response.say;
    } catch (err) {
      console.warn('[Next] LLM 生成失败，降级:', err.message);
      say = buildFallbackIntro(detail);
    }

    // TTS 合成
    try {
      const ttsResult = await generateSpeech(say);
      djAudio = ttsResult.url;
    } catch (err) {
      console.warn('[Next] TTS 失败:', err.message);
      djAudio = null;
    }
  } else {
    console.log('[Next] 无合适间隙，跳过 DJ 介绍');
  }

  // ── Step 4: 构建播放列表（复用 Step 1 的结果） ──
  logPlay(songId);
  if (say) logAI({ say, weather: env.weather, temperature: env.temperature, dayPhase: env.dayPhase });

  const track = preloadedTrack || { songId, audioUrl: null, playable: false };
  const playlist = [{
    songId: track.songId,
    title: track.title || detail?.name || null,
    artist: track.artist || detail?.artists || null,
    coverUrl: track.coverUrl || detail?.cover || null,
    audioUrl: track.audioUrl || null,
    playable: track.playable !== undefined ? track.playable : !!track.audioUrl,
  }];

  return {
    status: 200,
    data: { say, djAudio, djTiming, playlist, segue: 'crossfade:2000', env },
  };
}

// ── Prompt ──

function buildIntroPrompt(songId, detail, lyrics, comments, artistWiki, env, djTiming) {
  const songName = detail?.name || '未知歌曲';
  const artist = detail?.artists || '未知歌手';
  const album = detail?.album || '';

  const lyricSnippet = lyrics?.lyric
    ? lyrics.lyric.split('\n').filter(l => l.trim()).slice(0, 8).join('\n')
    : '（无歌词，纯音乐）';

  const commentLines = (comments || []).map(c =>
    `- 「${c.content}」(${c.user}, ${c.likedCount}赞)`
  ).join('\n') || '（无热评）';

  const artistBrief = artistWiki?.briefDesc
    ? artistWiki.briefDesc.slice(0, 200)
    : '';

  const timingHint = djTiming.mode === 'intro'
    ? '前奏较长，你可以在前奏中从容说完。'
    : `歌曲播到第 ${Math.round(djTiming.offset)} 秒后有一段间隙，你可以在间隙中说。`;

  return `你是 Claudio，一位有品味的 AI 电台 DJ。

当前环境：${env.weather || '未知'} ${env.temperature || ''}，${env.dayPhase || '未知'}

即将播放的歌曲：
- 歌名：${songName}
- 歌手：${artist}
- 专辑：${album}
${artistBrief ? `- 歌手简介：${artistBrief}` : ''}

歌词片段：
${lyricSnippet}

网易云热评：
${commentLines}

${timingHint}

【任务】为这首歌写一段简短的 DJ 介绍，1-2 句话即可。
要求：
- 自然口语化，像朋友随口聊起这首歌
- 可以引用歌词、热评、歌手故事，但要融入你的语言
- 不要提到"歌词""评论"等元信息词
- 控制在 10 秒以内说完

你必须严格返回以下 JSON 格式，直接以 { 开头：
{"say":"你的介绍文字"}`;
}

// ── 降级 ──

function buildFallbackIntro(detail) {
  if (!detail) return '来，听歌。';
  return `接下来这首歌是${detail.artists}的《${detail.name}》，一起听听看。`;
}

module.exports = { getNext };
