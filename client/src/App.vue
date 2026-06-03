<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, provide, nextTick } from 'vue'
import { useRadio } from './composables/useRadio.js'
import { useClock } from './composables/useClock.js'
import { useUser } from './composables/useUser.js'
import { initParticleSystem } from './composables/particleSystem.js'
import WaveformVisualizer from './components/WaveformVisualizer.vue'
import RadioView from './components/RadioView.vue'
import ProfileView from './components/ProfileView.vue'
import FloatingComments from './components/FloatingComments.vue'
import NowPlayingCard from './components/NowPlayingCard.vue'
import SongDetailCard from './components/SongDetailCard.vue'

// ── Shared Radio & Clock & User ──
const radio = useRadio()
const { state, engine, start, startFromArsenal, stop, toggle, prev, next, setVolume, playChatSongs, playTrack } = radio
provide('radio', radio)

const userCtx = useUser()
const { user, stats, listeningHours, uniqueSongsPlayed, level, login, logout, recordPlay, addFavorite, startListeningTimer, stopListeningTimer } = userCtx
provide('user', userCtx)

const { hours, minutes, seconds, dateString } = useClock()

// ── Weather & Environment integration ──
const weatherInfo = ref({
  city: 'Shanghai',
  condition: '多云',
  description: '多云',
  temp: 20,
  feelsLike: 20,
  humidity: 50
})

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '')

async function fetchWeather() {
  try {
    const res = await fetch(`${API_BASE}/api/context`)
    if (res.ok) {
      const data = await res.json()
      if (data.weather) {
        weatherInfo.value = {
          city: data.weather.city || 'Shanghai',
          condition: data.weather.condition || '多云',
          description: data.weather.description || '多云',
          temp: data.weather.temp !== undefined ? data.weather.temp : 20,
          feelsLike: data.weather.feelsLike !== undefined ? data.weather.feelsLike : 20,
          humidity: data.weather.humidity !== undefined ? data.weather.humidity : 50
        }
      }
    }
  } catch (err) {
    console.error('获取天气信息失败:', err)
  }
}

// 自动更新星期（动态）
const weekdayName = computed(() => {
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return weekdays[new Date().getDay()]
})

// 天气特效 Class 映射
const weatherThemeClass = computed(() => {
  const cond = weatherInfo.value.condition;
  if (!cond) return 'weather-cloudy';
  if (cond.includes('晴')) return 'weather-sunny';
  if (cond.includes('雨')) {
    if (cond.includes('雷')) return 'weather-storm';
    return 'weather-rainy';
  }
  if (cond.includes('雪')) return 'weather-snowy';
  if (cond.includes('雾') || cond.includes('霾')) return 'weather-misty';
  return 'weather-cloudy';
})

// 天气高亮文字 Class
const weatherTextClass = computed(() => {
  const cls = weatherThemeClass.value;
  if (cls === 'weather-sunny') return 'text-neon-orange';
  if (cls === 'weather-rainy') return 'text-neon-cyan';
  if (cls === 'weather-storm') return 'text-neon-purple';
  if (cls === 'weather-snowy') return 'text-white drop-shadow-[0_0_3px_rgba(255,255,255,0.6)]';
  if (cls === 'weather-misty') return 'text-slate-400';
  return 'text-neon-blue';
})

// 天气下落粒子列表
const weatherParticles = ref([])

function initWeatherParticles() {
  const list = []
  for (let i = 0; i < 20; i++) {
    list.push({
      id: i,
      style: {
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * -10}px`,
        animationDelay: `${Math.random() * 4}s`,
        animationDuration: `${1.5 + Math.random() * 2}s`,
        opacity: `${0.25 + Math.random() * 0.55}`
      }
    })
  }
  weatherParticles.value = list
}

const showParticles = computed(() => {
  const cls = weatherThemeClass.value;
  return cls === 'weather-rainy' || cls === 'weather-storm' || cls === 'weather-snowy';
})

const particleClass = computed(() => {
  const cls = weatherThemeClass.value;
  if (cls === 'weather-rainy' || cls === 'weather-storm') return 'particle-rain';
  if (cls === 'weather-snowy') return 'particle-snow';
  return '';
})

// 监听 AI 电台自动传回的天气
watch(() => state.env, (newEnv) => {
  if (newEnv) {
    weatherInfo.value = {
      city: weatherInfo.value.city || 'Shanghai', // 保持原有城市或降级
      condition: newEnv.weather || '多云',
      description: newEnv.weather || '多云',
      temp: parseInt(newEnv.temperature) || 20,
      feelsLike: parseInt(newEnv.temperature) || 20,
      humidity: weatherInfo.value.humidity || 50
    }
  }
}, { deep: true })

// ── Login Modal ──
const showLoginModal = ref(false)
const loginName = ref('')
const loginPhone = ref('')
const loginPassword = ref('')
const loginLoading = ref(false)
const loginError = ref('')

function handleLogin() {
  if (login(loginName.value)) {
    showLoginModal.value = false
    loginName.value = ''
  }
}

async function handleNeteaseLogin() {
  if (!loginPhone.value || !loginPassword.value) {
    loginError.value = '请输入手机号和密码'
    return
  }

  loginLoading.value = true
  loginError.value = ''

  try {
    const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '')
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `用手机号 ${loginPhone.value} 和密码登录网易云`,
        history: [],
      }),
    })
    const data = await res.json()

    if (data.reply?.includes('成功') || data.reply?.includes('登录')) {
      showLoginModal.value = false
      loginPhone.value = ''
      loginPassword.value = ''
      pushSystemMsg('✅ 网易云登录成功')
    } else {
      loginError.value = data.reply || '登录失败'
    }
  } catch (err) {
    loginError.value = '网络错误'
  } finally {
    loginLoading.value = false
  }
}

function handleLogout() {
  logout()
}

// ── App State ──
const activeCard = ref('main') // 'main' | 'radio' | 'profile'
const showNowPlaying = ref(false)
const showSongDetail = ref(false)
const detailSong = ref(null)
const theme = ref(localStorage.getItem('claudio-theme') || 'dark')

function toggleTheme(newTheme) {
  theme.value = newTheme
  localStorage.setItem('claudio-theme', newTheme)
  document.body.style.backgroundColor = newTheme === 'light' ? '#f0f0f5' : '#030308'
}

const volume = ref(80)
const chatInput = ref('')
const chatMessages = reactive(JSON.parse(localStorage.getItem('claudio-chat') || '[]'))
const chatLoading = ref(false)
const agentLog = reactive([])
const chatMessagesRef = ref(null)
const floatingComments = ref([])
let _lastCommentSongId = null

// User Avatar Upload
const userAvatar = ref(localStorage.getItem('claudio-user-avatar') || '')

function onUserAvatarChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    userAvatar.value = ev.target.result
    localStorage.setItem('claudio-user-avatar', ev.target.result)
  }
  reader.readAsDataURL(file)
}

// DJ Avatar Upload
const djAvatar = ref(localStorage.getItem('claudio-dj-avatar') || '')
const djAvatarInput = ref(null)

function uploadDjAvatar() {
  djAvatarInput.value?.click()
}

function onDjAvatarChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    djAvatar.value = ev.target.result
    localStorage.setItem('claudio-dj-avatar', ev.target.result)
  }
  reader.readAsDataURL(file)
}

// 自动滚动到底部
function scrollToBottom() {
  nextTick(() => {
    if (chatMessagesRef.value) {
      chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight
    }
  })
}

// 持久化聊天记录
watch(chatMessages, () => {
  localStorage.setItem('claudio-chat', JSON.stringify(chatMessages.slice(-50)))
}, { deep: true })

// 加载状态变化时滚动
watch(chatLoading, () => {
  scrollToBottom()
})

// ── Chat Resizing ──
const chatHeight = ref(280)
const isDragging = ref(false)
let startY = 0
let startHeight = 0

function initDrag(e) {
  isDragging.value = true
  startY = e.clientY
  startHeight = chatHeight.value
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
  document.body.style.cursor = 'ns-resize'
  document.body.style.userSelect = 'none'
}

function onDrag(e) {
  if (!isDragging.value) return
  const dy = startY - e.clientY // Drag UP to increase height
  let newHeight = startHeight + dy
  newHeight = Math.max(150, Math.min(newHeight, window.innerHeight - 200))
  chatHeight.value = newHeight
}

function stopDrag() {
  isDragging.value = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// ── Progress ──
const progress = reactive({ currentTime: 0, duration: 0, percent: 0 })
let progressTimer = null

function startProgressPolling() {
  stopProgressPolling()
  progressTimer = setInterval(() => {
    const p = engine.getProgress()
    progress.currentTime = p.currentTime
    progress.duration = p.duration
    progress.percent = p.percent
  }, 250)
}

function stopProgressPolling() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
}

function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

watch(() => state.status, (val) => {
  if (val === 'playing') startProgressPolling()
  else { stopProgressPolling(); progress.currentTime = 0; progress.duration = 0; progress.percent = 0 }
})

// ── Computed ──
const isPlaying = computed(() => state.status === 'playing' || state.status === 'speaking')
const statusLabel = computed(() => {
  switch (state.status) {
    case 'loading': return 'FETCHING...'
    case 'speaking': return 'SPEAKING'
    case 'playing': return 'ON AIR'
    case 'error': return 'ERROR'
    default: return 'STANDBY'
  }
})
const coverUrl = computed(() => {
  const url = state.playlist?.[state.currentIndex]?.coverUrl || state.playlist?.find(t => t.coverUrl)?.coverUrl || null
  return url ? url.replace(/^http:\/\//, 'https://') : null
})
const currentTrack = computed(() => state.playlist?.[state.currentIndex] || null)

// ── Like Song ──
const likedSongs = ref(JSON.parse(localStorage.getItem('claudio-liked') || '{}'))
const isLiked = computed(() => currentTrack.value?.songId && !!likedSongs.value[currentTrack.value.songId])

async function likeCurrentTrack() {
  const track = currentTrack.value
  if (!track?.songId) return

  const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '')
  const songId = track.songId
  const like = !likedSongs.value[songId]

  try {
    await fetch(`${API_BASE}/api/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId, like }),
    })

    likedSongs.value[songId] = like
    localStorage.setItem('claudio-liked', JSON.stringify(likedSongs.value))
    pushSystemMsg(like ? `❤️ 已红心: ${track.title}` : `💔 取消红心: ${track.title}`)
  } catch (err) {
    console.warn('[Like] 失败:', err.message)
  }
}

