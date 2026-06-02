<script setup>
import { inject, computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'

const radio = inject('radio')
const { state, engine, toggle } = radio

const emit = defineEmits(['close', 'showDetail'])

const currentTrack = computed(() => state?.playlist?.[state?.currentIndex ?? 0] || null)
const isPlaying = computed(() => state?.status === 'playing' || state?.status === 'speaking')

// Progress (polling for reactivity)
const currentTime = ref(0)
const duration = ref(0)
let progressTimer = null

function startProgressPolling() {
  stopProgressPolling()
  progressTimer = setInterval(() => {
    const p = engine?.getProgress?.() || {}
    currentTime.value = p.currentTime || 0
    duration.value = p.duration || 0
  }, 100)
}

function stopProgressPolling() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
}

const currentTimeStr = computed(() => formatTime(currentTime.value))
const durationStr = computed(() => formatTime(duration.value))

function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

// Seek
function onSeek(e) {
  const time = parseFloat(e.target.value)
  if (engine?._musicEl && isFinite(time)) {
    engine._musicEl.currentTime = time
    currentTime.value = time
  }
}

onMounted(() => {
  startProgressPolling()
})

onUnmounted(() => {
  stopProgressPolling()
})

// Lyrics with timestamps
const lyricsLines = ref([])
const activeLyricIndex = ref(-1)
const lyricsContainer = ref(null)

watch(currentTrack, async (track) => {
  if (!track?.songId) { lyricsLines.value = []; return }
  try {
    const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '')
    const res = await fetch(`${API_BASE}/api/lyrics/${track.songId}`)
    const data = await res.json()
    lyricsLines.value = data.lines || []
    activeLyricIndex.value = -1
  } catch {
    lyricsLines.value = []
  }
}, { immediate: true })

// Find active lyric based on current time
watch(currentTime, (time) => {
  if (!lyricsLines.value.length) return
  let idx = -1
  for (let i = lyricsLines.value.length - 1; i >= 0; i--) {
    if (time >= lyricsLines.value[i].time) {
      idx = i
      break
    }
  }
  if (idx !== activeLyricIndex.value) {
    activeLyricIndex.value = idx
    nextTick(() => {
      if (lyricsContainer.value) {
        const el = lyricsContainer.value.querySelector('.lyric-active')
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    })
  }
})
</script>

<template>
  <div class="now-playing-page">
    <!-- Header -->
    <div class="np-header">
      <button class="back-btn" @click="emit('close')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </button>
      <span class="font-dot text-lg text-text-primary tracking-widest">NOW PLAYING</span>
      <div class="w-8"></div>
    </div>

    <!-- Cover (Rotating) -->
    <div class="np-cover-wrapper">
      <div class="np-cover-ring" :class="{ spinning: isPlaying }">
        <div class="np-cover">
          <img v-if="currentTrack?.coverUrl" :src="currentTrack.coverUrl.replace(/^http:\/\//, 'https://')" class="w-full h-full object-cover" alt="cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-text-dim text-5xl bg-cyber-surface">🎵</div>
        </div>
      </div>
    </div>

    <!-- Track Info -->
    <div class="np-info" v-if="currentTrack">
      <h2 class="font-sans text-xl font-bold text-text-primary text-center truncate">{{ currentTrack.title }}</h2>
      <p class="font-mono text-[11px] text-text-dim tracking-widest text-center mt-1">{{ currentTrack.artist }}</p>
    </div>
    <div class="np-info" v-else>
      <h2 class="font-sans text-xl font-bold text-text-dim text-center">Waiting...</h2>
    </div>

    <!-- Progress Bar (Seekable) -->
    <div class="np-progress">
      <input
        type="range"
        min="0"
        :max="duration || 0"
        :value="currentTime"
        @input="onSeek"
        class="np-seek-bar"
        step="0.1"
      />
      <div class="flex justify-between mt-1">
        <span class="font-mono text-[9px] text-text-dim">{{ currentTimeStr }}</span>
        <span class="font-mono text-[9px] text-text-dim">{{ durationStr }}</span>
      </div>
    </div>

    <!-- Flowing Lyrics -->
    <div class="np-lyrics" ref="lyricsContainer">
      <div v-if="lyricsLines.length === 0" class="text-center py-8">
        <span class="text-text-dim text-xs font-mono opacity-50">暂无歌词</span>
      </div>
      <div
        v-for="(line, i) in lyricsLines"
        :key="i"
        class="lyric-line"
        :class="{
          'lyric-active': i === activeLyricIndex,
          'lyric-past': i < activeLyricIndex,
          'lyric-future': i > activeLyricIndex,
        }"
      >
        {{ line.text }}
      </div>
    </div>

    <!-- Detail Button -->
    <button class="np-detail-btn" @click="emit('showDetail', currentTrack)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
      <span class="font-mono text-[10px] tracking-widest">DETAIL</span>
    </button>
  </div>
</template>

<style scoped>
.now-playing-page {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: #06060e;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  overflow-y: auto;
}

.np-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  max-width: 400px;
  margin-bottom: 24px;
  flex-shrink: 0;
}

.back-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: #e8e8ec;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.back-btn:hover {
  border-color: rgba(0, 240, 255, 0.3);
  color: #00f0ff;
}

/* Rotating Cover */
.np-cover-wrapper {
  width: 180px;
  height: 180px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.np-cover-ring {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  padding: 6px;
  background: conic-gradient(from 0deg, rgba(0, 240, 255, 0.3), rgba(138, 43, 226, 0.3), rgba(0, 240, 255, 0.3));
  animation: spin-slow 8s linear infinite;
  animation-play-state: paused;
}

.np-cover-ring.spinning {
  animation-play-state: running;
}

@keyframes spin-slow {
  to { transform: rotate(360deg); }
}

.np-cover {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  border: 3px solid #06060e;
}

.np-info {
  width: 100%;
  max-width: 320px;
  margin-bottom: 12px;
  flex-shrink: 0;
}

/* Progress Bar */
.np-progress {
  width: 100%;
  max-width: 320px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.np-seek-bar {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.np-seek-bar::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #00ff41;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(0, 255, 65, 0.4);
}

/* Flowing Lyrics */
.np-lyrics {
  width: 100%;
  max-width: 320px;
  flex: 1;
  overflow-y: auto;
  padding: 20px 0;
  mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%);
}

.lyric-line {
  text-align: center;
  padding: 8px 0;
  font-size: 14px;
  line-height: 1.6;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.lyric-active {
  color: #ffffff;
  font-size: 17px;
  font-weight: 700;
  text-shadow: 0 0 20px rgba(0, 240, 255, 0.4), 0 0 40px rgba(0, 240, 255, 0.2);
  transform: scale(1.08);
  padding: 12px 0;
  background: linear-gradient(90deg, transparent, rgba(0, 240, 255, 0.05), transparent);
  border-radius: 8px;
}

.lyric-past {
  color: #3f3f46;
  font-weight: 300;
  opacity: 0.5;
}

.lyric-future {
  color: #52525b;
  font-weight: 300;
}

/* Detail Button */
.np-detail-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid rgba(0, 240, 255, 0.2);
  background: transparent;
  color: #00f0ff;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
  margin-top: 12px;
}

.np-detail-btn:hover {
  background: rgba(0, 240, 255, 0.1);
  box-shadow: 0 0 12px rgba(0, 240, 255, 0.2);
}
</style>
