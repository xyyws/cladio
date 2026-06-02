import { ref } from 'vue';

/**
 * Web Audio API 引擎 — 核心职责：Ducking（闪避处理）
 *
 * 架构:
 *   musicSource → musicGain ─┐
 *                             ├→ masterGain → destination
 *   ttsSource   → ttsGain  ─┘
 *
 * Ducking 逻辑:
 *   1. TTS 开始播放 → musicGain 降至 DUCK_LEVEL (0.15)，ttsGain 保持 1.0
 *   2. TTS 播放结束 → musicGain 恢复到 NORMAL_LEVEL (1.0)
 *   3. 使用 linearRampToValueAtTime 实现平滑过渡
 */

const DUCK_LEVEL = 0.15;
const NORMAL_LEVEL = 1.0;
const RAMP_DURATION = 0.5; // 秒

export function useAudioEngine() {
  const isPlaying = ref(false);
  const isDucking = ref(false);
  const currentMusicEl = ref(null);
  const currentTtsEl = ref(null);

  let audioCtx = null;
  let masterGain = null;
  let musicGain = null;
  let ttsGain = null;
  let musicSource = null;
  let ttsSource = null;

  // ── 初始化 AudioContext（需用户手势触发） ──

  function ensureContext() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return;
    }

    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(audioCtx.destination);

    musicGain = audioCtx.createGain();
    musicGain.gain.value = NORMAL_LEVEL;
    musicGain.connect(masterGain);

    ttsGain = audioCtx.createGain();
    ttsGain.gain.value = NORMAL_LEVEL;
    ttsGain.connect(masterGain);
  }

  // ── 音乐播放 ──

  async function playMusic(url) {
    ensureContext();

    // 停止当前音乐
    stopMusic();

    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    currentMusicEl.value = audio;

    const source = audioCtx.createMediaElementSource(audio);
    source.connect(musicGain);
    musicSource = source;

    audio.addEventListener('ended', () => {
      isPlaying.value = false;
    });

    try {
      await audio.play();
      isPlaying.value = true;
    } catch (err) {
      console.error('[AudioEngine] 音乐播放失败:', err.message);
    }

    return audio;
  }

  function stopMusic() {
    if (currentMusicEl.value) {
      currentMusicEl.value.pause();
      currentMusicEl.value.src = '';
      currentMusicEl.value = null;
    }
    if (musicSource) {
      try { musicSource.disconnect(); } catch (_) {}
      musicSource = null;
    }
    isPlaying.value = false;
  }

  // ── TTS 播放（带 Ducking） ──

  function playTts(url) {
    return new Promise((resolve, reject) => {
      ensureContext();

      // 停止当前 TTS
      stopTts();

      const audio = new Audio(url);
      audio.crossOrigin = 'anonymous';
      currentTtsEl.value = audio;

      const source = audioCtx.createMediaElementSource(audio);
      source.connect(ttsGain);
      ttsSource = source;

      // ── Ducking: TTS 开始时压低音乐 ──
      duck();

      audio.addEventListener('ended', () => {
        unduck();
        cleanup();
        resolve();
      });

      audio.addEventListener('error', (e) => {
        unduck();
        cleanup();
        reject(new Error(`TTS 播放失败: ${e.message || 'unknown'}`));
      });

      audio.play().catch(err => {
        unduck();
        cleanup();
        reject(err);
      });
    });
  }

  function stopTts() {
    if (currentTtsEl.value) {
      currentTtsEl.value.pause();
      currentTtsEl.value.src = '';
      currentTtsEl.value = null;
    }
    if (ttsSource) {
      try { ttsSource.disconnect(); } catch (_) {}
      ttsSource = null;
    }
    unduck();
  }

  function cleanup() {
    if (ttsSource) {
      try { ttsSource.disconnect(); } catch (_) {}
      ttsSource = null;
    }
    currentTtsEl.value = null;
  }

  // ── Ducking 核心逻辑 ──

  function duck() {
    if (!musicGain || !audioCtx) return;
    const now = audioCtx.currentTime;

    // 音乐压低
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(DUCK_LEVEL, now + RAMP_DURATION);

    isDucking.value = true;
    console.log('[AudioEngine] Ducking ON → music gain →', DUCK_LEVEL);
  }

  function unduck() {
    if (!musicGain || !audioCtx) return;
    const now = audioCtx.currentTime;

    // 音乐恢复
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(NORMAL_LEVEL, now + RAMP_DURATION);

    isDucking.value = false;
    console.log('[AudioEngine] Ducking OFF → music gain →', NORMAL_LEVEL);
  }

  // ── 全局控制 ──

  function pause() {
    if (currentMusicEl.value) currentMusicEl.value.pause();
    isPlaying.value = false;
  }

  function resume() {
    ensureContext();
    if (currentMusicEl.value) {
      currentMusicEl.value.play();
      isPlaying.value = true;
    }
  }

  function setMasterVolume(vol) {
    if (masterGain) {
      masterGain.gain.value = Math.max(0, Math.min(1, vol));
    }
  }

  function destroy() {
    stopMusic();
    stopTts();
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
  }

  return {
    isPlaying,
    isDucking,
    playMusic,
    stopMusic,
    playTts,
    stopTts,
    pause,
    resume,
    setMasterVolume,
    destroy,
  };
}
