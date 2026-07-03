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
const { state, engine, start, startFromArsenal, stop, toggle, prev, next, setVolume, playChatSongs, playTrack, playTrackByIndex } = radio
provide('radio', radio)

const userCtx = useUser()
const { user, stats, listeningHours, uniqueSongsPlayed, level, login, loginWithUid, loginWithToken, logout, recordPlay, addFavorite, startListeningTimer, stopListeningTimer } = userCtx
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
  const isRain = weatherThemeClass.value === 'weather-rainy' || weatherThemeClass.value === 'weather-storm'
  const isStorm = weatherThemeClass.value === 'weather-storm'
  const count = isStorm ? 80 : isRain ? 50 : 25

  for (let i = 0; i < count; i++) {
    const isHeavy = Math.random() > 0.5
    list.push({
      id: i,
      style: {
        left: `${Math.random() * 100}%`,
        top: `${-5 - Math.random() * 15}px`,
        animationDelay: `${Math.random() * 3}s`,
        animationDuration: isRain
          ? `${0.6 + Math.random() * 0.5}s`
          : `${4 + Math.random() * 5}s`,
        opacity: isRain
          ? `${isHeavy ? 0.6 + Math.random() * 0.3 : 0.3 + Math.random() * 0.3}`
          : `${0.5 + Math.random() * 0.4}`,
        height: isRain
          ? `${isHeavy ? 25 + Math.random() * 15 : 12 + Math.random() * 10}px`
          : 'auto',
        width: isRain
          ? `${isHeavy ? 2 : 1}px`
          : `${isHeavy ? 5 + Math.random() * 3 : 3 + Math.random() * 2}px`,
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

const weatherEmoji = computed(() => {
  const cond = weatherInfo.value.condition;
  if (!cond) return '☁️';
  if (cond.includes('晴')) return '☀️';
  if (cond.includes('雨')) {
    if (cond.includes('雷')) return '⛈️';
    return '🌧️';
  }
  if (cond.includes('雪')) return '❄️';
  if (cond.includes('雾') || cond.includes('霾')) return '🌫️';
  return '☁️';
})

const weatherLabel = computed(() => {
  const cond = weatherInfo.value.condition;
  if (!cond) return 'CLOUDY';
  if (cond.includes('晴')) return 'SUNNY';
  if (cond.includes('雨')) {
    if (cond.includes('雷')) return 'STORM';
    return 'RAINY';
  }
  if (cond.includes('雪')) return 'SNOWY';
  if (cond.includes('雾') || cond.includes('霾')) return 'MISTY';
  return 'CLOUDY';
})

// ── Login Modal ──
const showLoginModal = ref(false)
const loginMode = ref('qr') // 'qr' | 'uid'  (默认扫码)
const loginUid = ref('')
const loginToken = ref('')
const loginLoading = ref(false)
const loginError = ref('')
const tokenSuccess = ref(false)
const showTokenPanel = ref(false)

// ── QR Login ──
const showQrPanel = ref(false)
const qrKey = ref('')
const qrImg = ref('')
const qrStatus = ref('') // '' | 'waiting' | 'scanned' | 'confirmed' | 'expired'
const qrStatusText = ref('')
const qrPollTimer = ref(null)
const loginChecked = ref(false) // 页面加载时登录状态是否已检查

// 自动开始扫码：打开弹窗时自动获取二维码（必须等 loginChecked 完成）
watch(() => showLoginModal.value, (val) => {
  if (val && loginMode.value === 'qr' && !user.loggedIn && loginChecked.value) {
    console.log('[QR] 触发 startQrLogin')
    nextTick(() => startQrLogin())
  }
})

async function handleUidLogin() {
  const uid = loginUid.value.trim()
  if (!uid) {
    loginError.value = '请输入 UID'
    return
  }

  loginLoading.value = true
  loginError.value = ''

  try {
    const res = await fetch(`${API_BASE}/api/auth/uid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    })
    const data = await res.json()

    if (data.success) {
      loginWithUid(data.uid, data.nickname)
      showLoginModal.value = false
      loginUid.value = ''
    } else {
      loginError.value = data.error || 'UID 登录失败'
    }
  } catch (err) {
    loginError.value = '网络错误'
  } finally {
    loginLoading.value = false
  }
}

async function handleTokenLogin() {
  const token = loginToken.value.trim()
  if (!token) {
    loginError.value = '请输入 MUSIC_U Token'
    return
  }

  loginLoading.value = true
  loginError.value = ''
  tokenSuccess.value = false

  try {
    const res = await fetch(`${API_BASE}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await res.json()

    if (data.success) {
      loginWithToken(data.uid, data.nickname, data.avatarUrl)
      tokenSuccess.value = true
      setTimeout(() => {
        showLoginModal.value = false
        tokenSuccess.value = false
        loginToken.value = ''
      }, 1500)
    } else {
      loginError.value = data.error || 'Token 无效'
    }
  } catch (err) {
    loginError.value = '网络错误'
  } finally {
    loginLoading.value = false
  }
}

// ── QR Login Functions ──

async function startQrLogin() {
  showQrPanel.value = true
  qrStatus.value = ''
  qrStatusText.value = '正在获取二维码...'
  qrImg.value = ''
  qrKey.value = ''
  loginError.value = ''

  console.log('[QR] startQrLogin, API_BASE:', API_BASE)

  try {
    const res = await fetch(`${API_BASE}/api/qr/create`, { method: 'POST' })
    console.log('[QR] response status:', res.status)
    const data = await res.json()
    console.log('[QR] response data:', data.key ? 'OK' : 'NO KEY', 'qrimg:', !!data.qrimg)

    if (data.error) {
      loginError.value = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
      qrStatus.value = 'error'
      qrStatusText.value = '获取二维码失败'
      return
    }

    if (!data.qrimg) {
      loginError.value = '未获取到二维码图片'
      qrStatus.value = 'error'
      qrStatusText.value = '获取二维码失败'
      return
    }

    qrKey.value = data.key
    qrImg.value = data.qrimg
    qrStatus.value = 'waiting'
    qrStatusText.value = '请使用网易云音乐 APP 扫码'

    startQrPolling()
  } catch (err) {
    console.error('[QR] fetch error:', err)
    loginError.value = `网络错误: ${err.message}`
    qrStatus.value = 'error'
    qrStatusText.value = '网络错误，点击重试'
  }
}

function startQrPolling() {
  stopQrPolling()
  qrPollTimer.value = setInterval(async () => {
    if (!qrKey.value) return

    try {
      const res = await fetch(`${API_BASE}/api/qr/check/${qrKey.value}`)
      const data = await res.json()
      const code = data.code

      if (code === 801) {
        // 等待扫码
        qrStatus.value = 'waiting'
        qrStatusText.value = '请使用网易云音乐 APP 扫码'
      } else if (code === 802) {
        // 已扫码，待确认
        qrStatus.value = 'scanned'
        qrStatusText.value = '已扫码，请在手机上确认'
      } else if (code === 803) {
        // 登录成功
        qrStatus.value = 'confirmed'
        qrStatusText.value = '登录成功！'
        stopQrPolling()

        // 更新用户状态
        if (data.loggedIn) {
          loginWithToken(data.uid || '', data.nickname || '网易云用户', data.avatarUrl || '')
        }

        // 1.5秒后关闭弹窗
        setTimeout(() => {
          showLoginModal.value = false
          showQrPanel.value = false
        }, 1500)
      } else if (code === 800) {
        // 二维码过期
        qrStatus.value = 'expired'
        qrStatusText.value = '二维码已过期，点击刷新'
        stopQrPolling()
      }
    } catch (err) {
      // 轮询失败不停止，继续尝试
      console.warn('[QR] poll error:', err.message)
    }
  }, 2000) // 每2秒轮询一次
}

function stopQrPolling() {
  if (qrPollTimer.value) {
    clearInterval(qrPollTimer.value)
    qrPollTimer.value = null
  }
}

function refreshQr() {
  startQrLogin()
}

function closeQrPanel() {
  stopQrPolling()
  showQrPanel.value = false
  qrStatus.value = ''
  qrImg.value = ''
  qrKey.value = ''
}

function handleLogout() {
  logout()
  // 清除服务器端 Cookie
  fetch(`${API_BASE}/api/logout`, { method: 'POST' }).catch(() => {})
}

// ── App State ──
const activeCard = ref('main') // 'main' | 'radio' | 'profile'
const showNowPlaying = ref(false)
const showSongDetail = ref(false)
const detailSong = ref(null)
const theme = ref(localStorage.getItem('claudio-theme') || 'dark')
const queueExpanded = ref(false) // 歌单折叠展开状态

function toggleTheme(newTheme) {
  theme.value = newTheme
  localStorage.setItem('claudio-theme', newTheme)
  document.body.style.backgroundColor = newTheme === 'light' ? '#f0f0f5' : '#030308'
}

const volume = ref(80)
const chatInput = ref('')
const chatMessages = reactive([])
const chatLoading = ref(false)
const agentLog = reactive([])
const chatMessagesRef = ref(null)
const floatingComments = ref([])
let _lastCommentSongId = null
const showMemory = ref(false) // 记忆面板开关
const userMemories = reactive([]) // 用户记忆列表

// 从后端加载聊天历史
async function loadChatHistory() {
  try {
    const res = await fetch(`${API_BASE}/api/memory/chat?limit=50`)
    const json = await res.json()
    if (json.data?.length > 0) {
      chatMessages.splice(0, chatMessages.length, ...json.data.map(m => ({
        role: m.role,
        content: m.content,
        tracks: m.tracks,
        djUrl: null,
      })))
    }
  } catch (err) {
    console.warn('[Memory] 加载聊天历史失败:', err.message)
  }
}

// 从后端加载用户记忆
async function loadUserMemories() {
  try {
    const res = await fetch(`${API_BASE}/api/memory/prefs`)
    const json = await res.json()
    if (json.data) {
      userMemories.splice(0, userMemories.length, ...json.data)
    }
  } catch (err) {
    console.warn('[Memory] 加载用户记忆失败:', err.message)
  }
}

// 清空聊天记录
function clearChat() {
  chatMessages.length = 0
  fetch(`${API_BASE}/api/memory/chat`, { method: 'DELETE' }).catch(() => {})
}

// 页面加载时获取
loadChatHistory()
loadUserMemories()

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
  if (val === 'playing' || val === 'speaking') startProgressPolling()
  else if (val === 'paused') { stopProgressPolling() } // 暂停时保持进度
  else if (val === 'idle' || val === 'error') { stopProgressPolling(); progress.currentTime = 0; progress.duration = 0; progress.percent = 0 }
  // loading 状态不重置进度
})

// ── Computed ──
const isPlaying = computed(() => state.status === 'playing' || state.status === 'speaking')
const isActive = computed(() => state.status === 'playing' || state.status === 'speaking' || state.status === 'paused')
const statusLabel = computed(() => {
  switch (state.status) {
    case 'loading': return 'FETCHING...'
    case 'speaking': return 'SPEAKING'
    case 'playing': return 'ON AIR'
    case 'paused': return 'PAUSED'
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
    const history = chatMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-10)

    // ── SSE 流式请求 ──
    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, history }),
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    let replyText = ''
    let replyMsgIndex = -1
    let finalSongs = []
    let finalTracks = []
    let ttsId = null

    // 解析 SSE 流
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let eventType = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          const dataStr = line.slice(6)
          let data = {}
          try { data = JSON.parse(dataStr) } catch (_) {}

          // ── 处理各类事件 ──
          switch (eventType) {
            case 'routing':
              agentLog.push({ type: 'routing', route: data.route, params: data.params, ts: Date.now() })
              break

            case 'agent_start':
              agentLog.push({ type: 'start', agent: data.agent, task: data.task, ts: Date.now() })
              break

            case 'agent_done':
              agentLog.push({ type: 'done', agent: data.agent, task: data.task, duration: data.duration, ts: Date.now() })
              break

            case 'agent_error':
              agentLog.push({ type: 'error', agent: data.agent, task: data.task, error: data.error, ts: Date.now() })
              break

            case 'thinking':
              agentLog.push({ type: 'thinking', message: data.message, ts: Date.now() })
              break

            case 'reply_chunk':
              // 逐字流式渲染
              replyText += data.text || ''
              if (replyMsgIndex < 0) {
                replyMsgIndex = chatMessages.length
                chatMessages.push({ role: 'assistant', content: '', tracks: null, djUrl: null })
              }
              chatMessages[replyMsgIndex].content = replyText
              scrollToBottom()
              break

            case 'reply':
              // 完整回复（如果没有 chunk 流）
              if (!replyText) {
                replyText = data.text || '...'
                if (replyMsgIndex < 0) {
                  replyMsgIndex = chatMessages.length
                  chatMessages.push({ role: 'assistant', content: replyText, tracks: null, djUrl: null })
                } else {
                  chatMessages[replyMsgIndex].content = replyText
                }
              }
              break

            case 'tracks':
              finalSongs = data.songs || []
              finalTracks = data.tracks || []
              break

            case 'tts_ready':
              if (data.url && replyMsgIndex >= 0) {
                const ttsUrl = data.url.startsWith('http') ? data.url : `${API_BASE}${data.url}`
                chatMessages[replyMsgIndex].djUrl = ttsUrl
                try {
                  state.status = 'speaking'
                  engine.ensureContext()
                  await engine._playDj(ttsUrl)
                } catch (_) {}
              }
              break

            case 'done':
              ttsId = data.ttsId || null
              break

            case 'error':
              agentLog.push({ type: 'error', message: data.message, ts: Date.now() })
              break
          }
        }
      }
    }

    // 确保回复消息存在
    if (replyMsgIndex < 0) {
      chatMessages.push({ role: 'assistant', content: replyText || '...', tracks: null, djUrl: null })
    }

    // 歌曲推荐：自动播放
    if (finalTracks.length > 0) {
      const names = finalTracks.slice(0, 3).map(t => t.title || t.songId).join(', ')
      const suffix = finalTracks.length > 3 ? ` +${finalTracks.length - 3}` : ''
      pushSystemMsg(`🎵 已加入队列: ${names}${suffix}`)
      playChatSongs({ tracks: finalTracks, songs: finalSongs })
    }

    scrollToBottom()
  } catch (err) {
    chatMessages.push({ role: 'assistant', content: `出错了: ${err.message}` })
    scrollToBottom()
  } finally {
    chatLoading.value = false
  }
}