// ── Chat ──
function pushSystemMsg(content) {
  chatMessages.push({ role: 'system', content, ts: Date.now() })
  scrollToBottom()
}

async function sendChat() {
  const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '')
  const msg = chatInput.value.trim()
  if (!msg || chatLoading.value) return
  chatMessages.push({ role: 'user', content: msg })
  chatInput.value = ''
  chatLoading.value = true
  agentLog.length = 0
  scrollToBottom()

  try {
    // 只把 user/assistant 消息发给 LLM，过滤 system 消息
    const history = chatMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-10)

    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, history }),
    })
    const json = await res.json()

    // AI 回复
    chatMessages.push({ role: 'assistant', content: json.reply || '...', tracks: json.tracks && json.tracks.length > 0 ? json.tracks : null })
    scrollToBottom()

    // 播放 TTS 语音（异步轮询）
    if (json.djAudio) {
      // 直接有 djAudio（兼容旧逻辑）
      const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '')
      const djUrl = json.djAudio.startsWith('http') ? json.djAudio : `${API_BASE}${json.djAudio}`
      try {
        state.status = 'speaking'
        engine.ensureContext()
        await engine._playDj(djUrl)
      } catch (err) {
        console.warn('[Chat] TTS 播放失败:', err.message)
      }
    } else if (json.ttsId) {
      // 异步 TTS：轮询等待生成完成
      const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '')
      const maxWait = 30000 // 最多等 30 秒
      const start = Date.now()
      let djUrl = null

      while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 1000))
        try {
          const ttsRes = await fetch(`${API_BASE}/api/tts/${json.ttsId}`)
          const ttsData = await ttsRes.json()
          if (ttsData.status === 'ready' && ttsData.url) {
            djUrl = ttsData.url.startsWith('http') ? ttsData.url : `${API_BASE}${ttsData.url}`
            break
          }
          if (ttsData.status === 'failed') break
        } catch (_) {}
      }

      if (djUrl) {
        try {
          state.status = 'speaking'
          engine.ensureContext()
          await engine._playDj(djUrl)
        } catch (err) {
          console.warn('[Chat] TTS 播放失败:', err.message)
        }
      }
    }

    // 歌曲推入队列 → 系统消息
    if (json.tracks?.length > 0) {
      const names = json.tracks.slice(0, 3).map(t => t.title || t.songId).join(', ')
      const suffix = json.tracks.length > 3 ? ` +${json.tracks.length - 3}` : ''
      pushSystemMsg(`🎵 已加入队列: ${names}${suffix}`)
      playChatSongs(json)
    }
  } catch (err) {
    chatMessages.push({ role: 'assistant', content: `出错了: ${err.message}` })
    scrollToBottom()
  } finally {
    chatLoading.value = false
  }
}

// ── 热门评论（FloatingComments） ──
async function fetchComments(songId) {
  if (!songId || songId === _lastCommentSongId) return
  _lastCommentSongId = songId
  try {
    const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '')
    const res = await fetch(`${API_BASE}/api/comments/${songId}`)
    const data = await res.json()
    if (data.comments?.length) {
      floatingComments.value = data.comments
    }
  } catch (err) {
    console.warn('[Comments] 获取失败:', err.message)
  }
}

// ── 播放状态 → 聊天联动 + 听歌追踪 ──
let _lastTrackId = null

