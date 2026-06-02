/**
 * AudioEngine.js — 纯 Audio 元素播放引擎
 *
 * 不使用 createMediaElementSource（跨域音频无法连接到 Web Audio 节点）。
 * 改用 <audio> 直接播放 + audio.volume 控制 Ducking。
 *
 * 音频可视化通过 AudioContext 的 createMediaElementSource 仅对同源音频生效，
 * 网易云 CDN 跨域音频走纯 <audio> 通道。
 */

const DUCK_LEVEL = 0.6;
const NORMAL_LEVEL = 1.0;
const DUCK_RAMP_MS = 500;
const RECOVER_RAMP_MS = 1000;

export class AudioEngine {
  constructor() {
    // 当前播放的 <audio> 元素
    this._musicEl = null;
    this._djEl = null;

    // 状态
    this.isPlaying = false;
    this.isDucking = false;

    // 进度追踪
    this.progress = { currentTime: 0, duration: 0, percent: 0 };
    this._progressTimer = null;

    // Ducking 动画 timer
    this._duckTimer = null;

    // 间奏 DJ 播放标记
    this._interludeDjPlayed = false;

    // 音乐 Promise 控制
    this._musicResolve = null;
    this._musicReject = null;

    // 预加载缓存
    this._prefetchCache = new Map();

    // 音频可视化（仅同源音频可用）
    this.ctx = null;
    this.analyser = null;
    this._freqData = null;
  }