// ── Replay TTS ──
async function replayTts(djUrl) {
  if (!djUrl) return
  try {
    state.status = 'speaking'
    engine.ensureContext()
    await engine._playDj(djUrl)
  } catch (err) {
    console.warn('[Chat] TTS 重播失败:', err.message)
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

  // 检查服务器端登录状态（页面加载时同步）
  checkServerLogin()
})

async function checkServerLogin() {
  try {
    const res = await fetch(`${API_BASE}/api/login/status`)
    const data = await res.json()
    if (data.loggedIn && data.uid) {
      loginWithToken(data.uid, data.nickname || '网易云用户', data.avatarUrl || '')
      console.log('[Login] 从服务器恢复登录态:', data.nickname)
    } else {
      console.log('[Login] 未登录')
      // loginChecked 先设为 true，再弹登录框（避免 watcher 竞态）
      loginChecked.value = true
      showLoginModal.value = true
      return
    }
  } catch (e) {
    console.warn('[Login] 状态检查失败:', e.message)
    loginChecked.value = true
    showLoginModal.value = true
    return
  }
  loginChecked.value = true
}
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
      <div v-if="showLoginModal" class="login-overlay" @click.self="showLoginModal = false; closeQrPanel()">
        <div class="login-card">

          <!-- 标题区 -->
          <div class="login-header">
            <div class="login-logo-ring">
              <img src="https://api.dicebear.com/7.x/bottts/svg?seed=Claudio&backgroundColor=0a0a1a" class="w-10 h-10" />
            </div>
            <h2 class="font-dot text-lg text-text-primary tracking-widest mt-3">CONNECT</h2>
            <p class="font-mono text-[9px] text-text-dim mt-1 tracking-wider">接入你的网易云音乐</p>
          </div>

          <!-- ═══ QR 扫码登录（默认） ═══ -->
          <div class="w-full" v-if="!showTokenPanel && loginMode !== 'uid'">
            <div class="qr-stage">
              <!-- 自动开始：进入即生成二维码 -->
              <div v-if="!showQrPanel" class="qr-loading">
                <div class="qr-loading-spinner"></div>
                <span class="font-mono text-[10px] text-text-dim mt-2">正在获取二维码...</span>
              </div>

              <!-- 错误状态 -->
              <div v-else-if="qrStatus === 'error'" class="qr-loading">
                <svg class="w-8 h-8 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <span class="font-mono text-[10px] text-rose-400 mt-2">{{ loginError || qrStatusText || '获取二维码失败' }}</span>
                <button class="login-btn-go mt-3 px-6 py-2 text-xs" @click="startQrLogin">重试</button>
              </div>

              <!-- 二维码展示 -->
              <div v-else class="qr-showcase">
                <!-- 二维码外框 -->
                <div class="qr-frame" :class="qrStatus">
                  <!-- 扫描角标动画 -->
                  <div class="qr-scanline" v-if="qrStatus === 'waiting'"></div>

                  <img
                    v-if="qrImg"
                    :src="qrImg"
                    alt="扫码登录"
                    class="qr-image"
                  />

                  <!-- 过期遮罩 -->
                  <div v-if="qrStatus === 'expired'" class="qr-mask" @click="refreshQr">
                    <svg class="w-6 h-6 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                    </svg>
                    <span class="font-mono text-[9px] text-white/60 mt-1">已过期，点击刷新</span>
                  </div>

                  <!-- 成功遮罩 -->
                  <div v-if="qrStatus === 'confirmed'" class="qr-mask qr-mask-success">
                    <svg class="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                    </svg>
                  </div>
                </div>

                <!-- 状态指示 -->
                <div class="qr-status-bar">
                  <span class="qr-status-dot" :class="qrStatus"></span>
                  <span class="font-mono text-[10px]" :class="{
                    'text-text-dim': qrStatus === 'waiting',
                    'text-amber-400': qrStatus === 'scanned',
                    'text-green-400': qrStatus === 'confirmed',
                    'text-rose-400': qrStatus === 'expired' || qrStatus === 'error',
                  }">{{ qrStatusText }}</span>
                </div>

                <!-- 操作提示 -->
                <p class="font-mono text-[8px] text-text-dim/40 text-center mt-2">
                  打开 <span class="text-neon-cyan/50">网易云音乐 APP</span> → 扫一扫
                </p>
              </div>
            </div>

            <!-- 其他登录方式 -->
            <div class="login-divider">
              <span class="login-divider-text">其他方式</span>
            </div>
            <div class="login-alt-row">
              <button class="login-alt-btn" @click="loginMode = 'uid'" aria-label="使用 UID 登录">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                <span>UID</span>
              </button>
              <button class="login-alt-btn" @click="showTokenPanel = true; loginError = ''" aria-label="使用 Token 登录">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
                <span>Token</span>
              </button>
            </div>
          </div>

          <!-- ═══ UID 基础模式 ═══ -->
          <div class="w-full" v-if="loginMode === 'uid' && !showTokenPanel">
            <div class="login-section-label font-mono">
              <span class="text-neon-cyan/60">&gt;</span> ENTER UID:
            </div>
            <div class="flex gap-2 mt-2">
              <input
                v-model="loginUid"
                type="text"
                placeholder="网易云用户 UID"
                class="login-input font-mono flex-1"
                @keydown.enter="handleUidLogin"
              />
              <button
                class="login-btn-go"
                @click="handleUidLogin"
                :disabled="loginLoading"
                aria-label="UID 登录"
              >→</button>
            </div>
            <p v-if="loginError" class="font-mono text-[9px] text-neon-pink mt-2">{{ loginError }}</p>
            <div class="login-hint font-mono mt-3">
              <span class="text-text-dim/50">▸</span> 读取公开红心歌单
              <br/>
              <span class="text-text-dim/50">▸</span> 无每日推荐 · 无相似歌曲
            </div>

            <button class="login-back-link" @click="loginMode = 'qr'; loginError = ''">
              ← 扫码登录
            </button>
          </div>

          <!-- ═══ Token 深度模式 ═══ -->
          <div class="w-full" v-if="showTokenPanel">
            <div class="login-section-label font-mono">
              <span class="text-neon-pink/60">&gt;</span> MUSIC_U TOKEN:
            </div>
            <div class="flex gap-2 mt-2">
              <input
                v-model="loginToken"
                type="text"
                placeholder="粘贴 MUSIC_U Cookie 值"
                class="login-input font-mono flex-1"
                @keydown.enter="handleTokenLogin"
              />
              <button
                class="login-btn-go"
                @click="handleTokenLogin"
                :disabled="loginLoading"
                aria-label="Token 登录"
              >→</button>
            </div>
            <p v-if="loginError" class="font-mono text-[9px] text-neon-pink mt-2">{{ loginError }}</p>

            <div v-if="tokenSuccess" class="login-token-success mt-3">
              <p class="font-mono text-[10px] text-green-400">SESSION CONNECTED ✓</p>
            </div>

            <div v-if="!tokenSuccess" class="login-geek-guide mt-3">
              <p class="font-mono text-[8px] text-text-dim/40 leading-relaxed">
                <span class="text-neon-pink/40">1.</span> 打开 music.163.com 并登录<br/>
                <span class="text-neon-pink/40">2.</span> F12 → Application → Cookies<br/>
                <span class="text-neon-pink/40">3.</span> 找到 MUSIC_U 复制值<br/>
                <span class="text-neon-pink/40">4.</span> 粘贴到上方输入框
              </p>
            </div>

            <button class="login-back-link" @click="showTokenPanel = false; loginError = ''; tokenSuccess = false">
              ← 扫码登录
            </button>
          </div>

          <!-- 关闭 -->
          <button class="login-close-btn" @click="showLoginModal = false; loginError = ''; tokenSuccess = false; closeQrPanel()">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
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
          <div class="login-pill" :class="{ 'login-pill--basic': user.loginMode === 'basic', 'login-pill--full': user.loginMode === 'full' }" @click="showLoginModal = true">
            <span v-if="user.loggedIn && user.loginMode === 'full'" class="login-status-dot login-status-dot--full"></span>
            <span v-else-if="user.loggedIn" class="login-status-dot login-status-dot--basic"></span>
            <span>{{ user.loggedIn ? (user.loginMode === 'full' ? 'FULL ACCESS' : 'UID:' + user.id) : 'LOGIN' }}</span>
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

        <!-- 像素动态天气标志物场景 -->
        <div class="weather-pixel-scene">
          <!-- 1. 晴天：像素发光旋转太阳 -->
          <div class="pixel-sun-wrapper" v-if="weatherThemeClass === 'weather-sunny'">
            <div class="pixel-sun"></div>
          </div>

          <!-- 2. 多云/阴天：慢速漂浮的双像素云 -->
          <div class="pixel-clouds" v-if="weatherThemeClass === 'weather-cloudy'">
            <div class="pixel-cloud cloud-1"></div>
            <div class="pixel-cloud cloud-2"></div>
          </div>

          <!-- 3. 雨雪天气：顶部常驻像素乌云 -->
          <div class="pixel-clouds" v-if="showParticles">
            <div class="pixel-cloud rain-cloud"></div>
          </div>

          <!-- 4. 雷雨天气：劈下的发光像素雷电 -->
          <div class="pixel-lightning-wrapper" v-if="weatherThemeClass === 'weather-storm'">
            <svg class="pixel-lightning" viewBox="0 0 24 24" fill="none">
              <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" fill="#ffea00" stroke="#ff7800" stroke-width="1.5"/>
            </svg>
          </div>

          <!-- 5. 雾天：横向飘动的层叠像素烟雾带 -->
          <div class="pixel-fog-lines" v-if="weatherThemeClass === 'weather-misty'">
            <div class="pixel-fog-line fog-1"></div>
            <div class="pixel-fog-line fog-2"></div>
          </div>
        </div>

        <!-- 天气粒子效果（雨雪天气限定） -->
        <div class="weather-particles-container" v-if="showParticles">
          <div
            v-for="p in weatherParticles"
            :key="p.id"
            class="weather-particle"
            :class="particleClass"
            :style="{
              left: p.style.left,
              top: p.style.top,
              animationDelay: p.style.animationDelay,
              animationDuration: p.style.animationDuration,
              opacity: p.style.opacity,
              width: p.style.width,
              height: p.style.height
            }"
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
        <div class="flex justify-between items-center py-2.5 border-y border-white/10 text-text-dim text-[9px] tracking-[0.15em] cursor-pointer" @click="queueExpanded = !queueExpanded">
          <span class="flex items-center gap-2">
            <span class="transition-transform" :class="queueExpanded ? 'rotate-90' : ''">▶</span>
            <span>QUEUE</span>
          </span>
          <span>{{ radio.state.playlist.length }} TRACKS</span>
        </div>

        <div v-if="queueExpanded" class="queue-list max-h-[160px] overflow-y-auto my-1 flex flex-col gap-1 pr-1">
          <div
            v-for="(track, index) in radio.state.playlist"
            :key="track.songId || index"
            class="flex justify-between items-center px-2 py-2 rounded-[4px] cursor-pointer transition-colors"
            :class="isActive && index === state.currentIndex ? 'bg-neon-green/10 text-neon-green' : 'hover:bg-white/5 text-text-dim'"
            @click="playTrackByIndex(index)"
          >
            <div class="flex items-center gap-3 flex-1 overflow-hidden">
              <span class="text-[9px] w-3 flex-shrink-0" v-if="!(isActive && index === state.currentIndex)">{{ index + 1 }}</span>
              <span class="text-[9px] w-3 flex-shrink-0 text-center" v-else>▶</span>
              <span class="text-xs font-sans font-bold truncate" :class="isActive && index === state.currentIndex ? 'text-neon-green' : 'text-text-primary'">
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

          <!-- Agent 活动面板 -->
          <div v-if="agentLog.length > 0" class="agent-activity mb-3">
            <div v-for="(log, i) in agentLog" :key="i"
              class="flex items-center gap-2 py-1 px-2 rounded text-[9px] font-mono"
              :class="{
                'text-blue-400': log.type === 'start' || log.type === 'thinking',
                'text-green-400': log.type === 'done',
                'text-red-400': log.type === 'error',
                'text-yellow-400': log.type === 'routing',
              }"
            >
              <span v-if="log.type === 'routing'" class="opacity-60">🔀</span>
              <span v-else-if="log.type === 'start'" class="animate-spin text-[8px]">⚙</span>
              <span v-else-if="log.type === 'done'" class="opacity-60">✓</span>
              <span v-else-if="log.type === 'thinking'" class="animate-pulse">💭</span>
              <span v-else-if="log.type === 'error'" class="opacity-60">✗</span>

              <span v-if="log.type === 'routing'">路由: {{ log.route }}</span>
              <span v-else-if="log.type === 'start'">{{ log.agent }} → {{ log.task }}</span>
              <span v-else-if="log.type === 'done'">{{ log.agent }} 完成 ({{ log.duration }}ms)</span>
              <span v-else-if="log.type === 'thinking'">{{ log.message }}</span>
              <span v-else-if="log.type === 'error'">{{ log.agent || '' }} {{ log.error || log.message }}</span>
            </div>
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
                  <div class="flex gap-2 mt-2">
                    <button class="replay-tts-btn font-mono" v-if="msg.djUrl" @click="replayTts(msg.djUrl)">
                      🔊 Replay
                    </button>
                    <button class="replay-btn font-mono" v-if="i === chatMessages.length - 1 && !msg.tracks" @click="() => { activeCard = 'radio'; if (state.status === 'idle') toggle() }">
                      ▶ REPLAY
                    </button>
                  </div>
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
              <!-- Memory -->
              <button class="icon-btn hover-glow opacity-40 hover:opacity-100" @click="showMemory = !showMemory; if (showMemory) loadUserMemories()" :class="{ 'text-neon-cyan': showMemory }" title="Memory">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 3-2 5.5-4 7.5L12 22l-3-5.5C7 14.5 5 12 5 9a7 7 0 0 1 7-7z"></path><circle cx="12" cy="9" r="2.5"></circle></svg>
              </button>
              <!-- Clear Chat -->
              <button class="icon-btn hover-glow opacity-40 hover:opacity-100" @click="clearChat" title="Clear chat">
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

      <!-- ═══ Memory Panel ═══ -->
      <Transition name="slide-right">
        <div v-if="showMemory" class="memory-panel">
          <div class="memory-header">
            <span class="font-mono text-[10px] tracking-widest text-neon-cyan">MEMORY</span>
            <button class="icon-btn hover-glow opacity-60 hover:opacity-100" @click="showMemory = false">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

          <!-- 用户记忆列表 -->
          <div class="memory-body">
            <div v-if="userMemories.length === 0" class="memory-empty">
              <span class="text-text-dim text-[10px]">还没有记忆...</span>
              <span class="text-text-dim/60 text-[9px]">聊天时 AI 会自动学习你的偏好</span>
            </div>
            <div v-for="mem in userMemories" :key="mem.id" class="memory-item">
              <div class="memory-item-header">
                <span class="memory-category">{{ mem.category }}</span>
                <span class="memory-confidence">{{ Math.round(mem.confidence * 100) }}%</span>
              </div>
              <div class="memory-key">{{ mem.key }}</div>
              <div class="memory-value">{{ mem.value }}</div>
            </div>
          </div>
        </div>
      </Transition>

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
.clock-area { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: 10px; padding: 15px 0; overflow: visible; }
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
  width: 360px;
  height: 150px;
  border-radius: 50%;
  filter: blur(40px);
  z-index: -1;
  opacity: 0.85;
  pointer-events: none;
  transition: all 1.5s ease-in-out;
}

