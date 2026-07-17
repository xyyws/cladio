import { ref, reactive } from 'vue';
import { AudioEngine } from './AudioEngine.js';

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '');

// 强制 HTTPS（解决 Mixed Content）
function ensureHttps(url) {
  if (!url) return url;
  return url.replace(/^http:\/\//, 'https://');
}

// 解析音频 URL（自动处理相对/绝对路径 + HTTPS）
function resolveUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return ensureHttps(path);
  return `${API_BASE}${path}`;
}

/**
 * 电台控制器 — 状态机 + 统一播放控制
 *
 * 状态机：
 *   idle → loading → speaking | playing | error → idle | paused
 */

const POLL_AFTER_MUSIC_MS = 3000;
const POLL_IDLE_MS = 10000;
const MIN_PLAY_SECONDS = 10;
const MAX_CONSECUTIVE_FAILS = 3;

// ══════════════════════════════════════════════
// 轻量级状态机
// ══════════════════════════════════════════════

const VALID_TRANSITIONS = {
  idle:    ['loading', 'playing', 'speaking', 'error', 'paused'],
  loading: ['idle', 'playing', 'speaking', 'error'],
  speaking:['playing', 'idle', 'paused', 'error'],
  playing: ['idle', 'paused', 'error', 'speaking', 'playing'],
  paused:  ['playing', 'idle', 'loading'],
  error:   ['idle', 'loading', 'playing'],
};

function createStateMachine(initialState, onTransition) {
  let current = initialState;

  return {
    get current() { return current; },
    transition(to) {
      if (!VALID_TRANSITIONS[current]?.includes(to)) {
        console.warn(`[StateMachine] 非法转换: ${current} → ${to}，强制允许`);
      }
      const from = current;
      current = to;
      onTransition?.(from, to);
      return to;
    },
    can(to) {
      return VALID_TRANSITIONS[current]?.includes(to) ?? false;
    },
  };
}

// ══════════════════════════════════════════════
// useRadio Composable
// ══════════════════════════════════════════════

