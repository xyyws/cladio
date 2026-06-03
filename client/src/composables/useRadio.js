import { ref, reactive } from 'vue';
import { AudioEngine } from './AudioEngine.js';

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '');

// 强制 HTTPS（解决 Mixed Content）
function ensureHttps(url) {
  if (!url) return url;
  return url.replace(/^http:\/\//, 'https://');
}

/**
 * 电台控制器 — 轮询 /api/next，编排 AudioEngine 播放周期
 *
 * /api/next 返回格式:
 *   { status: 200, data: { djAudio, playlist, segue } }
 */

const POLL_AFTER_MUSIC_MS = 3000;
const POLL_IDLE_MS = 10000;

export function useRadio() {
  const engine = new AudioEngine();

  const state = reactive({
    status: 'idle',       // idle | loading | speaking | playing | error
    say: '',
    segue: '',
    djAudio: null,
    playlist: [],
    currentIndex: 0,      // 当前播放歌曲索引
    error: null,
    lastUpdated: null,
    env: null,            // 保存环境天气上下文
  });

  let pollTimer = null;
  let stopped = false;

  // ── 轮询 /api/next ──

  async function fetchNext() {
    state.status = 'loading';
    state.error = null;

    try {
      const res = await fetch(`${API_BASE}/api/next`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.data && json.data.env) {
        state.env = json.data.env;
      }
      return json.data; // 取 data 字段
    } catch (err) {
      console.error('[Radio] /api/next 失败:', err.message);
      state.status = 'error';
      state.error = err.message;
      return null;
    }
  }

  // ── 播放一个周期 ──

  async function playCycle(data) {
    if (!data || stopped) return;

    // 【关键防御】把没有链接的、不能播的歌直接踢出队列
    const playlist = (data.playlist || []).filter(
      song => song.playable === true && song.audioUrl !== null
    );

    // 如果没有可播放的歌，立刻重试
    if (playlist.length === 0) {
      console.warn('[Radio] 无可播放歌曲，重新获取...');
      schedulePoll(1000);
      return;
    }

    state.djAudio = data.djAudio;
    state.playlist = playlist;
    state.currentIndex = 0;
    state.segue = data.segue;
    state.lastUpdated = Date.now();

    console.log(`[Radio] 播放队列: ${playlist.length}/${(data.playlist || []).length} 首可播放`);

    const firstTrack = playlist[0];
    const musicUrl = firstTrack
      ? ensureHttps(firstTrack.audioUrl.startsWith('http') ? firstTrack.audioUrl : `${API_BASE}${firstTrack.audioUrl}`)
      : null;

    const djUrl = data.djAudio
      ? (data.djAudio.startsWith('http') ? data.djAudio : `${API_BASE}${data.djAudio}`)
      : null;

    const djTiming = data.djTiming || { mode: djUrl ? 'intro' : 'none' };

    // 预加载
    const secondTrack = playlist[1];
    if (secondTrack) {
      const prefetchUrl = ensureHttps(secondTrack.audioUrl.startsWith('http')
        ? secondTrack.audioUrl
        : `${API_BASE}${secondTrack.audioUrl}`);
      engine.prefetchAudio(prefetchUrl);
    }

    let played = false;

    try {
      if (djTiming.mode === 'intro' && djUrl) {
        // ── 模式 1：前奏 ≥15s，歌曲和 DJ 并行播放 ──
        state.status = 'speaking';
        played = true;
        // 同时启动歌曲和 DJ，DJ 结束后音乐自动恢复
        await engine.playWithDjOverlay(musicUrl, djUrl, data.segue);

      } else if (djTiming.mode === 'interlude' && djUrl) {
        // ── 模式 2：间奏/尾奏间隙，歌曲播到指定秒数时叠加 DJ ──
        state.status = 'playing';
        played = true;

        // 开始播歌，同时监听时间
        await engine._playMusicWithCallback(musicUrl, 0, (currentTime) => {
          // 到达间隙起点时播放 DJ（只触发一次）
          if (currentTime >= djTiming.offset && !engine._interludeDjPlayed) {
            engine._interludeDjPlayed = true;
            state.status = 'speaking';
            engine._playDj(djUrl).then(() => {
              state.status = 'playing';
            }).catch(() => {});
          }
        });

      } else {
        // ── 模式 3：无合适间隙，直接播歌 ──
        if (musicUrl) {
          state.status = 'playing';
          await engine._playMusic(musicUrl, 0);
          played = true;
        }
      }
    } catch (err) {
      console.warn('[Radio] 播放周期异常:', err.message);
    }

    if (stopped) return;
    engine._interludeDjPlayed = false;
    state.status = 'idle';

    const delay = played ? POLL_AFTER_MUSIC_MS : POLL_IDLE_MS;
    schedulePoll(delay);
  }

  // ── 轮询调度 ──

  function schedulePoll(delay = POLL_IDLE_MS) {
    clearTimeout(pollTimer);
    if (stopped) return;

    pollTimer = setTimeout(async () => {
      if (stopped) return;
      const data = await fetchNext();
      if (data) {
        await playCycle(data);
      } else {
        schedulePoll(POLL_IDLE_MS);
      }
    }, delay);
  }

  // ── 公开方法 ──

  async function start() {
    stopped = false;
    clearTimeout(pollTimer); // 清除轮询，防止重复播放
    engine.ensureContext(); // 用户手势触发
    console.log('[Radio] 启动电台...');

    const data = await fetchNext();
    if (data) {
      await playCycle(data);
    } else {
      schedulePoll(POLL_IDLE_MS);
    }
  }

  async function startFromArsenal() {
    stopped = false;
    clearTimeout(pollTimer); // 清除轮询，防止重复播放
    engine.ensureContext();
    state.status = 'loading';
    console.log('[Radio] 从弹药库播放...');

    try {
      const res = await fetch(`${API_BASE}/api/arsenal/play?limit=20`);
      const json = await res.json();

      if (json.data?.playlist?.length > 0) {
        const playlist = json.data.playlist.filter(t => t.playable && t.audioUrl);

        if (playlist.length === 0) {
          console.warn('[Radio] 弹药库无可播放歌曲');
          state.status = 'idle';
          return;
        }

        state.playlist = playlist;
        state.currentIndex = 0;
        state.djAudio = null;
        state.lastUpdated = Date.now();
        _currentPlaylistIndex = 0;

        console.log(`[Radio] 弹药库加载 ${playlist.length} 首歌`);
        await playTrackByIndex(0);
      } else {
        console.warn('[Radio] 弹药库为空');
        state.status = 'idle';
      }
    } catch (err) {
      console.error('[Radio] 弹药库加载失败:', err.message);
      state.status = 'error';
      state.error = err.message;
    }
  }

  function stop() {
    stopped = true;
    clearTimeout(pollTimer);
    engine.destroy();
    state.status = 'idle';
    console.log('[Radio] 电台已停止');
  }

  function toggle() {
    if (state.status === 'idle' || state.status === 'error') {
      // 有播放列表时恢复播放，没有时不自动加载
      if (state.playlist.length > 0 && state.currentIndex < state.playlist.length) {
        _isStartingTrack = false;
        engine.ensureContext();
        playTrackByIndex(state.currentIndex);
      }
    } else {
      stop();
    }
  }

  // ── 播放列表内导航 ──
  let _currentPlaylistIndex = 0;
  let _isStartingTrack = false; // 播放锁，防止多首同时播放
  let _playSessionId = 0; // 播放会话 ID，防止旧回调干扰

  function next() {
    _isStartingTrack = false;
    clearTimeout(pollTimer);
    engine._stopDj();
    engine._stopMusic();

    if (state.playlist.length > 0) {
      // 循环播放：到末尾回到第一首
      state.currentIndex = (state.currentIndex + 1) % state.playlist.length;
      _currentPlaylistIndex = state.currentIndex;
      playTrackByIndex(_currentPlaylistIndex);
      return;
    }

    // 无播放列表，获取新歌
    state.currentIndex = 0;
    _currentPlaylistIndex = 0;
    state.status = 'idle';
    fetchNext().then(data => {
      if (data) playCycle(data);
    });
  }

  function prev() {
    _isStartingTrack = false;
    clearTimeout(pollTimer);
    engine._stopDj();
    engine._stopMusic();

    if (state.playlist.length > 0) {
      // 循环播放：到开头回到最后一首
      state.currentIndex = (state.currentIndex - 1 + state.playlist.length) % state.playlist.length;
      _currentPlaylistIndex = state.currentIndex;
      playTrackByIndex(_currentPlaylistIndex);
      return;
    }

    _currentPlaylistIndex = 0;
    state.status = 'idle';
    fetchNext().then(data => {
      if (data) playCycle(data);
    });
  }

  function playTrackByIndex(index) {
    const track = state.playlist[index];
    if (!track?.audioUrl) return;

    // 更新当前索引
    state.currentIndex = index;
    _currentPlaylistIndex = index;

    // 递增会话 ID，旧回调会自动失效
    const sessionId = ++_playSessionId;
    _isStartingTrack = true;
    engine._stopMusic();

    const musicUrl = ensureHttps(track.audioUrl.startsWith('http')
      ? track.audioUrl
      : `${API_BASE}${track.audioUrl}`);

    state.status = 'playing';
    engine._playMusic(musicUrl, 0).then(() => {
      if (sessionId !== _playSessionId) return;
      _isStartingTrack = false;
      if (!stopped) next();
    }).catch(err => {
      if (sessionId !== _playSessionId) return;
      _isStartingTrack = false;
      console.warn('[Radio] 播放失败:', err.message);
      if (!stopped) next();
    });
  }

  function playTrack(track) {
    if (!track?.audioUrl) return;

    _isStartingTrack = false;
    clearTimeout(pollTimer);
    engine._stopDj();
    engine._stopMusic();

    let idx = state.playlist.findIndex(t => t.songId === track.songId);

    // 如果不在列表中，加入列表
    if (idx < 0) {
      state.playlist.push(track);
      idx = state.playlist.length - 1;
    }

    state.currentIndex = idx;
    _currentPlaylistIndex = idx;
    playTrackByIndex(idx);
  }

  function setVolume(val) {
    engine.setMasterVolume(val / 100);
  }

  /**
   * 播放聊天推荐的歌曲
   * @param {object} chatData - { reply, songs, tracks, reason }
   */
  async function playChatSongs(chatData) {
    console.log('[Radio] playChatSongs called, tracks:', chatData?.tracks?.length);
    if (!chatData?.tracks?.length) return;

    // 过滤可播放的歌曲
    const playlist = chatData.tracks.filter(
      song => song.playable === true && song.audioUrl !== null
    );

    console.log('[Radio] playable tracks:', playlist.length);

    if (playlist.length === 0) {
      console.warn('[Radio] 聊天推荐的歌曲全部不可播放');
      return;
    }

    // 停止当前播放
    clearTimeout(pollTimer);
    engine._stopMusic();

    state.playlist = playlist;
    state.currentIndex = 0;
    state.say = chatData.reply;
    state.segue = 'crossfade:2000';
    state.lastUpdated = Date.now();

    console.log(`[Radio] 聊天推荐: ${playlist.length} 首歌，队列已更新`);

    // 顺序播放所有推荐歌曲（循环播放）
    stopped = false;
    let playIndex = 0;
    while (!stopped) {
      const track = playlist[playIndex % playlist.length];

      const musicUrl = ensureHttps(track.audioUrl.startsWith('http')
        ? track.audioUrl
        : `${API_BASE}${track.audioUrl}`);

      state.currentIndex = playIndex % playlist.length;
      state.status = 'playing';

      try {
        await engine._playMusic(musicUrl, 0);
        await new Promise(resolve => {
          const check = setInterval(() => {
            if (!engine.isPlaying || stopped) {
              clearInterval(check);
              resolve();
            }
          }, 500);
        });
      } catch (err) {
        console.warn(`[Radio] 歌曲 ${track.songId} 播放失败:`, err.message);
      }

      playIndex++;
    }

    // 播放结束（用户点了停止），不启动电台轮播
    if (!stopped) {
      state.status = 'idle';
    }
  }

  return {
    state,
    engine,
    start,
    startFromArsenal,
    stop,
    toggle,
    prev,
    next,
    setVolume,
    playChatSongs,
    playTrack,
  };
}
