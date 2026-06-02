<script setup>
import { inject, computed, ref, onMounted, onUnmounted } from 'vue'

const radio = inject('radio')
const { state, engine, toggle } = radio

const emit = defineEmits(['close'])

const djAvatar = localStorage.getItem('claudio-dj-avatar') || ''

const isPlaying = computed(() => state.status === 'playing' || state.status === 'speaking')
const currentTrack = computed(() => state.playlist?.[state.currentIndex ?? 0] || { title: 'Waiting...', artist: 'DJ' })
const transcriptText = computed(() => state.say || '等待 DJ 介绍...')

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
const progressPercent = computed(() => duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0)

onMounted(() => startProgressPolling())
onUnmounted(() => stopProgressPolling())

function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function goBack() {
  emit('close')
}
</script>

<template>
  <div class="radio-card">
    <div class="dark-top cursor-pointer" @click="goBack">
      <div class="top-header">
        <div class="flex items-center gap-3">
          <div class="avatar-box">
            <img v-if="djAvatar" :src="djAvatar" class="w-full h-full object-cover rounded-full" />
            <img v-else src="https://api.dicebear.com/7.x/bottts/svg?seed=Claudio" class="w-full h-full mix-blend-screen" />
          </div>
          <div class="flex flex-col">
            <span class="font-dot text-xl text-[#f0f0f5] tracking-widest leading-none">Claudio</span>
            <div class="flex items-center gap-1.5 mt-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-neon-green shadow-[0_0_8px_rgba(0,255,65,0.6)]"></span>
              <span class="text-neon-green font-sans text-[11px] font-medium">Speaking...</span>
            </div>
          </div>
        </div>
        <div class="text-white font-sans text-sm opacity-90 font-medium">{{ currentTimeStr }}</div>
      </div>

      <div class="waveform-container">
        <div class="bar" v-for="i in 60" :key="i" :style="{ height: Math.max(5, Math.random() * 100) + '%', animationDelay: (Math.random() * 1) + 's' }"></div>
      </div>
    </div>

    <div class="white-bottom-sheet">
      <div class="track-header">
        <h1 class="font-sans text-3xl font-bold text-[#111] mb-1.5 leading-tight tracking-tight">{{ currentTrack.title }}</h1>
        <p class="font-sans text-[#666] text-sm mb-6">{{ currentTrack.artist }}</p>

        <div class="player-row">
          <button class="black-btn" @click.stop="toggle">
            <span v-if="isPlaying" class="font-bold">||</span>
            <span v-else class="text-xs">▶</span>
          </button>
          <div class="progress-bar-container flex-1 mx-4">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
            </div>
          </div>
          <div class="time-text font-mono text-[10px] text-[#888]">{{ currentTimeStr }} / {{ durationStr }}</div>
        </div>
      </div>

      <div class="transcript-section dot-grid-light">
        <div class="transcript-item active">
          <div class="speaker-time font-sans">Claudio • {{ currentTimeStr }}</div>
          <p class="transcript-text font-sans">{{ transcriptText }}</p>
        </div>
      </div>

      <div class="fab-container">
        <div class="bottom-time">{{ currentTimeStr }}</div>
        <div class="bottom-waveform">
          <div class="bar-mini" v-for="i in 30" :key="'mini'+i" :style="{ height: Math.max(20, Math.random() * 100) + '%' }"></div>
        </div>
        <button class="black-btn-huge shadow-xl" @click.stop="toggle">
          <span v-if="isPlaying">||</span>
          <span v-else>▶</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.radio-card {
  position: absolute;
  top: 20px;
  bottom: 20px;
  left: 20px;
  right: 20px;
  margin: 0 auto;
  width: calc(100% - 40px);
  max-width: 480px;
  height: 95vh;
  max-height: 900px;
  display: flex;
  flex-direction: column;
  z-index: 100;
  background: #0d1117;
  border-radius: 24px;
  box-shadow: 0 0 100px rgba(138, 43, 226, 0.25), 0 0 40px rgba(0, 240, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.dark-top {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 32px 24px;
  position: relative;
  overflow: hidden;
}

.top-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  z-index: 10;
}

.avatar-box {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.waveform-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 180px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
  padding: 0 16px;
  mask-image: linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%);
  -webkit-mask-image: linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%);
}

.bar {
  width: 4px;
  background: #ffffff;
  border-radius: 2px 2px 0 0;
  animation: pulse-bar 1s ease-in-out infinite alternate;
}

@keyframes pulse-bar {
  0% { transform: scaleY(0.7); }
  100% { transform: scaleY(1.1); }
}

.white-bottom-sheet {
  background: #ffffff;
  border-radius: 24px 24px 0 0;
  flex-shrink: 0;
  height: 65vh;
  display: flex;
  flex-direction: column;
  position: relative;
  box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.3);
  margin-top: -24px;
  z-index: 10;
}

.track-header {
  padding: 32px 32px 24px;
}

.player-row {
  display: flex;
  align-items: center;
}

.black-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #111;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  border: none;
  cursor: pointer;
  transition: transform 0.2s;
}

.black-btn:hover {
  transform: scale(1.05);
}

.progress-bar-container {
  display: flex;
  align-items: center;
}

.progress-bar {
  width: 100%;
  height: 3px;
  background: #e0e0e0;
  border-radius: 1.5px;
}

.progress-fill {
  height: 100%;
  background: #111;
  border-radius: 1.5px;
}

.transcript-section {
  flex: 1;
  background-color: #f7f7f9;
  border-radius: 24px;
  margin: 0 16px 16px;
  padding: 24px;
  overflow-y: auto;
  position: relative;
}

.dot-grid-light {
  background-image: radial-gradient(#d0d0d5 1px, transparent 1px);
  background-size: 16px 16px;
}

.transcript-item {
  margin-bottom: 24px;
  transition: all 0.3s;
}

.speaker-time {
  font-size: 11px;
  color: #888;
  margin-bottom: 6px;
  font-weight: 500;
}

.transcript-text {
  font-size: 17px;
  line-height: 1.5;
  color: #111;
  font-weight: 500;
}

.fab-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 16px 24px 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(0deg, #ffffff 40%, rgba(255,255,255,0));
}

.bottom-time {
  font-family: var(--font-mono);
  font-size: 12px;
  color: #111;
  font-weight: bold;
}

.bottom-waveform {
  flex: 1;
  height: 20px;
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 0 16px;
}

.bar-mini {
  width: 2px;
  background: #aaa;
  border-radius: 1px;
}

.black-btn-huge {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #111;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-weight: bold;
  font-size: 18px;
  border: none;
  cursor: pointer;
  transition: transform 0.2s;
}

.black-btn-huge:hover {
  transform: scale(1.05);
}
</style>