export function useRadio() {
  const engine = new AudioEngine();

  // ── 响应式状态 ──
  const state = reactive({
    status: 'idle',
    say: '',
    segue: '',
    djAudio: null,
    playlist: [],
    currentIndex: 0,
    error: null,
    lastUpdated: null,
    env: null,
    playbackMode: 'sequential',
    playbackModeLabel: '顺序',
    playbackModeIcon: 'sequential',
  });

  // ── 状态机 ──
  const fsm = createStateMachine('idle', (from, to) => {
    state.status = to;
    console.log(`[Radio] 状态: ${from} → ${to}`);
  });

  // ── 播放模式 ──
  // sequential: 顺序播放 | repeat-one: 单曲循环 | shuffle: 随机播放
  const PLAYBACK_MODES = ['sequential', 'repeat-one', 'shuffle']
  const MODE_LABELS = { sequential: '顺序', 'repeat-one': '单曲循环', 'shuffle': '随机' }
  const MODE_ICONS = { sequential: 'sequential', 'repeat-one': 'repeat-one', 'shuffle': 'shuffle' }
  let _playbackMode = 'sequential'

  function cyclePlayMode() {
    const idx = PLAYBACK_MODES.indexOf(_playbackMode)
    _playbackMode = PLAYBACK_MODES[(idx + 1) % PLAYBACK_MODES.length]
    state.playbackMode = _playbackMode
    state.playbackModeLabel = MODE_LABELS[_playbackMode]
    state.playbackModeIcon = MODE_ICONS[_playbackMode]
    console.log(`[Radio] 播放模式: ${MODE_LABELS[_playbackMode]}`)
  }

  function getPlayMode() { return _playbackMode }

  // ── 内部控制变量 ──
  let pollTimer = null;
  let stopped = false;
  let _failedCount = 0;
  let _playSessionId = 0;
  let _chatPlaySessionId = 0;
  let _cycleId = 0; // 播放周期 ID（递增，区分不同周期）

  // 防止 sessionId 溢出（安全阈值：2^53 的 1%）
  const SESSION_ID_MAX = Number.MAX_SAFE_INTEGER * 0.01;

  // ── 状态转换辅助 ──
  function setStatus(status) {
    fsm.transition(status);
  }

  // ══════════════════════════════════════════════
  // API 调用
  // ══════════════════════════════════════════════

  async function fetchNext() {
    setStatus('loading');
    state.error = null;

    try {
      const res = await fetch(`${API_BASE}/api/next`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.data?.env) state.env = json.data.env;
      return json.data;
    } catch (err) {
      console.error('[Radio] /api/next 失败:', err.message);
      setStatus('error');
      state.error = err.message;
      return null;
    }
  }

  // ══════════════════════════════════════════════
  // 播放周期
  // ══════════════════════════════════════════════

  async function playCycle(data) {
    if (!data || stopped) return;

    // 捕获当前周期 ID，用于检测是否被外部中断
    const myCycleId = _cycleId;

    const playlist = (data.playlist || []).filter(
      song => song.playable === true && song.audioUrl !== null
    );

    if (playlist.length === 0) {
      console.warn('[Radio] 无可播放歌曲，重新获取...');
      schedulePoll(1000);
      return;
    }

    state.djAudio = data.djAudio;
    state.say = data.say;
    state.playlist = playlist;
    state.currentIndex = 0;
    state.segue = data.segue;
    state.lastUpdated = Date.now();

    console.log(`[Radio] 播放队列: ${playlist.length}/${(data.playlist || []).length} 首可播放`);

    const firstTrack = playlist[0];
    const musicUrl = resolveUrl(firstTrack?.audioUrl);
    const djUrl = resolveUrl(data.djAudio);
    const djTiming = data.djTiming || { mode: djUrl ? 'intro' : 'none' };

    // 预加载下一首
    if (playlist[1]) {
      engine.prefetchAudio(resolveUrl(playlist[1].audioUrl));
    }

    // 确定播放模式
    let playMode = 'sequential';
    if (djTiming.mode === 'intro' && djUrl) {
      playMode = 'parallel';
    } else if (djTiming.mode === 'interlude' && djUrl) {
      playMode = 'interlude';
    }

    // 更新状态
    if (playMode === 'parallel') {
      setStatus('speaking');
    } else {
      setStatus('playing');
    }

    const startTime = Date.now();
    let played = false;

    try {
      // 播放前再次检查是否被中断（用户可能在准备期间点击了队列）
      if (_cycleId !== myCycleId) {
        console.log('[Radio] playCycle 播放前被中断');
        return;
      }

      // 检查是否已有音频在播放（用户点击了队列歌曲）
      if (engine._musicEl) {
        console.log('[Radio] 已有音频在播放，跳过 playCycle');
        return;
      }

      await engine.playAudio(musicUrl, {
        djUrl,
        mode: playMode,
        djOffset: djTiming.offset || 0,
        segue: data.segue,
      });
      played = true;
    } catch (err) {
      console.warn('[Radio] 播放周期异常:', err.message);
    }

    // 检查是否被外部中断（用户切歌/暂停）
    if (_cycleId !== myCycleId) {
      console.log('[Radio] playCycle 被外部中断，不继续调度');
      return;
    }

    // 最小播放时间保护
    const elapsed = (Date.now() - startTime) / 1000;
    if (played && elapsed < MIN_PLAY_SECONDS) {
      console.warn(`[Radio] 播放周期过短 (${elapsed.toFixed(1)}s < ${MIN_PLAY_SECONDS}s)，强制等待`);
      await new Promise(r => setTimeout(r, (MIN_PLAY_SECONDS - elapsed) * 1000));
    }

    // 再次检查是否被中断（等待期间可能被中断）
    if (_cycleId !== myCycleId) {
      console.log('[Radio] playCycle 被外部中断，不继续调度');
      return;
    }

    if (stopped) return;
    engine._interludeDjPlayed = false;
    setStatus('idle');

    const delay = played ? POLL_AFTER_MUSIC_MS : POLL_IDLE_MS;
    schedulePoll(delay);
  }

  // ══════════════════════════════════════════════
  // 轮询调度
  // ══════════════════════════════════════════════

  function schedulePoll(delay = POLL_IDLE_MS) {
    clearTimeout(pollTimer);
    if (stopped) return;

    // 捕获当前 cycleId，定时器触发时检查是否已失效
    const scheduledCycleId = _cycleId;

    pollTimer = setTimeout(async () => {
      if (stopped || _cycleId !== scheduledCycleId) return;
      const data = await fetchNext();
      if (data && _cycleId === scheduledCycleId) {
        await playCycle(data);
      } else if (!data) {
        schedulePoll(POLL_IDLE_MS);
      }
    }, delay);
  }

  // ══════════════════════════════════════════════
  // 公开方法
  // ══════════════════════════════════════════════

  async function start() {
    stopped = false;
    _failedCount = 0;
    clearTimeout(pollTimer);
    engine.ensureContext();
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
    _failedCount = 0;
    clearTimeout(pollTimer);
    engine.ensureContext();
    setStatus('loading');
    console.log('[Radio] 从弹药库播放...');

    try {
      const res = await fetch(`${API_BASE}/api/arsenal/play?limit=20`);
      const json = await res.json();

      if (json.data?.playlist?.length > 0) {
        const playlist = json.data.playlist.filter(t => t.playable && t.audioUrl);

        if (playlist.length === 0) {
          console.warn('[Radio] 弹药库无可播放歌曲');
          setStatus('idle');
          return;
        }

        state.playlist = playlist;
        state.currentIndex = 0;
        state.djAudio = null;
        state.lastUpdated = Date.now();

        console.log(`[Radio] 弹药库加载 ${playlist.length} 首歌`);
        await playTrackByIndex(0);
      } else {
        console.warn('[Radio] 弹药库为空');
        setStatus('idle');
      }
    } catch (err) {
      console.error('[Radio] 弹药库加载失败:', err.message);
      setStatus('error');
      state.error = err.message;
    }
  }

  function stop() {
    stopped = true;
    _failedCount = 0;
    _interruptAll();
    setStatus('idle');
    console.log('[Radio] 电台已停止');
  }

  function toggle() {
    console.log('[Radio] toggle, status:', state.status);

    if (state.status === 'paused') {
      // 暂停恢复：检查是否还有活跃的音频元素
      if (engine._musicEl && engine._musicEl.paused) {
        engine.resumeMusic();
        setStatus('playing');
      } else {
        // 音频元素已丢失，重新播放当前歌曲
        if (state.playlist.length > 0 && state.currentIndex < state.playlist.length) {
          playTrackByIndex(state.currentIndex);
        }
      }
    } else if (state.status === 'idle' || state.status === 'error') {
      if (state.playlist.length > 0 && state.currentIndex < state.playlist.length) {
        _failedCount = 0;
        engine.ensureContext();
        playTrackByIndex(state.currentIndex);
      } else {
        fetchNext().then(data => {
          if (data) playCycle(data);
        });
      }
    } else {
      // 暂停：只暂停音频，保留元素以便恢复；清除定时器防止自动切歌
      _cycleId++;
      clearTimeout(pollTimer);
      engine.pauseMusic();
      setStatus('paused');
    }
  }

  // ══════════════════════════════════════════════
  // 播放列表导航
  // ══════════════════════════════════════════════

  /**
   * 中断所有正在进行的播放（统一入口）
   * 递增 cycleId 使旧的 playCycle 自动失效
   */
  function _interruptAll() {
    _cycleId++;
    clearTimeout(pollTimer);
    engine.stopAll();
  }

  function next() {
    _interruptAll();

    if (_failedCount >= MAX_CONSECUTIVE_FAILS) {
      console.warn(`[Radio] 连续 ${_failedCount} 首播放失败，停止播放`);
      setStatus('error');
      state.error = '音频资源过期，请刷新页面重试';
      _failedCount = 0;
      return;
    }

    // 空列表守卫
    if (state.playlist.length === 0) {
      setStatus('idle');
      fetchNext().then(data => { if (data) playCycle(data); });
      return;
    }

    if (state.playlist.length > 1) {
      if (_playbackMode === 'repeat-one') {
        // 单曲循环：重新播放当前歌曲
        playTrackByIndex(state.currentIndex);
      } else if (_playbackMode === 'shuffle') {
        // 随机：选一首不同的歌
        let randIdx = state.currentIndex;
        while (randIdx === state.currentIndex && state.playlist.length > 1) {
          randIdx = Math.floor(Math.random() * state.playlist.length);
        }
        state.currentIndex = randIdx;
        playTrackByIndex(randIdx);
      } else {
        // 顺序：下一首
        state.currentIndex = (state.currentIndex + 1) % state.playlist.length;
        playTrackByIndex(state.currentIndex);
      }
      return;
    }

    // 单曲：获取新歌
    state.currentIndex = 0;
    _failedCount = 0;
    setStatus('idle');
    fetchNext().then(data => {
      if (data) playCycle(data);
    });
  }

  function prev() {
    _interruptAll();

    // 空列表守卫
    if (state.playlist.length === 0) {
      setStatus('idle');
      fetchNext().then(data => { if (data) playCycle(data); });
      return;
    }

    state.currentIndex = (state.currentIndex - 1 + state.playlist.length) % state.playlist.length;
    playTrackByIndex(state.currentIndex);
  }

  function playTrackByIndex(index) {
    const track = state.playlist[index];
    if (!track?.audioUrl) return;

    _interruptAll();

    state.currentIndex = index;
    state.say = null; // 清除旧的 DJ 台词
    // 防溢出：接近上限时重置
    if (_playSessionId > SESSION_ID_MAX) _playSessionId = 0;
    const sessionId = ++_playSessionId;

    const musicUrl = resolveUrl(track.audioUrl);
    setStatus('playing');
    const startTime = Date.now();

    engine.playAudio(musicUrl, { mode: 'sequential' }).then((result) => {
      // sessionId 不匹配说明已被新的 playTrackByIndex 调用取代，直接丢弃
      if (sessionId !== _playSessionId) return;

      // finished=false 说明被外部中断（用户切歌/暂停），不自动切歌
      if (result?.finished !== true) {
        console.log('[Radio] 歌曲被中断，不自动切歌');
        return;
      }

      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`[Radio] 歌曲播放 ${elapsed.toFixed(1)}s, 模式=${_playbackMode}`);

      if (elapsed < MIN_PLAY_SECONDS) {
        console.warn(`[Radio] 播放时间过短 (${elapsed.toFixed(1)}s)，音频可能加载失败`);
        _failedCount++;
        setStatus('error');
        state.error = '音频加载失败，正在重试...';
        if (!stopped) setTimeout(() => next(), 5000);
        return;
      }

      _failedCount = 0;
      if (!stopped) {
        // 根据播放模式决定下一步
        if (_playbackMode === 'repeat-one') {
          // 单曲循环：重新播放当前歌曲
          playTrackByIndex(state.currentIndex);
        } else if (_playbackMode === 'shuffle' && state.playlist.length > 1) {
          // 随机播放：选一首不同的歌
          let randIdx = state.currentIndex;
          while (randIdx === state.currentIndex && state.playlist.length > 1) {
            randIdx = Math.floor(Math.random() * state.playlist.length);
          }
          state.currentIndex = randIdx;
          playTrackByIndex(randIdx);
        } else {
          // 顺序播放
          next();
        }
      }
    }).catch(err => {
      if (sessionId !== _playSessionId) return;
      _failedCount++;
      console.warn(`[Radio] 播放失败 (${_failedCount}/${MAX_CONSECUTIVE_FAILS}):`, err.message);
      if (!stopped) setTimeout(() => next(), 3000);
    });
  }

  function playTrack(track) {
    if (!track?.audioUrl) return;

    // 查找歌曲在列表中的位置（取最后一个匹配项，避免重复 songId 问题）
    let idx = -1;
    for (let i = state.playlist.length - 1; i >= 0; i--) {
      if (state.playlist[i].songId === track.songId) { idx = i; break; }
    }
    if (idx < 0) {
      state.playlist.push(track);
      idx = state.playlist.length - 1;
    }

    state.currentIndex = idx;
    playTrackByIndex(idx); // playTrackByIndex 内部会调用 _interruptAll
  }

  function setVolume(val) {
    engine.setMasterVolume(val / 100);
  }

  async function playChatSongs(chatData) {
    console.log('[Radio] playChatSongs, tracks:', chatData?.tracks?.length);
    if (!chatData?.tracks?.length) return;

    const playlist = chatData.tracks.filter(
      song => song.playable === true && song.audioUrl !== null
    );

    if (playlist.length === 0) {
      console.warn('[Radio] 聊天推荐的歌曲全部不可播放');
      return;
    }

    // 中断所有正在进行的播放
    _interruptAll();
    stopped = true;

    const sessionId = ++_chatPlaySessionId;

    state.playlist = playlist;
    state.currentIndex = 0;
    state.say = chatData.reply;
    state.segue = 'crossfade:2000';
    state.lastUpdated = Date.now();

    console.log(`[Radio] 聊天推荐: ${playlist.length} 首歌`);

    stopped = false;
    let playIndex = 0;
    const PLAY_TIMEOUT_MS = 600000;

    while (!stopped && sessionId === _chatPlaySessionId) {
      const track = playlist[playIndex % playlist.length];
      const musicUrl = resolveUrl(track.audioUrl);

      state.currentIndex = playIndex % playlist.length;
      setStatus('playing');

      try {
        await Promise.race([
          engine.playAudio(musicUrl, { mode: 'sequential' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('播放超时')), PLAY_TIMEOUT_MS)),
        ]);
      } catch (err) {
        console.warn(`[Radio] 歌曲 ${track.songId} 播放失败:`, err.message);
      }

      playIndex++;
    }

    if (!stopped) {
      setStatus('idle');
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
    playTrackByIndex,
    cyclePlayMode,
  };
}