  // ══════════════════════════════════════════════
  // AudioContext（仅用于音频可视化，非必须）
  // ══════════════════════════════════════════════

  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.connect(this.ctx.destination);
      this._freqData = new Uint8Array(this.analyser.frequencyBinCount);
    } catch (_) {
      // 跨域环境下 AudioContext 可能失败，不影响播放
    }
  }

  getFrequencyData() {
    if (!this.analyser || !this._freqData) {
      return { bass: 0, mid: 0, treble: 0, raw: null };
    }
    this.analyser.getByteFrequencyData(this._freqData);
    let bass = 0, mid = 0, treble = 0;
    for (let i = 0; i < 10; i++) bass += this._freqData[i];
    for (let i = 10; i < 50; i++) mid += this._freqData[i];
    for (let i = 50; i < this._freqData.length; i++) treble += this._freqData[i];
    return { bass: bass / 10, mid: mid / 40, treble: treble / (this._freqData.length - 50), raw: this._freqData };
  }

  // ══════════════════════════════════════════════
  // 核心方法：playRadioCycle
  // ══════════════════════════════════════════════

  async playRadioCycle(djUrl, musicUrl, segue = 'crossfade:2000') {
    const crossfadeMs = this._parseSegue(segue);

    // Phase 1: DJ 语音（压低音乐音量）
    if (djUrl) {
      await this._playDj(djUrl);
    }

    // Phase 2: 播放音乐
    if (musicUrl) {
      await this._playMusic(musicUrl, crossfadeMs);
    }
  }

  /**
   * 模式 1：歌曲和 DJ 并行播放
   * 歌曲开始的同时播放 DJ 语音（音乐闪避），DJ 结束后音乐恢复
   */
  playWithDjOverlay(musicUrl, djUrl, segue = 'crossfade:2000') {
    const crossfadeMs = this._parseSegue(segue);

    return new Promise((resolve, reject) => {
      // 启动歌曲
      this._stopMusic();
      const music = new Audio(musicUrl);
      this._musicEl = music;
      this.isPlaying = true;
      this._startProgressTracking(music);

      if (crossfadeMs > 0) {
        music.volume = 0;
        this._fadeVolume(music, 0, NORMAL_LEVEL, crossfadeMs);
      } else {
        music.volume = NORMAL_LEVEL;
      }

      let djFinished = false;
      let musicFinished = false;

      const tryResolve = () => {
        if (djFinished && musicFinished) resolve();
      };

      music.addEventListener('ended', () => {
        this.isPlaying = false;
        this._cleanupMusic();
        musicFinished = true;
        tryResolve();
      });

      music.addEventListener('error', (e) => {
        this.isPlaying = false;
        this._cleanupMusic();
        reject(new Error(`音乐播放失败: ${e.message || 'unknown'}`));
      });

      music.play().catch(err => {
        this.isPlaying = false;
        this._cleanupMusic();
        reject(err);
      });

      // 同时启动 DJ（会自动闪避音乐）
      this._playDj(djUrl).then(() => {
        djFinished = true;
        tryResolve();
      }).catch(() => {
        djFinished = true;
        tryResolve();
      });
    });
  }

  // ══════════════════════════════════════════════
  // DJ 通道
  // ══════════════════════════════════════════════

  _playDj(url) {
    return new Promise((resolve, reject) => {
      this._stopDj();

      const audio = new Audio(url);
      this._djEl = audio;
      audio.volume = 1.0;

      // 触发闪避
      this._duck();

      audio.addEventListener('ended', () => {
        this._unduck();
        this._djEl = null;
        resolve();
      });

      audio.addEventListener('error', (e) => {
        this._unduck();
        this._djEl = null;
        reject(new Error(`DJ 播放失败: ${e.message || 'unknown'}`));
      });

      audio.play().catch(err => {
        this._unduck();
        this._djEl = null;
        reject(err);
      });
    });
  }

  _stopDj() {
    if (this._djEl) {
      this._djEl.pause();
      this._djEl.removeAttribute('src');
      this._djEl.load(); // 强制释放音频资源
      this._djEl = null;
    }
  }

  // ══════════════════════════════════════════════
  // 音乐通道
  // ══════════════════════════════════════════════

  _playMusic(url, crossfadeMs = 0) {
    return new Promise((resolve, reject) => {
      this._stopMusic();

      // 存储 resolve，让 _stopMusic 可以中断 Promise
      this._musicResolve = resolve;
      this._musicReject = reject;
      this._musicStopped = false;

      const audio = new Audio(url);
      this._musicEl = audio;
      this.isPlaying = true;

      // 进度追踪
      this._startProgressTracking(audio);

      // 交叉淡入
      if (crossfadeMs > 0) {
        audio.volume = 0;
        this._fadeVolume(audio, 0, NORMAL_LEVEL, crossfadeMs);
      } else {
        audio.volume = NORMAL_LEVEL;
      }

      audio.addEventListener('ended', () => {
        this._musicResolve = null;
        this._musicReject = null;
        this._musicStopped = false;
        this.isPlaying = false;
        this._cleanupMusic();
        resolve({ finished: true });
      });

      audio.addEventListener('error', (e) => {
        this._musicResolve = null;
        this._musicReject = null;
        this.isPlaying = false;
        this._cleanupMusic();
        reject(new Error(`音乐播放失败: ${e.message || 'unknown'}`));
      });

      audio.play().catch(err => {
        this._musicResolve = null;
        this._musicReject = null;
        this.isPlaying = false;
        this._cleanupMusic();
        reject(err);
      });
    });
  }

  /**
   * 播放音乐 + 每次时间更新时回调（用于间奏触发 DJ）
   */
  _playMusicWithCallback(url, crossfadeMs = 0, onTimeUpdate) {
    return new Promise((resolve, reject) => {
      this._stopMusic();
      this._interludeDjPlayed = false;

      // 存储 resolve，让 _stopMusic 可以中断 Promise
      this._musicResolve = resolve;
      this._musicReject = reject;

      const audio = new Audio(url);
      this._musicEl = audio;
      this.isPlaying = true;

      // 进度追踪 + 回调
      this._stopProgressTracking();
      this._progressTimer = setInterval(() => {
        if (!audio || audio.paused || audio.ended) {
          this._stopProgressTracking();
          return;
        }
        const current = audio.currentTime || 0;
        const duration = audio.duration || 0;
        this.progress = {
          currentTime: current,
          duration,
          percent: duration > 0 ? (current / duration) * 100 : 0,
        };
        if (onTimeUpdate) onTimeUpdate(current);
      }, 250);

      // 交叉淡入
      if (crossfadeMs > 0) {
        audio.volume = 0;
        this._fadeVolume(audio, 0, NORMAL_LEVEL, crossfadeMs);
      } else {
        audio.volume = NORMAL_LEVEL;
      }

      audio.addEventListener('ended', () => {
        this._musicResolve = null;
        this._musicReject = null;
        this.isPlaying = false;
        this._cleanupMusic();
        resolve();
      });

      audio.addEventListener('error', (e) => {
        this._musicResolve = null;
        this._musicReject = null;
        this.isPlaying = false;
        this._cleanupMusic();
        reject(new Error(`音乐播放失败: ${e.message || 'unknown'}`));
      });

      audio.play().catch(err => {
        this._musicResolve = null;
        this._musicReject = null;
        this.isPlaying = false;
        this._cleanupMusic();
        reject(err);
      });
    });
  }

  _stopMusic() {
    // 中断正在进行的 Promise（标记为被打断）
    if (this._musicResolve) {
      this._musicResolve({ finished: false });
      this._musicResolve = null;
      this._musicReject = null;
    }

    if (this._musicEl) {
      this._musicEl.pause();
      this._musicEl.removeAttribute('src');
      this._musicEl.load(); // 强制释放音频资源，防止重叠
      this._musicEl = null;
    }
    this.isPlaying = false;
    this._stopProgressTracking();
    if (this._duckTimer) {
      clearInterval(this._duckTimer);
      this._duckTimer = null;
    }
  }

  _cleanupMusic() {
    this._musicEl = null;
    this._stopProgressTracking();
  }

  // ══════════════════════════════════════════════
  // Ducking（通过 audio.volume 控制）
  // ══════════════════════════════════════════════

  _duck() {
    if (!this._musicEl) return;
    this._fadeVolume(this._musicEl, this._musicEl.volume, DUCK_LEVEL, DUCK_RAMP_MS);
    this.isDucking = true;
    console.log(`[AudioEngine] Duck ON → ${DUCK_LEVEL}`);
  }

  _unduck() {
    if (!this._musicEl) return;
    this._fadeVolume(this._musicEl, this._musicEl.volume, NORMAL_LEVEL, RECOVER_RAMP_MS);
    this.isDucking = false;
    console.log(`[AudioEngine] Duck OFF → ${NORMAL_LEVEL}`);
  }

  /**
   * 线性渐变 audio.volume
   * 模拟 linearRampToValueAtTime 的效果
   */
  _fadeVolume(audio, from, to, durationMs) {
    if (this._duckTimer) clearInterval(this._duckTimer);

    const steps = Math.max(1, Math.floor(durationMs / 30));
    const stepSize = (to - from) / steps;
    let step = 0;

    this._duckTimer = setInterval(() => {
      step++;
      if (step >= steps || !audio) {
        clearInterval(this._duckTimer);
        this._duckTimer = null;
        if (audio) audio.volume = Math.max(0, Math.min(1, to));
        return;
      }
      audio.volume = Math.max(0, Math.min(1, from + stepSize * step));
    }, 30);
  }

  // ══════════════════════════════════════════════
  // 进度追踪
  // ══════════════════════════════════════════════

  _startProgressTracking(audio) {
    this._stopProgressTracking();
    this.progress = { currentTime: 0, duration: 0, percent: 0 };

    this._progressTimer = setInterval(() => {
      if (!audio || audio.paused || audio.ended) {
        this._stopProgressTracking();
        return;
      }
      const current = audio.currentTime || 0;
      const duration = audio.duration || 0;
      this.progress = {
        currentTime: current,
        duration,
        percent: duration > 0 ? (current / duration) * 100 : 0,
      };
    }, 250);
  }

  _stopProgressTracking() {
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
    this.progress = { currentTime: 0, duration: 0, percent: 0 };
  }

  getProgress() {
    return this.progress;
  }

  // ══════════════════════════════════════════════
  // 全局控制
  // ══════════════════════════════════════════════

  setMasterVolume(vol) {
    const v = Math.max(0, Math.min(1, vol));
    if (this._musicEl) this._musicEl.volume = v;
    if (this._djEl) this._djEl.volume = v;
  }

  pause() {
    if (this._musicEl) this._musicEl.pause();
    if (this._djEl) this._djEl.pause();
  }

  resume() {
    if (this._musicEl) this._musicEl.play();
    if (this._djEl) this._djEl.play();
  }

  prefetchAudio(url) {
    if (!url || this._prefetchCache.has(url)) return;
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    link.as = 'audio';
    document.head.appendChild(link);
    this._prefetchCache.set(url, true);
  }

  destroy() {
    this._stopDj();
    this._stopMusic();
    if (this._duckTimer) clearInterval(this._duckTimer);
    this._prefetchCache.clear();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }

  _parseSegue(segue) {
    if (!segue) return 0;
    const match = segue.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
}
