import { reactive, computed, watch } from 'vue'

/**
 * 用户状态管理 composable
 *
 * 职责：
 *   - 登录/登出（localStorage 持久化）
 *   - 听歌统计（时长、曲目、收藏）
 *   - 与 AudioEngine 联动追踪
 */

const STORAGE_KEY = 'claudio_user'
const STATS_KEY = 'claudio_stats'

// ── 默认用户数据 ──
function defaultUser() {
  return {
    id: '',
    name: '',
    avatar: '',
    loggedIn: false,
    loginMode: null, // 'basic' | 'full' | null
    loginAt: null,
  }
}

function defaultStats() {
  return {
    totalListeningMs: 0,    // 累计听歌毫秒
    songsPlayed: 0,          // 播放曲目数
    favorites: 0,            // 收藏数
    sessionsCount: 0,        // 会话次数
    lastPlayedAt: null,      // 最后播放时间
    playedSongIds: [],       // 已播放歌曲 ID（去重用，最多保留 500）
  }
}

// ── 从 localStorage 恢复 ──
function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...fallback, ...JSON.parse(raw) }
  } catch (_) {}
  return { ...fallback }
}

// ── 单例状态 ──
const user = reactive(loadFromStorage(STORAGE_KEY, defaultUser()))
const stats = reactive(loadFromStorage(STATS_KEY, defaultStats()))

// ── 自动持久化 ──
let saveTimer = null
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    localStorage.setItem(STATS_KEY, JSON.stringify(stats))
  }, 500)
}

watch(user, scheduleSave, { deep: true })
watch(stats, scheduleSave, { deep: true })

// ── 听歌计时器 ──
let listeningTimer = null
let listeningStartMs = 0

function startListeningTimer() {
  stopListeningTimer()
  listeningStartMs = Date.now()
  listeningTimer = setInterval(() => {
    stats.totalListeningMs += 1000
  }, 1000)
}

function stopListeningTimer() {
  if (listeningTimer) {
    // 补偿最后一段
    if (listeningStartMs > 0) {
      stats.totalListeningMs += Date.now() - listeningStartMs
      listeningStartMs = 0
    }
    clearInterval(listeningTimer)
    listeningTimer = null
  }
}

// ── 导出 ──

export function useUser() {

  // 登录（旧版简单登录，保留兼容）
  function login(name) {
    if (!name || !name.trim()) return false
    user.id = 'u_' + Date.now().toString(36)
    user.name = name.trim()
    user.avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name.trim())}`
    user.loggedIn = true
    user.loginMode = 'basic'
    user.loginAt = Date.now()
    stats.sessionsCount++
    return true
  }

  // UID 基础模式登录
  function loginWithUid(uid, nickname) {
    user.id = String(uid)
    user.name = nickname || `UID:${uid}`
    user.avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(uid)}`
    user.loggedIn = true
    user.loginMode = 'basic'
    user.loginAt = Date.now()
    stats.sessionsCount++
  }

  // Token 深度模式登录
  function loginWithToken(uid, nickname, avatarUrl) {
    user.id = String(uid)
    user.name = nickname || `UID:${uid}`
    user.avatar = avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(uid)}`
    user.loggedIn = true
    user.loginMode = 'full'
    user.loginAt = Date.now()
    stats.sessionsCount++
  }

  // 登出
  function logout() {
    stopListeningTimer()
    user.id = ''
    user.name = ''
    user.avatar = ''
    user.loggedIn = false
    user.loginMode = null
    user.loginAt = null
  }

  // 记录一首歌被播放
  function recordPlay(songId) {
    if (!songId) return
    stats.songsPlayed++
    stats.lastPlayedAt = Date.now()
    // 去重记录（最多 500）
    const idStr = String(songId)
    if (!stats.playedSongIds.includes(idStr)) {
      stats.playedSongIds.push(idStr)
      if (stats.playedSongIds.length > 500) {
        stats.playedSongIds.splice(0, stats.playedSongIds.length - 500)
      }
    }
  }

  // 收藏
  function toggleFavorite() {
    stats.favorites = Math.max(0, stats.favorites + (stats.favorites > 0 ? -1 : 1))
  }

  function addFavorite() {
    stats.favorites++
  }

  // 格式化听歌时长
  const listeningHours = computed(() => {
    const hrs = stats.totalListeningMs / 3600000
    return hrs < 1 ? `${Math.round(hrs * 60)} MIN` : `${hrs.toFixed(1)} HRS`
  })

  const uniqueSongsPlayed = computed(() => stats.playedSongIds.length)

  const level = computed(() => {
    const hrs = stats.totalListeningMs / 3600000
    if (hrs >= 100) return 'L5'
    if (hrs >= 50) return 'L4'
    if (hrs >= 20) return 'L3'
    if (hrs >= 5) return 'L2'
    return 'L1'
  })

  return {
    user,
    stats,
    listeningHours,
    uniqueSongsPlayed,
    level,
    login,
    loginWithUid,
    loginWithToken,
    logout,
    recordPlay,
    addFavorite,
    toggleFavorite,
    startListeningTimer,
    stopListeningTimer,
  }
}