// 监听歌曲切换（状态变化 or 播放列表变化）
function checkTrackChange() {
  const track = state.playlist?.[state.currentIndex]
  if (track && track.songId !== _lastTrackId) {
    _lastTrackId = track.songId
    recordPlay(track.songId)
    pushSystemMsg(`🎵 正在播放: ${track.title || 'Unknown'} — ${track.artist || ''}`)
    fetchComments(track.songId)
  }
}

watch(() => state.status, (val) => {
  if (val === 'speaking') {
    pushSystemMsg('🎙 Claudio 正在说话...')
  }
  if (val === 'playing') {
    startListeningTimer()
    checkTrackChange()
  }
  if (val === 'idle' || val === 'error') {
    stopListeningTimer()
  }
})

// 监听播放列表变化（切歌时触发）
watch(() => state.playlist?.[state.currentIndex]?.songId, () => {
  if (state.status === 'playing') {
    checkTrackChange()
  }
})

// ── Volume & Seek ──
function onVolumeChange() { setVolume(volume.value) }
function onSeek(e) {
  const time = parseFloat(e.target.value)
  if (engine._musicEl && isFinite(time)) engine._musicEl.currentTime = time
}

// ── Particles ──
let particleSystem = null
function getAudioData() {
  if (!engine?.ctx) return { bass: 0, mid: 0, treble: 0 }
  return engine.getFrequencyData()
}

// ── Lifecycle ──
let weatherTimer = null

onMounted(() => {
  particleSystem = initParticleSystem('particle-canvas', getAudioData)
  // 初始化主题
  document.body.style.backgroundColor = theme.value === 'light' ? '#f0f0f5' : '#030308'

  // 天气集成
  fetchWeather()
  initWeatherParticles()
  weatherTimer = setInterval(fetchWeather, 300000) // 5分钟轮询一次
})
onUnmounted(() => {
  particleSystem?.destroy()
  stop()
  if (weatherTimer) clearInterval(weatherTimer)
})
</script>