/* Sunny Weather: Warm Orange/Magenta */
.weather-glow-halo.weather-sunny {
  background: radial-gradient(circle, rgba(255, 120, 0, 0.9) 0%, rgba(189, 0, 255, 0.5) 60%, transparent 100%);
  animation: weather-breath-sunny 6s infinite ease-in-out;
}
@keyframes weather-breath-sunny {
  0%, 100% { opacity: 0.8; transform: translate(-50%, -50%) scale(1); filter: blur(40px); }
  50% { opacity: 0.95; transform: translate(-50%, -50%) scale(1.15); filter: blur(45px); }
}

/* Rainy Weather: Cyber Cyan/Deep Blue */
.weather-glow-halo.weather-rainy {
  background: radial-gradient(circle, rgba(0, 240, 255, 0.85) 0%, rgba(0, 70, 220, 0.45) 65%, transparent 100%);
  animation: weather-breath-rainy 4s infinite ease-in-out;
}
@keyframes weather-breath-rainy {
  0%, 100% { opacity: 0.78; transform: translate(-50%, -50%) scale(1); filter: blur(40px); }
  50% { opacity: 0.9; transform: translate(-50%, -50%) scale(1.08); filter: blur(36px); }
}

/* Storm Weather: Deep Violet/Dark Indigo with Lightning */
.weather-glow-halo.weather-storm {
  background: radial-gradient(circle, rgba(189, 0, 255, 0.9) 0%, rgba(0, 30, 180, 0.5) 70%, transparent 100%);
  animation: weather-breath-storm 5s infinite ease-in-out, storm-lightning 8s infinite;
}
@keyframes weather-breath-storm {
  0%, 100% { transform: translate(-50%, -50%) scale(1); }
  50% { transform: translate(-50%, -50%) scale(1.1); }
}
@keyframes storm-lightning {
  0%, 92%, 94%, 98%, 100% { opacity: 0.78; filter: blur(40px); }
  93%, 97% { opacity: 0.98; filter: blur(32px) brightness(1.6); }
}

/* Snowy Weather: Icy Cyan/Silver White */
.weather-glow-halo.weather-snowy {
  background: radial-gradient(circle, rgba(220, 245, 255, 0.85) 0%, rgba(100, 140, 200, 0.4) 65%, transparent 100%);
  animation: weather-breath-snowy 7s infinite ease-in-out;
}
@keyframes weather-breath-snowy {
  0%, 100% { opacity: 0.78; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.9; transform: translate(-50%, -50%) scale(1.12); }
}

/* Misty/Fog Weather: Soft Grey/Milk White */
.weather-glow-halo.weather-misty {
  background: radial-gradient(circle, rgba(180, 180, 200, 0.7) 0%, rgba(90, 90, 110, 0.35) 75%, transparent 100%);
  filter: blur(50px);
  animation: weather-breath-misty 10s infinite ease-in-out;
}
@keyframes weather-breath-misty {
  0%, 100% { opacity: 0.7; transform: translate(-50%, -50%) scale(1); filter: blur(50px); }
  50% { opacity: 0.82; transform: translate(-50%, -50%) scale(1.05); filter: blur(55px); }
}

/* Cloudy Weather: Muted Slate Blue/Dim Purple (Default) */
.weather-glow-halo.weather-cloudy {
  background: radial-gradient(circle, rgba(150, 175, 230, 0.8) 0%, rgba(138, 43, 226, 0.5) 60%, transparent 100%);
  animation: weather-breath-cloudy 8s infinite ease-in-out;
}
@keyframes weather-breath-cloudy {
  0%, 100% { opacity: 0.72; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.85; transform: translate(-50%, -50%) scale(1.1); }
}