<template>
  <div class="app dot-grid-bg" :class="theme === 'light' ? 'theme-light' : ''">
    <!-- ═══ Background Layers ═══ -->
    <canvas id="particle-canvas" />
    <div class="ambient-glow" :class="{ active: isPlaying }" />

    <!-- ═══ Floating Comments ═══ -->
    <FloatingComments :comments="floatingComments" />

    <!-- ═══ Overlay Views ═══ -->
    <Transition name="fade-scale">
      <RadioView v-if="activeCard === 'radio'" @close="activeCard = 'main'" />
    </Transition>

    <Transition name="fade">
      <div v-if="activeCard === 'profile'" class="card-backdrop" @click="activeCard = 'main'"></div>
    </Transition>
    <Transition name="fade-scale">
      <ProfileView v-if="activeCard === 'profile'" @close="activeCard = 'main'" @avatar-updated="(data) => djAvatar = data" />
    </Transition>

    <!-- ═══ Now Playing Page ═══ -->
    <NowPlayingCard
      v-if="showNowPlaying && !showSongDetail"
      @close="showNowPlaying = false"
      @show-detail="(track) => { detailSong = track; showSongDetail = true; }"
    />

    <!-- ═══ Song Detail Page ═══ -->
    <SongDetailCard
      v-if="showSongDetail"
      :song="detailSong"
      @close="showSongDetail = false"
    />

    <!-- ═══ Login Modal ═══ -->
    <Transition name="fade-scale">
      <div v-if="showLoginModal" class="login-overlay" @click.self="showLoginModal = false">
        <div class="login-card">
          <h2 class="font-dot text-2xl text-text-primary tracking-widest mb-2">LOGIN</h2>
          <p class="font-mono text-[10px] text-text-dim mb-6 tracking-wider">登录网易云音乐解锁更多功能</p>

          <!-- Quick Name Login -->
          <div class="w-full mb-4">
            <p class="font-mono text-[9px] text-text-dim mb-2 tracking-widest uppercase">快速设置昵称</p>
            <input
              v-model="loginName"
              type="text"
              placeholder="Your name..."
              class="login-input font-mono"
              @keydown.enter="handleLogin"
            />
            <button class="login-btn primary font-mono w-full mt-2" @click="handleLogin" :disabled="!loginName.trim()">SET NAME</button>
          </div>

          <div class="login-divider">
            <span class="font-mono text-[8px] text-text-muted tracking-widest">OR LOGIN WITH NETEASE</span>
          </div>

          <!-- Netease Login -->
          <div class="w-full">
            <input
              v-model="loginPhone"
              type="tel"
              placeholder="手机号"
              class="login-input font-mono"
            />
            <input
              v-model="loginPassword"
              type="password"
              placeholder="密码"
              class="login-input font-mono mt-2"
              @keydown.enter="handleNeteaseLogin"
            />
            <p v-if="loginError" class="font-mono text-[10px] text-neon-pink mt-2">{{ loginError }}</p>
            <button class="login-btn primary font-mono w-full mt-3" @click="handleNeteaseLogin" :disabled="loginLoading">
              {{ loginLoading ? '登录中...' : 'LOGIN' }}
            </button>
          </div>

          <button class="login-btn secondary font-mono w-full mt-3" @click="showLoginModal = false">CANCEL</button>
        </div>
      </div>
    </Transition>

    <!-- ═══ Dashboard (Main View) ═══ -->
    <main class="dashboard">

      <!-- ── Header: Top Bar ── -->
      <header class="top-bar">
        <div class="logo-row hover-glow" @click="activeCard = 'radio'">
          <div class="logo-glyph overflow-hidden p-0.5"><img src="https://api.dicebear.com/7.x/bottts/svg?seed=Claudio" class="w-full h-full opacity-80 mix-blend-screen" /></div>
          <span class="font-mono text-text-primary tracking-[0.3em] text-sm uppercase">Claudio</span>
        </div>
        <div class="flex items-center gap-2.5 font-mono text-[8px] tracking-[0.1em] text-text-dim uppercase flex-shrink-0">
          <div class="px-[14px] py-[6px] rounded-full border border-white/10 cursor-pointer hover-glow flex items-center justify-center transition-all duration-300 whitespace-nowrap flex-shrink-0" @click="showLoginModal = true">
            <span>{{ user.loggedIn ? user.name.toUpperCase() : 'LOGIN' }}</span>
          </div>

          <!-- Theme Toggle Switch -->
          <div class="theme-toggle" @click="toggleTheme(theme === 'dark' ? 'light' : 'dark')" :title="theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'">
            <div class="theme-toggle-track" :class="{ 'light': theme === 'light' }">
              <div class="theme-toggle-thumb" :class="{ 'light': theme === 'light' }">
                <span class="theme-icon">{{ theme === 'dark' ? '🌙' : '☀️' }}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <!-- ── Huge Clock Area ── -->
      <section class="clock-area mt-4">
        <!-- 方案 B：天气全息氛围光环 -->
        <div class="weather-glow-halo" :class="weatherThemeClass"></div>

        <!-- 天气粒子效果（雨雪天气限定） -->
        <div class="weather-particles-container" v-if="showParticles">
          <div
            v-for="p in weatherParticles"
            :key="p.id"
            class="weather-particle"
            :class="particleClass"
            :style="p.style"
          ></div>
        </div>

        <div class="huge-clock font-dot text-center leading-none">
          {{ hours }}&nbsp;&nbsp;{{ minutes }}
        </div>
        <div class="clock-sub font-mono flex flex-col items-center gap-1.5 mt-2">
          <span class="text-text-primary text-sm font-bold tracking-widest">{{ weekdayName }}</span>
          <span class="text-text-dim text-[10px] tracking-widest uppercase">{{ dateString }}</span>

          <!-- 极简天气状态行 -->
          <div class="weather-status-line flex items-center gap-1.5 mt-0.5 font-mono text-[9px] tracking-widest text-text-dim uppercase">
            <span>{{ weatherInfo.city }}</span>
            <span>/</span>
            <span class="text-text-primary">{{ weatherInfo.temp }}°C</span>
            <span>/</span>
            <span :class="weatherTextClass">{{ weatherInfo.description || weatherInfo.condition }}</span>
          </div>

          <div class="flex items-center gap-1.5 mt-1.5" v-if="isPlaying">
            <span class="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse shadow-[0_0_8px_rgba(0,255,65,0.6)]"></span>
            <span class="text-neon-green text-[9px] tracking-widest uppercase">{{ statusLabel }}</span>
          </div>
          <div class="flex items-center gap-1.5 mt-1.5" v-else>
            <span class="w-1.5 h-1.5 rounded-full bg-text-dim"></span>
            <span class="text-text-dim text-[9px] tracking-widest uppercase">STANDBY</span>
          </div>
        </div>
      </section>

      <!-- ── Ultra Compact Player (Ref 2) ── -->
      <section class="ultra-compact-player mt-6">
        <div class="player-main flex items-center justify-between w-full mb-3 gap-1">
          <div class="track-info flex items-center gap-1.5 flex-1 min-w-0">
            <div class="w-4 h-4 flex items-end gap-[2px] flex-shrink-0">
              <div
                class="w-[3px] rounded-t-sm transition-all duration-300"
                :class="isPlaying
                  ? 'bg-neon-green animate-bounce h-full'
                  : 'bg-text-dim h-1/3'"
                :style="isPlaying ? 'animation-duration: 0.5s' : ''"
              ></div>
              <div
                class="w-[3px] rounded-t-sm transition-all duration-300"
                :class="isPlaying
                  ? 'bg-neon-green animate-bounce h-1/2'
                  : 'bg-text-dim h-1/2'"
                :style="isPlaying ? 'animation-duration: 0.7s' : ''"
              ></div>
              <div
                class="w-[3px] rounded-t-sm transition-all duration-300"
                :class="isPlaying
                  ? 'bg-neon-green animate-bounce h-3/4'
                  : 'bg-text-dim h-2/3'"
                :style="isPlaying ? 'animation-duration: 0.6s' : ''"
              ></div>
            </div>
            <div class="flex flex-col min-w-0 cursor-pointer hover-glow" @click="showNowPlaying = true">
              <span class="font-sans text-[11px] sm:text-sm font-bold text-text-primary leading-tight truncate">{{ currentTrack?.title || 'Waiting' }}</span>
              <span class="font-mono text-[9px] text-text-dim tracking-widest truncate mt-0.5">{{ currentTrack?.artist || 'DJ' }}</span>
            </div>
          </div>
          
          <div class="playback-controls flex items-center justify-center gap-1.5 sm:gap-2 text-text-primary flex-shrink-0">
            <!-- Prev -->
            <button class="player-btn" @click="prev" :disabled="state.status === 'idle'">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>
            </button>
            <!-- Play/Pause -->
            <button class="player-btn" @click="toggle" :class="{ 'border-neon-green/50 text-neon-green': isPlaying }">
              <svg v-if="isPlaying" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
              <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ml-[2px]"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </button>
            <!-- Next -->
            <button class="player-btn" @click="next">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>
            </button>
            <!-- Stop -->
            <button class="player-btn opacity-60 hover:opacity-100">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
            </button>
            <!-- Favorite -->
            <button class="player-btn opacity-60 hover:opacity-100" @click="likeCurrentTrack" :class="{ 'text-neon-pink': isLiked }">
              <svg width="10" height="10" viewBox="0 0 24 24" :fill="isLiked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            </button>
          </div>

          <div class="extra-controls font-mono text-[8px] tracking-[0.05em] text-text-dim flex items-center justify-end gap-1 flex-1 min-w-0">
            <button class="player-btn-pill flex-shrink-0 hidden sm:block">HIDE</button>
            <button class="player-btn-pill flex-shrink-0">FAV</button>
            <div class="flex items-center gap-1 ml-0.5 min-w-0">
              <span class="flex-shrink-0">VOL</span>
              <input type="range" min="0" max="100" v-model="volume" @input="onVolumeChange" class="vol-slider-micro w-6 sm:w-8" />
            </div>
          </div>
        </div>

        <div class="progress-area flex items-center justify-between gap-3 mt-3 w-full">
          <span class="font-mono text-[8px] text-text-dim w-6 text-right">{{ formatTime(progress.currentTime) }}</span>
          <input type="range" min="0" :max="progress.duration || 0" :value="progress.currentTime" @input="onSeek" class="progress-slider-micro flex-1" step="0.1" />
          <span class="font-mono text-[8px] text-text-dim w-6">{{ formatTime(progress.duration) }}</span>
        </div>
      </section>

      <!-- ── Dividers & Queue (多首歌时显示) ── -->
      <div class="dividers font-mono mt-5" v-if="radio.state.playlist.length > 1">
        <div class="flex justify-between items-center py-2.5 border-y border-white/10 text-text-dim text-[9px] tracking-[0.15em]">
          <span>QUEUE</span>
          <span>{{ radio.state.playlist.length }} TRACKS</span>
        </div>

        <div class="queue-list max-h-[160px] overflow-y-auto my-1 flex flex-col gap-1 pr-1">
          <div
            v-for="(track, index) in radio.state.playlist"
            :key="track.songId || index"
            class="flex justify-between items-center px-2 py-2 rounded-[4px] cursor-pointer transition-colors"
            :class="isPlaying && index === state.currentIndex ? 'bg-neon-green/10 text-neon-green' : 'hover:bg-white/5 text-text-dim'"
            @click="radio.playTrack(track)"
          >
            <div class="flex items-center gap-3 flex-1 overflow-hidden">
              <span class="text-[9px] w-3 flex-shrink-0" v-if="!(isPlaying && index === state.currentIndex)">{{ index + 1 }}</span>
              <span class="text-[9px] w-3 flex-shrink-0 text-center" v-else>▶</span>
              <span class="text-xs font-sans font-bold truncate" :class="isPlaying && index === state.currentIndex ? 'text-neon-green' : 'text-text-primary'">
                {{ track.title || track.songId }}
              </span>
            </div>
            <span class="text-[9px] opacity-60 truncate max-w-[40%] text-right ml-3">{{ track.artist || '' }}</span>
          </div>
        </div>

        <div class="flex justify-between items-center py-2.5 border-b border-white/10 text-[9px] tracking-[0.15em]">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse shadow-[0_0_8px_rgba(0,255,65,0.6)]"></span>
            <span class="text-text-primary text-[10px]">Claudio</span>
          </div>
          <span class="text-neon-green">LIVE</span>
        </div>
      </div>

      <!-- ── Unified Chat Section ── -->
      <div class="chat-container flex-1 min-h-0 flex flex-col relative mt-2">
        <div class="chat-messages flex-1 overflow-y-auto pr-2 pb-4" ref="chatMessagesRef">
          <div class="text-center font-mono text-[9px] text-text-dim mb-4 tracking-widest opacity-60">
            Connected to Claudio server
          </div>
          <template v-for="(msg, i) in chatMessages" :key="i">
            <div :class="['chat-bubble', msg.role]">
              <!-- System Message -->
              <template v-if="msg.role === 'system'">
                <div class="system-msg font-mono">
                  <span>{{ msg.content }}</span>
                </div>
              </template>
              <!-- AI Bubble -->
              <template v-else-if="msg.role === 'assistant'">
                <div class="bubble-avatar ai cursor-pointer hover-glow" @click="activeCard = 'profile'">
                  <img v-if="djAvatar" :src="djAvatar" class="w-full h-full object-cover rounded-[6px]" alt="DJ">
                  <span v-else>🐱</span>
                </div>
                <div class="bubble-content ai-bubble">
                  <span class="bubble-name font-mono">CLAUDIO</span>
                  <p class="bubble-text">{{ msg.content }}</p>
                  <button class="replay-btn font-mono" v-if="i === chatMessages.length - 1 && !msg.tracks" @click="() => { activeCard = 'radio'; if (state.status === 'idle') toggle() }">
                    ▶ REPLAY
                  </button>
                </div>
              </template>
              <!-- User Bubble -->
              <template v-else>
                <div class="bubble-content user-bubble">
                  <p class="bubble-text">{{ msg.content }}</p>
                </div>
                <label class="bubble-avatar user cursor-pointer">
                  <img v-if="userAvatar" :src="userAvatar" class="w-full h-full object-cover rounded-[6px]" alt="User">
                  <span v-else>🐶</span>
                  <input type="file" accept="image/*" class="hidden" @change="onUserAvatarChange">
                </label>
              </template>
            </div>

            <!-- Track List (right after AI message) -->
            <div v-if="msg.role === 'assistant' && msg.tracks && msg.tracks.length" class="chat-track-list">
              <div v-for="(track, tidx) in msg.tracks" :key="tidx"
                   class="chat-track-item"
                   :class="(state.playlist?.[state.currentIndex]?.songId === track.songId) ? 'active' : ''"
                   @click="playTrack(track)">
                <span class="chat-track-icon" v-if="(state.playlist?.[state.currentIndex]?.songId === track.songId)">▶</span>
                <div class="chat-track-info">
                  <span class="chat-track-title">{{ track.title || track.songId }}</span>
                  <span class="chat-track-artist">{{ track.artist || 'Unknown' }}</span>
                </div>
              </div>
            </div>
          </template>

          <!-- Loading -->
          <div v-if="chatLoading" class="chat-bubble assistant">
            <div class="bubble-avatar ai cursor-pointer hover-glow" @click="activeCard = 'profile'">
              <img v-if="djAvatar" :src="djAvatar" class="w-full h-full object-cover rounded-[6px]" alt="DJ">
              <span v-else>🐱</span>
            </div>
            <div class="bubble-content ai-bubble">
              <span class="bubble-name font-mono">CLAUDIO</span>
              <div class="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>

          <!-- DJ Speaking Indicator -->
          <div v-if="state.status === 'speaking'" class="chat-bubble assistant">
            <div class="bubble-avatar ai cursor-pointer hover-glow" @click="activeCard = 'profile'">
              <img v-if="djAvatar" :src="djAvatar" class="w-full h-full object-cover rounded-[6px]" alt="DJ">
              <span v-else>🐱</span>
            </div>
            <div class="bubble-content ai-bubble">
              <span class="bubble-name font-mono">CLAUDIO</span>
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-neon-green animate-pulse"></span>
                <span class="text-neon-green text-[11px] font-mono">正在说话...</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Bottom Input Bar ── -->
        <div class="chat-input-area mt-auto pt-2">
          <div class="chat-input-pill-container relative flex items-center bg-[#111115] border border-white/5 rounded-2xl px-5 py-[14px] shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
            <input
              v-model="chatInput"
              type="text"
              placeholder="Say something to the DJ..."
              class="chat-input-pill w-full bg-transparent text-text-primary text-xs font-mono outline-none py-1 leading-normal"
              @keydown.enter="sendChat"
              :disabled="chatLoading"
            />
            <div class="flex items-center gap-2 ml-2">
              <!-- Clear Chat -->
              <button class="icon-btn hover-glow opacity-40 hover:opacity-100" @click="chatMessages.length = 0" title="Clear chat">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
              <!-- Send -->
              <button class="icon-btn hover-glow bg-white/10 rounded-full p-1.5" @click="sendChat" :class="{ 'opacity-50': chatLoading }">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
              </button>
            </div>
          </div>
          <div class="flex justify-between items-center px-2 mt-4 text-[8px] font-mono tracking-widest text-text-dim/60 uppercase">
            <span>Claudio FM</span>
            <span>Connected</span>
          </div>
        </div>
      </div>

    </main>
  </div>