/* ── Weather Pixel Scene ── */
.weather-pixel-scene {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
  z-index: 1;
}

/* Sunny Sun */
.pixel-sun-wrapper {
  position: absolute;
  top: 15px;
  right: 35px;
  width: 32px;
  height: 32px;
  animation: sun-spin 25s linear infinite;
  filter: drop-shadow(0 0 8px rgba(255, 170, 0, 0.6));
}
.pixel-sun {
  width: 20px;
  height: 20px;
  background: #ffbe00;
  border-radius: 2px;
  box-shadow: 0 0 0 2px #ff7800,
              -6px -6px 0 -4px #ff7800,
              6px -6px 0 -4px #ff7800,
              -6px 6px 0 -4px #ff7800,
              6px 6px 0 -4px #ff7800;
  margin: 6px;
  animation: sun-pulse 4s infinite ease-in-out;
}
@keyframes sun-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
@keyframes sun-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); } }

/* Cloudy / Rainy / Snowy Clouds */
.pixel-cloud {
  position: absolute;
  background: rgba(240, 244, 255, 0.35);
  border-radius: 6px;
  box-shadow: 0 0 15px rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.pixel-cloud.cloud-1 {
  width: 70px;
  height: 20px;
  top: 20px;
  left: -80px;
  opacity: 0.7;
  box-shadow: 16px -10px 0 rgba(240, 244, 255, 0.35),
              35px -7px 0 rgba(240, 244, 255, 0.35),
              10px 6px 0 -2px rgba(240, 244, 255, 0.35);
  animation: cloud-float-left-right 28s linear infinite;
}
.pixel-cloud.cloud-2 {
  width: 50px;
  height: 14px;
  top: 50px;
  right: -60px;
  opacity: 0.5;
  box-shadow: -10px -8px 0 rgba(210, 215, 235, 0.3),
              10px -5px 0 rgba(210, 215, 235, 0.3);
  animation: cloud-float-right-left 36s linear infinite;
}
.pixel-cloud.rain-cloud {
  width: 80px;
  height: 18px;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(100, 115, 150, 0.28);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  box-shadow: -18px -6px 0 rgba(80, 95, 130, 0.28),
              18px -5px 0 rgba(80, 95, 130, 0.28),
              0 0 20px rgba(50, 60, 110, 0.2);
  animation: rain-cloud-breath 4s infinite ease-in-out;
}
@keyframes rain-cloud-breath {
  0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.65; }
  50% { transform: translateX(-50%) scale(1.06); opacity: 0.85; }
}
@keyframes cloud-float-left-right {
  0% { left: -60px; }
  100% { left: 105%; }
}
@keyframes cloud-float-right-left {
  0% { right: -60px; }
  100% { right: 105%; }
}

/* Storm Lightning */
.pixel-lightning-wrapper {
  position: absolute;
  top: 10px;
  left: 55%;
  transform: translateX(-50%);
  width: 24px;
  height: 32px;
  z-index: 2;
  pointer-events: none;
}
.pixel-lightning {
  width: 100%;
  height: 100%;
  opacity: 0;
  filter: drop-shadow(0 0 10px #ffea00);
  animation: lightning-strike 6s infinite ease-in-out;
}
@keyframes lightning-strike {
  0%, 92%, 96%, 100% { opacity: 0; transform: scaleY(1); }
  93%, 95% { opacity: 1; transform: scaleY(1.1) skewX(-6deg); }
  94% { opacity: 0.25; }
}

/* Misty Fog Lines */
.pixel-fog-lines {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
}
.pixel-fog-line {
  position: absolute;
  height: 6px;
  background: linear-gradient(90deg, transparent, rgba(200, 205, 220, 0.28) 30%, rgba(200, 205, 220, 0.28) 70%, transparent);
  border-radius: 4px;
  filter: blur(1.5px);
}
.pixel-fog-line.fog-1 {
  width: 170px;
  top: 25px;
  left: -20px;
  animation: fog-move-1 14s infinite ease-in-out;
}
.pixel-fog-line.fog-2 {
  width: 130px;
  bottom: 25px;
  right: -10px;
  animation: fog-move-2 18s infinite ease-in-out;
  opacity: 0.75;
}
@keyframes fog-move-1 {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(65px); }
}
@keyframes fog-move-2 {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(-50px); }
}

/* ── Weather Effects (Realistic) ── */
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

/* Rain - realistic streaks */
.particle-rain {
  background: linear-gradient(to bottom, transparent 0%, rgba(180, 220, 255, 0.3) 20%, rgba(200, 230, 255, 0.7) 80%, rgba(220, 240, 255, 0.4) 100%);
  border-radius: 0 0 1px 1px;
  animation: rain-fall linear infinite;
}