</template>

<style scoped>
/* ── Layout ── */
body { margin: 0; padding: 0; background-color: #030308; overflow: hidden; }
#app { width: 100vw; height: 100vh; overflow: hidden; }
.app { min-height: 100vh; min-height: 100dvh; display: flex; justify-content: center; position: relative; z-index: 2; padding: 20px; }
#particle-canvas { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }
.ambient-glow { position: fixed; top: -20%; left: 50%; transform: translateX(-50%); width: 600px; height: 600px; border-radius: 50%; background: radial-gradient(circle, rgba(0, 240, 255, 0.08) 0%, transparent 70%); opacity: 0.3; transition: opacity 2s ease; pointer-events: none; z-index: 1; }
.ambient-glow.active { opacity: 0.7; animation: ambient-breathe 5s ease-in-out infinite; }
@keyframes ambient-breathe { 0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.5; } 50% { transform: translateX(-50%) scale(1.1); opacity: 0.8; } }

.dashboard { width: 100%; max-width: 520px; height: 95vh; max-height: 900px; padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 20px; position: relative; z-index: 3; background: rgba(6, 6, 14, 0.8); border-radius: 24px; box-shadow: inset 0 0 80px rgba(138, 43, 226, 0.25), inset 0 0 160px rgba(138, 43, 226, 0.12), 0 0 40px rgba(0, 240, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.05); overflow: hidden; }