/* Snow - soft flakes */
.particle-snow {
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 1) 0%, rgba(230, 240, 255, 0.8) 50%, rgba(200, 220, 255, 0.3) 100%);
  border-radius: 50%;
  box-shadow: 0 0 3px rgba(255, 255, 255, 0.3);
  animation: snow-fall ease-in-out infinite;
}

@keyframes rain-fall {
  0% {
    transform: translateY(-30px) translateX(0);
    opacity: 0;
  }
  5% {
    opacity: 1;
  }
  95% {
    opacity: 1;
  }
  100% {
    transform: translateY(calc(100vh + 30px)) translateX(20px);
    opacity: 0;
  }
}

@keyframes snow-fall {
  0% {
    transform: translateY(-10px) translateX(0) rotate(0deg);
    opacity: 0;
  }
  10% {
    opacity: 0.8;
  }
  30% {
    transform: translateY(30vh) translateX(15px) rotate(120deg);
  }
  60% {
    transform: translateY(60vh) translateX(-10px) rotate(240deg);
  }
  90% {
    opacity: 0.8;
  }
  100% {
    transform: translateY(calc(100vh + 10px)) translateX(5px) rotate(360deg);
    opacity: 0;
  }
}

/* Clouds - soft irregular shapes */
.pixel-cloud {
  position: absolute;
  filter: blur(10px);
}
.pixel-cloud.cloud-1 {
  width: 100px;
  height: 32px;
  top: 20px;
  left: -120px;
  border-radius: 60% 40% 50% 50% / 50% 60% 40% 50%;
  background: rgba(255, 255, 255, 0.15);
  box-shadow: 30px -10px 0 -5px rgba(255, 255, 255, 0.12),
              -20px 5px 0 -8px rgba(255, 255, 255, 0.1);
  animation: cloud-drift 50s linear infinite;
}
.pixel-cloud.cloud-2 {
  width: 80px;
  height: 28px;
  top: 70px;
  right: -100px;
  border-radius: 50% 60% 40% 50% / 40% 50% 60% 50%;
  background: rgba(255, 255, 255, 0.12);
  box-shadow: 15px -5px 0 -3px rgba(255, 255, 255, 0.1);
  animation: cloud-drift-reverse 60s linear infinite;
}

@keyframes cloud-drift {
  0% { transform: translateX(0); opacity: 0; }
  3% { opacity: 1; }
  70% { opacity: 1; }
  75% { opacity: 0; transform: translateX(calc(100vw + 200px)); }
  100% { opacity: 0; transform: translateX(calc(100vw + 200px)); }
}
@keyframes cloud-drift-reverse {
  0% { transform: translateX(0); opacity: 0; }
  3% { opacity: 1; }
  70% { opacity: 1; }
  75% { opacity: 0; transform: translateX(calc(-100vw - 200px)); }
  100% { opacity: 0; transform: translateX(calc(-100vw - 200px)); }
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
.agent-activity { background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }
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

/* ── Theme Toggle Switch ── */
.theme-toggle {
  cursor: pointer;
  -webkit-user-select: none;
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

.replay-tts-btn {
  background: rgba(0, 240, 255, 0.08);
  border: 1px solid rgba(0, 240, 255, 0.2);
  color: #00f0ff;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 9px;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-block;
}

.replay-tts-btn:hover {
  background: rgba(0, 240, 255, 0.15);
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.2);
}
.replay-btn:hover {
  background: rgba(255, 95, 87, 0.2);
  box-shadow: 0 0 10px rgba(255, 95, 87, 0.3);
}

/* ── Vue Transitions ── */
/* ── Login Tabs ── */
.login-tabs { display: flex; gap: 6px; margin-bottom: 16px; padding: 3px; border-radius: 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); }
.login-tab { flex: 1; height: 32px; border: 0; border-radius: 8px; background: transparent; color: rgba(255,255,255,0.4); font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; cursor: pointer; transition: all 0.2s; }
.login-tab:hover { color: rgba(255,255,255,0.7); }
.login-tab.active { background: rgba(0,240,255,0.1); color: #fff; box-shadow: inset 0 0 0 1px rgba(0,240,255,0.2); }

/* ── QR Code ── */
.qr-stage { min-height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.qr-loading { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 0; }
.qr-loading-spinner { width: 28px; height: 28px; border: 2px solid rgba(0,240,255,0.15); border-top-color: #00f0ff; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.qr-showcase { display: flex; flex-direction: column; align-items: center; }
.qr-frame { position: relative; width: 180px; height: 180px; border-radius: 16px; overflow: hidden; background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,240,255,0.08); transition: box-shadow 0.3s; }
.qr-frame.scanned { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 2px rgba(251,191,36,0.4), 0 0 20px rgba(251,191,36,0.15); }
.qr-frame.confirmed { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 2px rgba(74,222,128,0.4), 0 0 20px rgba(74,222,128,0.15); }
.qr-frame.expired .qr-image { opacity: 0.2; filter: grayscale(1); }

.qr-image { width: 100%; height: 100%; object-fit: contain; padding: 10px; }
.qr-scanline { position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, #00f0ff, transparent); animation: scanline 2s ease-in-out infinite; z-index: 2; }
@keyframes scanline { 0%, 100% { top: 0; } 50% { top: calc(100% - 2px); } }

.qr-mask { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.55); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); cursor: pointer; gap: 4px; }
.qr-mask-success { background: rgba(0,0,0,0.4); }

.qr-status-bar { display: flex; align-items: center; gap: 6px; margin-top: 12px; }
.qr-status-dot { width: 6px; height: 6px; border-radius: 50%; }
.qr-status-dot.waiting { background: #00f0ff; animation: pulse-dot 1.5s ease-in-out infinite; }
.qr-status-dot.scanned { background: #fbbf24; }
.qr-status-dot.confirmed { background: #4ade80; }
.qr-status-dot.expired, .qr-status-dot.error { background: #f43f5e; }
@keyframes pulse-dot { 0%, 100% { opacity: 0.4; transform: scale(1); } 50% { opacity: 1; transform: scale(1.5); } }

/* ── Login Alt Methods ── */
.login-divider { display: flex; align-items: center; gap: 12px; width: 100%; margin: 18px 0 12px; }
.login-divider::before, .login-divider::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.06); }
.login-divider-text { font-size: 9px; color: rgba(255,255,255,0.25); letter-spacing: 0.1em; white-space: nowrap; }
.login-alt-row { display: flex; gap: 8px; width: 100%; }
.login-alt-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; height: 36px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); color: rgba(255,255,255,0.4); font-family: inherit; font-size: 10px; font-weight: 600; letter-spacing: 0.3px; cursor: pointer; transition: all 0.2s; }
.login-alt-btn:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); }
.login-back-link { display: block; width: 100%; margin-top: 12px; padding: 8px; background: none; border: none; color: rgba(255,255,255,0.3); font-family: inherit; font-size: 10px; cursor: pointer; transition: color 0.2s; text-align: center; }
.login-back-link:hover { color: rgba(255,255,255,0.6); }

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
  background: rgba(6, 6, 14, 0.88);
  backdrop-filter: blur(32px);
  -webkit-backdrop-filter: blur(32px);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.login-card {
  width: 100%;
  max-width: 340px;
  background: rgba(12, 12, 24, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 24px;
  padding: 28px 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255,255,255,0.04);
  position: relative;
}
.login-header { display: flex; flex-direction: column; align-items: center; margin-bottom: 20px; }
.login-logo-ring { width: 52px; height: 52px; border-radius: 16px; background: rgba(0,240,255,0.06); border: 1px solid rgba(0,240,255,0.12); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.login-close-btn { position: absolute; top: 14px; right: 14px; width: 28px; height: 28px; border-radius: 8px; background: rgba(255,255,255,0.04); border: none; color: rgba(255,255,255,0.3); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
.login-close-btn:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }
.login-section-label {
  font-size: 10px;
  letter-spacing: 0.15em;
  color: rgba(255, 255, 255, 0.5);
  text-align: left;
  width: 100%;
}
.login-input {
  width: 100%;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: #e8e8ec;
  font-size: 13px;
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
.login-btn.secondary {
  background: rgba(255, 255, 255, 0.05);
  color: #5a5a6e;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.login-btn.secondary:hover {
  border-color: rgba(255, 255, 255, 0.15);
  color: #e8e8ec;
}

/* ── Login Go Button ── */
.login-btn-go {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: rgba(0, 240, 255, 0.15);
  border: 1px solid rgba(0, 240, 255, 0.3);
  color: #00f0ff;
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.login-btn-go:hover:not(:disabled) {
  background: rgba(0, 240, 255, 0.25);
  box-shadow: 0 0 12px rgba(0, 240, 255, 0.3);
}
.login-btn-go:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ── System Override Button ── */
.login-btn-system-override {
  position: relative;
  padding: 8px 20px;
  border-radius: 8px;
  background: rgba(255, 40, 40, 0.06);
  border: 1px solid rgba(255, 40, 40, 0.2);
  color: rgba(255, 60, 60, 0.7);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 9px;
  letter-spacing: 0.2em;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.login-btn-system-override:hover {
  background: rgba(255, 40, 40, 0.12);
  border-color: rgba(255, 60, 60, 0.4);
  color: rgba(255, 80, 80, 0.9);
  box-shadow: 0 0 20px rgba(255, 40, 40, 0.15);
}
.override-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 60, 60, 0.8);
  animation: override-pulse 2s ease-in-out infinite;
}
@keyframes override-pulse {
  0%, 100% { opacity: 0.4; box-shadow: 0 0 4px rgba(255, 60, 60, 0.3); }
  50% { opacity: 1; box-shadow: 0 0 10px rgba(255, 60, 60, 0.6); }
}

/* ── Token Success ── */
.login-token-success {
  padding: 12px;
  border-radius: 8px;
  background: rgba(34, 197, 94, 0.06);
  border: 1px solid rgba(34, 197, 94, 0.2);
  animation: token-glow 0.5s ease-out;
}
@keyframes token-glow {
  0% { box-shadow: 0 0 0 rgba(34, 197, 94, 0); }
  50% { box-shadow: 0 0 20px rgba(34, 197, 94, 0.3); }
  100% { box-shadow: 0 0 0 rgba(34, 197, 94, 0); }
}

/* ── Geek Guide ── */
.login-geek-guide {
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  text-align: left;
}

/* ── Login Hint ── */
.login-hint {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.3);
  text-align: left;
  width: 100%;
  line-height: 1.8;
}

/* ── Header Login Pill ── */
.login-pill {
  padding: 6px 14px;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.3s;
  white-space: nowrap;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 8px;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
}
.login-pill:hover {
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.7);
}
.login-pill--basic {
  border-color: rgba(0, 240, 255, 0.2);
}
.login-pill--full {
  border-color: rgba(34, 197, 94, 0.3);
}
.login-status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
.login-status-dot--basic {
  background: #00f0ff;
  box-shadow: 0 0 6px rgba(0, 240, 255, 0.5);
}
.login-status-dot--full {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
  animation: dot-blink 3s ease-in-out infinite;
}
@keyframes dot-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@media (display-mode: standalone) { .dashboard { padding-top: 32px; } }

/* ── Memory Panel ── */
.memory-panel {
  position: absolute;
  top: 0;
  right: 0;
  width: 280px;
  height: 100%;
  background: rgba(6, 6, 14, 0.95);
  backdrop-filter: blur(16px);
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  z-index: 50;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.memory-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.memory-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.memory-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 40px 0;
}

.memory-item {
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.memory-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.memory-category {
  font-family: var(--font-mono);
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #00f0ff;
  background: rgba(0, 240, 255, 0.1);
  padding: 2px 6px;
  border-radius: 3px;
}

.memory-confidence {
  font-family: var(--font-mono);
  font-size: 8px;
  color: #5a5a6e;
}

.memory-key {
  font-size: 11px;
  font-weight: 600;
  color: #e8e8ec;
}

.memory-value {
  font-size: 10px;
  color: #71717a;
  line-height: 1.4;
}

/* ── Slide Right Transition ── */
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

/* ── Memory Panel Light Theme ── */
.theme-light .memory-panel {
  background: rgba(255, 255, 255, 0.95);
  border-left-color: rgba(0, 0, 0, 0.08);
}

.theme-light .memory-item {
  background: rgba(0, 0, 0, 0.02);
  border-color: rgba(0, 0, 0, 0.06);
}

.theme-light .memory-key { color: #111111; }
.theme-light .memory-value { color: #666666; }
.theme-light .memory-category { color: #0088cc; background: rgba(0, 136, 204, 0.1); }
</style>