/* ── Top Bar ── */
.top-bar { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.logo-row { display: flex; align-items: center; gap: 10px; }
.logo-glyph { width: 28px; height: 28px; border-radius: 6px; background: linear-gradient(135deg, #00f0ff, #bd00ff); display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 14px; font-weight: 900; color: #06060e; filter: drop-shadow(0 0 6px rgba(0, 240, 255, 0.4)); }
.status-indicator { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: #3a3a4e; transition: all 0.3s; }
.status-indicator.live .status-dot { background: #00ff41; box-shadow: 0 0 6px rgba(0, 255, 65, 0.6); animation: blink 1.2s infinite; }
.status-indicator.live .status-label { color: #00ff41; }

/* ── Clock Area ── */
.clock-area { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: 10px; padding: 15px 0; overflow: visible; }
.huge-clock { position: relative; z-index: 2; font-size: 80px; line-height: 1; color: #e8e8ec; text-shadow: 0 0 20px rgba(255, 255, 255, 0.1), 0 0 40px rgba(0, 240, 255, 0.1); letter-spacing: 0.05em; }
.huge-clock .colon { color: #00f0ff; text-shadow: 0 0 15px rgba(0, 240, 255, 0.4); margin: 0 -4px; transition: opacity 0.3s; }
.huge-clock .colon.dim { opacity: 0.2; }
.clock-sub { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.8; }

/* ── Weather option B: Hologram Glow Halo ── */
.weather-glow-halo {
  position: absolute;
  top: 45%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 210px;
  height: 95px;
  border-radius: 50%;
  filter: blur(35px);
  z-index: 1;
  opacity: 0.42;
  pointer-events: none;
  transition: all 1.5s ease-in-out;
}

/* Sunny Weather: Warm Orange/Magenta */
.weather-glow-halo.weather-sunny {
  background: radial-gradient(circle, rgba(255, 110, 0, 0.7) 0%, rgba(189, 0, 255, 0.35) 60%, transparent 100%);
  animation: weather-breath-sunny 6s infinite ease-in-out;
}
@keyframes weather-breath-sunny {
  0%, 100% { opacity: 0.42; transform: translate(-50%, -50%) scale(1); filter: blur(35px); }
  50% { opacity: 0.58; transform: translate(-50%, -50%) scale(1.15); filter: blur(38px); }
}

/* Rainy Weather: Cyber Cyan/Deep Blue */
.weather-glow-halo.weather-rainy {
  background: radial-gradient(circle, rgba(0, 240, 255, 0.65) 0%, rgba(0, 50, 180, 0.35) 65%, transparent 100%);
  animation: weather-breath-rainy 4s infinite ease-in-out;
}
@keyframes weather-breath-rainy {
  0%, 100% { opacity: 0.38; transform: translate(-50%, -50%) scale(1); filter: blur(35px); }
  50% { opacity: 0.52; transform: translate(-50%, -50%) scale(1.08); filter: blur(32px); }
}

/* Storm Weather: Deep Violet/Dark Indigo with Lightning */
.weather-glow-halo.weather-storm {
  background: radial-gradient(circle, rgba(189, 0, 255, 0.7) 0%, rgba(0, 20, 120, 0.4) 70%, transparent 100%);
  animation: weather-breath-storm 5s infinite ease-in-out, storm-lightning 8s infinite;
}
@keyframes weather-breath-storm {
  0%, 100% { transform: translate(-50%, -50%) scale(1); }
  50% { transform: translate(-50%, -50%) scale(1.1); }
}
@keyframes storm-lightning {
  0%, 92%, 94%, 98%, 100% { opacity: 0.38; filter: blur(35px); }
  93%, 97% { opacity: 0.92; filter: blur(28px) brightness(1.6); }
}

/* Snowy Weather: Icy Cyan/Silver White */
.weather-glow-halo.weather-snowy {
  background: radial-gradient(circle, rgba(220, 245, 255, 0.65) 0%, rgba(90, 120, 180, 0.3) 65%, transparent 100%);
  animation: weather-breath-snowy 7s infinite ease-in-out;
}
@keyframes weather-breath-snowy {
  0%, 100% { opacity: 0.38; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.52; transform: translate(-50%, -50%) scale(1.12); }
}

/* Misty/Fog Weather: Soft Grey/Milk White */
.weather-glow-halo.weather-misty {
  background: radial-gradient(circle, rgba(160, 160, 180, 0.5) 0%, rgba(70, 70, 90, 0.25) 75%, transparent 100%);
  filter: blur(45px);
  animation: weather-breath-misty 10s infinite ease-in-out;
}
@keyframes weather-breath-misty {
  0%, 100% { opacity: 0.32; transform: translate(-50%, -50%) scale(1); filter: blur(45px); }
  50% { opacity: 0.42; transform: translate(-50%, -50%) scale(1.05); filter: blur(50px); }
}

/* Cloudy Weather: Muted Slate Blue/Dim Purple (Default) */
.weather-glow-halo.weather-cloudy {
  background: radial-gradient(circle, rgba(120, 135, 160, 0.5) 0%, rgba(75, 45, 115, 0.25) 70%, transparent 100%);
  animation: weather-breath-cloudy 8s infinite ease-in-out;
}
@keyframes weather-breath-cloudy {
  0%, 100% { opacity: 0.32; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.45; transform: translate(-50%, -50%) scale(1.1); }
}

/* ── Weather Particles ── */
.weather-particles-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
  z-index: 1;
  border-radius: 16px;
}
.weather-particle {
  position: absolute;
  pointer-events: none;
}
.particle-rain {
  width: 1px;
  height: 8px;
  background: linear-gradient(to bottom, transparent, rgba(0, 240, 255, 0.5));
  animation: rain-fall linear infinite;
}
.particle-snow {
  width: 3px;
  height: 3px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 50%;
  filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.4));
  animation: snow-fall linear infinite;
}
@keyframes rain-fall {
  0% { transform: translateY(-10px) translateX(0); }
  100% { transform: translateY(180px) translateX(8px); }
}
@keyframes snow-fall {
  0% { transform: translateY(-10px) translateX(0); }
  50% { transform: translateY(90px) translateX(6px); }
  100% { transform: translateY(180px) translateX(-4px); }
}

/* Neon Weather Highlight Texts */
.text-neon-orange {
  color: #ff8400;
  text-shadow: 0 0 6px rgba(255, 132, 0, 0.4);
}
.text-neon-cyan {
  color: #00f0ff;
  text-shadow: 0 0 6px rgba(0, 240, 255, 0.4);
}
.text-neon-purple {
  color: #bd00ff;
  text-shadow: 0 0 6px rgba(189, 0, 255, 0.4);
}
.text-neon-blue {
  color: #0084ff;
  text-shadow: 0 0 6px rgba(0, 132, 255, 0.4);
}

/* ── DJ Profile ── */
.dj-profile-panel { padding: 0 8px; }
.dj-header { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
.dj-avatar { width: 64px; height: 64px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(0, 240, 255, 0.2); font-size: 32px; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 20px rgba(0, 240, 255, 0.05), 0 0 15px rgba(0, 240, 255, 0.1); }
.dj-bio { margin-bottom: 16px; }
.dj-stats { display: flex; gap: 16px; border-top: 1px solid rgba(255, 255, 255, 0.05); border-bottom: 1px solid rgba(255, 255, 255, 0.05); padding: 12px 0; margin-bottom: 16px; }
.stat-item { display: flex; flex-direction: column; gap: 2px; }
.stat-item .label { font-size: 8px; letter-spacing: 0.15em; color: #5a5a6e; }
.stat-item .val { font-size: 14px; color: #e8e8ec; font-weight: bold; }
.dj-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { font-family: var(--font-mono); font-size: 9px; padding: 4px 10px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.08); color: #a0a0b0; background: rgba(255, 255, 255, 0.02); text-transform: uppercase; letter-spacing: 0.05em; transition: all 0.2s; }
.tag:hover { border-color: #00f0ff; color: #00f0ff; background: rgba(0, 240, 255, 0.05); }

/* ── Ultra Compact Player (Ref 2) ── */
.ultra-compact-player { padding: 0 8px; }

.player-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a0a0b0;
  cursor: pointer;
  transition: all 0.2s;
}
.player-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.2);
}
.player-btn-pill {
  padding: 3px 6px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  color: #a0a0b0;
  cursor: pointer;
  transition: all 0.2s;
}
.player-btn-pill:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}
.player-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.vol-slider-micro { width: 40px; height: 2px; -webkit-appearance: none; appearance: none; background: rgba(255, 255, 255, 0.15); outline: none; border-radius: 1px; }
.vol-slider-micro::-webkit-slider-thumb { -webkit-appearance: none; width: 8px; height: 8px; border-radius: 50%; background: #e8e8ec; cursor: pointer; transition: transform 0.1s; }
.progress-area { width: 100%; }
.progress-slider-micro { width: 100%; height: 1px; -webkit-appearance: none; appearance: none; background: rgba(255, 255, 255, 0.15); outline: none; cursor: pointer; }
.progress-slider-micro::-webkit-slider-thumb { -webkit-appearance: none; width: 6px; height: 6px; border-radius: 50%; background: #e8e8ec; cursor: pointer; transition: transform 0.1s; }
.progress-slider-micro::-webkit-slider-thumb:hover { transform: scale(1.5); }

/* ── Chat Flow (Dark) ── */
.chat-messages { display: flex; flex-direction: column; gap: 16px; padding: 24px 8px 12px; overflow-y: auto; flex: 1; }
.chat-bubble { display: flex; gap: 12px; align-items: flex-start; }
.chat-bubble.user { flex-direction: row; align-items: flex-start; justify-content: flex-end; }
.bubble-avatar { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; overflow: hidden; }
.bubble-avatar.ai { background: rgba(0, 240, 255, 0.1); border: 1px solid rgba(0, 240, 255, 0.2); }
.bubble-avatar.user { background: rgba(0, 240, 255, 0.08); border: 1px solid rgba(0, 240, 255, 0.15); }
.bubble-content { max-width: 80%; padding: 12px 14px; border-radius: 12px; font-size: 13px; line-height: 1.6; }
.ai-bubble { background: rgba(12, 12, 24, 0.6); border: 1px solid rgba(255, 255, 255, 0.05); color: #e8e8ec; border-bottom-left-radius: 4px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02); }
.user-bubble { background: rgba(0, 240, 255, 0.1); border: 1px solid rgba(0, 240, 255, 0.15); color: #e8e8ec; border-bottom-right-radius: 4px; }
.bubble-name { display: block; font-size: 9px; color: #00f0ff; margin-bottom: 4px; letter-spacing: 0.1em; }
.bubble-text { word-wrap: break-word; white-space: pre-wrap; }
.typing-indicator span { display: inline-block; width: 4px; height: 4px; background: #00f0ff; border-radius: 50%; margin-right: 4px; animation: bounce 1.4s infinite ease-in-out both; }
.typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
.typing-indicator span:nth-child(2) { animation-delay: -0.16s; }
@keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
.agent-log-line { padding-left: 40px; margin-top: -8px; opacity: 0.7; }

/* ── Chat Track List (outside bubble) ── */
.chat-track-list {
  display: inline-flex;
  flex-direction: column;
  gap: 1px;
  margin: -8px 0 8px 0;
  padding: 4px;
  background: rgba(0, 240, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  width: fit-content;
  max-width: 65%;
}

.chat-track-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.chat-track-item:hover {
  background: rgba(0, 255, 65, 0.1);
  box-shadow: 0 0 12px rgba(0, 255, 65, 0.15);
}

.chat-track-item.active {
  background: rgba(0, 255, 65, 0.1);
}

.chat-track-icon {
  font-size: 8px;
  color: #00ff41;
  flex-shrink: 0;
}

.chat-track-icon.dim {
  display: none;
}

.chat-track-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.chat-track-title {
  font-size: 11px;
  font-weight: 600;
  color: #e8e8ec;
  white-space: nowrap;
}

.chat-track-artist {
  font-size: 9px;
  color: #5a5a6e;
  font-family: var(--font-mono);
  white-space: nowrap;
}

/* ── System Messages ── */
.system-msg {
  width: 100%;
  text-align: center;
  font-size: 10px;
  color: #5a5a6e;
  padding: 4px 12px;
  letter-spacing: 0.05em;
  opacity: 0.7;
}
.system-msg span {
  background: rgba(255, 255, 255, 0.03);
  padding: 3px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.icon-btn { color: #a0a0b0; display: flex; align-items: center; justify-content: center; background: transparent; border: none; cursor: pointer; }
.icon-btn:hover { color: #fff; }

@keyframes blink { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

/* ── Light Theme Overrides ── */
.theme-light.dot-grid-bg { background-image: radial-gradient(#d0d0d5 1px, transparent 1px); }
.theme-light .dashboard { background: rgba(245, 245, 250, 0.85); border-color: rgba(0, 0, 0, 0.1); box-shadow: inset 0 0 60px rgba(138, 43, 226, 0.08), inset 0 0 120px rgba(138, 43, 226, 0.04), 0 0 40px rgba(0, 240, 255, 0.05); }
.theme-light .text-text-primary { color: #111111; }
.theme-light .text-text-dim { color: #888888; }
.theme-light .bg-text-primary { background-color: #111111; color: #ffffff !important; }
.theme-light .border-white\/10 { border-color: rgba(0, 0, 0, 0.1) !important; }
.theme-light .hover\:bg-white\/5:hover { background-color: rgba(0, 0, 0, 0.05); }

/* Clock */
.theme-light .huge-clock { color: #111111; text-shadow: 0 0 20px rgba(0, 0, 0, 0.05); }
.theme-light .clock-sub .text-text-primary { color: #111111; }
.theme-light .clock-sub .text-text-dim { color: #888888; }

/* Status indicators */
.theme-light .text-neon-green { color: #00aa30; }
.theme-light .bg-neon-green { background-color: #00aa30; }
.theme-light .shadow-\[0_0_8px_rgba\(0\,255\,65\,0\.6\)\] { box-shadow: 0 0 8px rgba(0, 170, 48, 0.4); }

/* Queue & Dividers */
.theme-light .dividers .border-white\/10 { border-color: rgba(0, 0, 0, 0.08) !important; }
.theme-light .queue-list .text-text-dim { color: #666666; }
.theme-light .queue-list .text-text-primary { color: #111111; }
.theme-light .queue-list .bg-neon-green\/10 { background-color: rgba(0, 170, 48, 0.1); }

.theme-light .player-btn,
.theme-light .player-btn-pill,
.theme-light .login-pill,
.theme-light .theme-pill {
  border-color: rgba(0, 0, 0, 0.15);
  color: #555;
}
.theme-light .player-btn:hover:not(:disabled),
.theme-light .player-btn-pill:hover,
.theme-light .login-pill:hover {
  background-color: rgba(0, 0, 0, 0.05);
  color: #111;
}

.theme-light .user-bubble { background: #e8e8ec; color: #111111; }
.theme-light .ai-bubble { background: #ffffff; color: #111111; border: 1px solid rgba(0, 0, 0, 0.05); }
.theme-light .bubble-avatar.user { background: rgba(0, 0, 0, 0.06); border-color: rgba(0, 0, 0, 0.1); }
.theme-light .bubble-avatar.ai { background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.08); }
.theme-light .vol-slider-micro { background: rgba(0, 0, 0, 0.15); }
.theme-light .progress-slider-micro { background: rgba(0, 0, 0, 0.15); }
.theme-light .progress-slider-micro::-webkit-slider-thumb { background: #111111; }
.theme-light .progress-times .text-text-dim { color: #888888; }
.theme-light .extra-controls .text-text-dim { color: #888888; }

/* System messages */
.theme-light .system-msg { color: #888888; }
.theme-light .system-msg span { background: rgba(0, 0, 0, 0.03); border-color: rgba(0, 0, 0, 0.05); }

/* Agent log */
.theme-light .agent-log-line .text-text-dim { color: #888888; }

/* Chat input */
.theme-light .logo-glyph img { filter: invert(1); mix-blend-mode: normal; opacity: 0.9; }
.theme-light .chat-input-pill-container { background-color: rgba(0, 0, 0, 0.04) !important; border-color: rgba(0, 0, 0, 0.08) !important; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05) !important; }
.theme-light .chat-input-pill { color: #111111 !important; }
.theme-light .chat-input-pill::placeholder { color: #888888 !important; }
.theme-light .chat-input-pill-container .icon-btn { color: #555555 !important; }
.theme-light .chat-input-pill-container .icon-btn:hover { color: #111111 !important; }
.theme-light .chat-input-pill-container .icon-btn.bg-white\/10 { background-color: rgba(0, 0, 0, 0.08) !important; color: #111111 !important; }
.theme-light .chat-input-pill-container .icon-btn.bg-white\/10:hover { background-color: rgba(0, 0, 0, 0.15) !important; }

/* Chat Track List - Light Theme */
.theme-light .chat-track-list { background: rgba(0, 0, 0, 0.02); border-color: rgba(0, 0, 0, 0.06); }
.theme-light .chat-track-item:hover { background: rgba(0, 120, 255, 0.1); box-shadow: 0 0 12px rgba(0, 120, 255, 0.2); }
.theme-light .chat-track-item.active { background: rgba(0, 170, 48, 0.1); }
.theme-light .chat-track-icon { color: #00aa30; }
.theme-light .chat-track-title { color: #111111; }
.theme-light .chat-track-artist { color: #888888; }

/* ── Theme Toggle Switch ── */
.theme-toggle {
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.theme-toggle-track {
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  position: relative;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.theme-toggle-track.light {
  background: rgba(0, 0, 0, 0.08);
  border-color: rgba(0, 0, 0, 0.12);
}

.theme-toggle-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #1a1a2e;
  border: 1px solid rgba(255, 255, 255, 0.15);
  position: absolute;
  top: 1px;
  left: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.theme-toggle-thumb.light {
  left: 21px;
  background: #ffffff;
  border-color: rgba(0, 0, 0, 0.1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.theme-icon {
  font-size: 11px;
  line-height: 1;
}

.theme-toggle:hover .theme-toggle-track {
  border-color: rgba(0, 240, 255, 0.3);
}

.theme-toggle:hover .theme-toggle-track.light {
  border-color: rgba(0, 0, 0, 0.2);
}

/* ── Card Backdrop ── */
.card-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 99;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ── Scrollbar - Dark ── */
::-webkit-scrollbar { width: 3px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.08); border-radius: 2px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.15); }

/* ── Scrollbar - Light ── */
.theme-light ::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.1); }
.theme-light ::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.2); }

/* ── Interactive Elements ── */
.hover-glow {
  cursor: pointer;
  transition: all 0.2s;
}
.hover-glow:hover {
  filter: drop-shadow(0 0 12px rgba(0, 240, 255, 0.6));
}

/* ── Chat Flow (Dark) ── */
.chat-messages { display: flex; flex-direction: column; gap: 16px; padding: 24px 8px 12px; overflow-y: auto; flex: 1; }

.replay-btn {
  margin-top: 8px;
  background: rgba(255, 95, 87, 0.1);
  border: 1px solid rgba(255, 95, 87, 0.3);
  color: #ff5f57;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 9px;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-block;
}
.replay-btn:hover {
  background: rgba(255, 95, 87, 0.2);
  box-shadow: 0 0 10px rgba(255, 95, 87, 0.3);
}

/* ── Vue Transitions ── */
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

/* ── Login Modal ── */
.login-overlay {
  position: fixed;
  inset: 0;
  background: rgba(6, 6, 14, 0.85);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.login-card {
  width: 100%;
  max-width: 320px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  padding: 36px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}
.login-input {
  width: 100%;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: #e8e8ec;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}
.login-input:focus {
  border-color: rgba(0, 240, 255, 0.4);
}
.login-input::placeholder {
  color: #3a3a4e;
}
.login-btn {
  flex: 1;
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 10px;
  letter-spacing: 0.15em;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}
.login-btn.primary {
  background: #00f0ff;
  color: #06060e;
}
.login-btn.primary:hover:not(:disabled) {
  box-shadow: 0 0 16px rgba(0, 240, 255, 0.4);
}
.login-btn.primary:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.login-btn.secondary {
  background: rgba(255, 255, 255, 0.05);
  color: #5a5a6e;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.login-btn.secondary:hover {
  border-color: rgba(255, 255, 255, 0.15);
  color: #e8e8ec;
}

.login-divider {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0;
}

.login-divider::before,
.login-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
}

@media (display-mode: standalone) { .dashboard { padding-top: 32px; } }
</style>
