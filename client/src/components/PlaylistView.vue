<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

const emit = defineEmits(['close', 'arsenal-switched'])
const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8080').replace(/\/+$/, '')

const playlists = ref([])
const activePlaylistId = ref('')
const loading = ref(true)
const switching = ref(false)
const toast = ref('')
const toastType = ref('success')
const trackCount = ref(0)

// 歌单详情状态
const detailView = ref(false)
const detailPlaylist = ref(null)
const detailTracks = ref([])
const detailLoading = ref(false)

// 粒子光波 canvas
const waveCanvas = ref(null)
let waveAnim = null
let waveCtx = null
const WAVE_COLORS = [
  [0, 243, 255],   // 蓝
  [139, 92, 246],  // 紫
  [244, 114, 182], // 粉
  [52, 211, 153],  // 绿
  [251, 191, 36],  // 金
]
let waveColor = WAVE_COLORS[0]

function startWave() {
  nextTick(() => {
    const canvas = waveCanvas.value
    if (!canvas) return
    const parent = canvas.parentElement
    canvas.width = parent.offsetWidth
    canvas.height = 180
    waveCtx = canvas.getContext('2d')
    waveColor = WAVE_COLORS[Math.floor(Math.random() * WAVE_COLORS.length)]
    let t = 0

    function draw() {
      const { width: w, height: h } = canvas
      waveCtx.clearRect(0, 0, w, h)

      // 3 层波浪
      for (let layer = 0; layer < 3; layer++) {
        waveCtx.beginPath()
        waveCtx.moveTo(0, h)
        const amp = 20 - layer * 5
        const freq = 0.006 + layer * 0.003
        const speed = t * (0.018 + layer * 0.007)
        const yBase = h * 0.3 + layer * 24

        for (let x = 0; x <= w; x += 2) {
          const y = yBase
            + Math.sin(x * freq + speed) * amp
            + Math.sin(x * freq * 2.1 + speed * 0.6) * (amp * 0.35)
          waveCtx.lineTo(x, y)
        }
        waveCtx.lineTo(w, h)
        waveCtx.closePath()
        waveCtx.fillStyle = `rgba(${waveColor[0]},${waveColor[1]},${waveColor[2]},${0.07 - layer * 0.018})`
        waveCtx.fill()
      }

      // 漂浮光点
      for (let i = 0; i < 15; i++) {
        const px = (Math.sin(t * 0.012 + i * 2.3) * 0.5 + 0.5) * w
        const py = (Math.sin(t * 0.01 + i * 1.8) * 0.5 + 0.5) * h * 0.8
        const r = 1.2 + Math.sin(t * 0.025 + i) * 0.7
        const a = 0.12 + Math.sin(t * 0.02 + i * 1.1) * 0.08
        waveCtx.beginPath()
        waveCtx.arc(px, py, r, 0, Math.PI * 2)
        waveCtx.fillStyle = `rgba(${waveColor[0]},${waveColor[1]},${waveColor[2]},${a})`
        waveCtx.fill()
      }

      t++
      waveAnim = requestAnimationFrame(draw)
    }
    draw()
  })
}

function stopWave() {
  if (waveAnim) { cancelAnimationFrame(waveAnim); waveAnim = null }
  waveCtx = null
}

const activePlaylist = computed(() =>
  playlists.value.find(p => String(p.id) === activePlaylistId.value)
)
const otherPlaylists = computed(() =>
  playlists.value.filter(p => String(p.id) !== activePlaylistId.value)
)

// 渐变色盘
const tones = [
  ['#00f5d4','#2442ff','#f8f4ee'],
  ['#ff6b6b','#ee5a24','#feca57'],
  ['#a29bfe','#6c5ce7','#fd79a8'],
  ['#00cec9','#0984e3','#e17055'],
  ['#fdcb6e','#e17055','#d63031'],
  ['#55efc4','#81ecec','#74b9ff'],
  ['#fab1a0','#e17055','#d63031'],
  ['#dfe6e9','#b2bec3','#636e72'],
  ['#ffeaa7','#dfe6e9','#b2bec3'],
  ['#fd79a8','#e84393','#6c5ce7'],
]
function getTone(i) { return tones[i % tones.length] }

onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/arsenal`)
    const data = await res.json()
    if (data.status === 200) {
      playlists.value = data.data.userPlaylists || []
      activePlaylistId.value = data.data.activePlaylistId || ''
      trackCount.value = data.data.trackCount || 0
    }
  } catch (e) {
    console.error('[Playlist] 加载失败:', e.message)
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  stopWave()
})

// 打开歌单详情
async function openDetail(pl) {
  detailPlaylist.value = pl
  detailView.value = true
  detailLoading.value = true
  detailTracks.value = []
  startWave()

  try {
    const res = await fetch(`${API_BASE}/api/arsenal/tracks?playlistId=${pl.id}&limit=100`)
    const data = await res.json()
    detailTracks.value = data.data?.tracks || data.tracks || []
  } catch (e) {
    console.error('[Playlist] 加载歌曲失败:', e.message)
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  stopWave()
  detailView.value = false
  detailPlaylist.value = null
  detailTracks.value = []
}

async function switchPlaylist(id, name) {
  if (switching.value || String(id) === activePlaylistId.value) return
  switching.value = true
  try {
    const res = await fetch(`${API_BASE}/api/arsenal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistId: String(id) }),
    })
    const data = await res.json()
    if (data.status === 200) {
      activePlaylistId.value = String(id)
      trackCount.value = data.data.totalTracks || 0
      showToast(`已切换「${name}」· ${data.data.imported} 首`, 'success')
      emit('arsenal-switched', { id, name, imported: data.data.imported })
    } else {
      showToast(data.error?.message || '切换失败', 'error')
    }
  } catch (e) {
    showToast('网络错误', 'error')
  } finally {
    switching.value = false
  }
}

function showToast(msg, type = 'success') {
  toast.value = msg
  toastType.value = type
  setTimeout(() => { toast.value = '' }, 2500)
}

function formatDuration(ms) {
  if (!ms) return ''
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}
</script>

<template>
  <div class="pv">
    <!-- Toast -->
    <Transition name="pv-toast">
      <div v-if="toast" class="pv-toast" :class="toastType">{{ toast }}</div>
    </Transition>

    <!-- ═══ 歌单详情视图 ═══ -->
    <template v-if="detailView">
      <div class="dt">
        <!-- 返回按钮（浮动在封面上） -->
        <button class="dt-back" @click="closeDetail" aria-label="返回歌单列表">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>

        <!-- Hero 封面区 -->
        <div class="dt-hero" v-if="detailPlaylist">
          <img
            :src="detailPlaylist.coverUrl?.replace('http://','https://') || ''"
            :alt="detailPlaylist.name"
            class="dt-hero-bg"
            @error="$event.target.style.display='none'"
          />
          <div class="dt-hero-fade"></div>
          <div class="dt-hero-content">
            <h1 class="dt-hero-title">{{ detailPlaylist.name }}</h1>
            <p class="dt-hero-meta">{{ detailPlaylist.trackCount }} 首歌曲</p>
            <button
              class="dt-action"
              :class="{ active: String(detailPlaylist.id) === activePlaylistId }"
              :disabled="switching || String(detailPlaylist.id) === activePlaylistId"
              @click="switchPlaylist(detailPlaylist.id, detailPlaylist.name)"
            >
              <svg v-if="String(detailPlaylist.id) === activePlaylistId" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
              <span>{{ String(detailPlaylist.id) === activePlaylistId ? '当前弹药库' : '设为弹药库' }}</span>
            </button>
          </div>
        </div>

        <!-- 粒子光波背景 -->
        <canvas ref="waveCanvas" class="dt-wave"></canvas>

        <!-- 歌曲列表 -->
        <div class="dt-body">
          <div v-if="detailLoading" class="dt-loading">
            <div class="pv-spinner"></div>
          </div>
          <div v-else-if="detailTracks.length === 0" class="dt-empty">
            <svg class="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>
            <span>暂无歌曲</span>
          </div>
          <div v-else class="dt-list">
            <div
              v-for="(track, i) in detailTracks"
              :key="track.id"
              class="dt-row"
              :style="{ animationDelay: `${Math.min(i * 25, 400)}ms` }"
            >
              <span class="dt-num">{{ i + 1 }}</span>
              <div class="dt-cover">
                <img
                  :src="track.coverUrl?.replace('http://','https://') || ''"
                  :alt="track.name"
                  class="dt-cover-img"
                  loading="lazy"
                  @error="$event.target.style.display='none'"
                />
              </div>
              <div class="dt-track">
                <span class="dt-name">{{ track.name }}</span>
                <span class="dt-artist">{{ track.artists }}</span>
              </div>
              <span class="dt-dur">{{ formatDuration(track.duration) }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ═══ 歌单列表视图 ═══ -->
    <template v-else>
      <header class="pv-head">
        <button class="pv-back" @click="emit('close')" aria-label="返回">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div class="pv-head-text">
          <h1 class="pv-title">我的歌单</h1>
          <span class="pv-sub">{{ playlists.length }} 个歌单 · {{ trackCount }} 首歌曲</span>
        </div>
      </header>

      <div v-if="loading" class="pv-empty"><div class="pv-spinner"></div></div>

      <div v-else class="pv-scroll">
        <!-- 当前歌单 Hero -->
        <section v-if="activePlaylist" class="pv-hero" @click="openDetail(activePlaylist)">
          <div class="pv-hero-art" :style="{ '--t-a': getTone(0)[0], '--t-b': getTone(0)[1] }">
            <img
              :src="activePlaylist.coverUrl?.replace('http://','https://') || ''"
              :alt="activePlaylist.name"
              class="pv-hero-img"
              @error="$event.target.style.display='none'"
            />
            <div class="pv-hero-vinyl"></div>
          </div>
          <div class="pv-hero-meta">
            <span class="pv-hero-badge">正在播放</span>
            <h2 class="pv-hero-name">{{ activePlaylist.name }}</h2>
            <span class="pv-hero-count">{{ activePlaylist.trackCount }} 首</span>
          </div>
        </section>

        <div class="pv-sep" v-if="otherPlaylists.length"><span>切换歌单</span></div>

        <div class="pv-grid" v-if="otherPlaylists.length">
          <button
            v-for="(pl, i) in otherPlaylists"
            :key="pl.id"
            class="pv-card"
            :class="{ switching }"
            :style="{
              '--t-a': getTone(i)[0], '--t-b': getTone(i)[1], '--t-c': getTone(i)[2],
              animationDelay: `${i * 40}ms`,
            }"
            @click="openDetail(pl)"
          >
            <div class="pv-card-art">
              <img
                :src="pl.coverUrl?.replace('http://','https://') || ''"
                :alt="pl.name"
                class="pv-card-img"
                @error="$event.target.style.display='none'"
              />
              <div class="pv-card-disc"></div>
            </div>
            <div class="pv-card-info">
              <span class="pv-card-name">{{ pl.name }}</span>
              <span class="pv-card-count">{{ pl.trackCount }} 首</span>
            </div>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pv {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: #06060e;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Header ── */
.pv-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 24px 20px 8px;
  flex-shrink: 0;
}
.pv-back {
  width: 36px; height: 36px;
  border-radius: 12px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.5);
  cursor: pointer;
  display: grid; place-items: center;
  transition: all 0.2s;
}
.pv-back:hover { background: rgba(255,255,255,0.08); color: #fff; }
.pv-head-text { display: flex; flex-direction: column; gap: 2px; }
.pv-title {
  font-size: 22px; font-weight: 800;
  letter-spacing: -0.02em;
  color: rgba(255,255,255,0.92);
  line-height: 1.1;
}
.pv-sub { font-size: 11px; color: rgba(255,255,255,0.3); letter-spacing: 0.04em; }

/* ── Toast ── */
.pv-toast {
  position: absolute; top: 76px; left: 20px; right: 20px;
  padding: 10px 16px; border-radius: 12px;
  font-size: 12px; font-weight: 600; text-align: center;
  z-index: 10; pointer-events: none;
}
.pv-toast.success { background: rgba(74,222,128,0.12); border: 1px solid rgba(74,222,128,0.2); color: #4ade80; }
.pv-toast.error { background: rgba(244,63,94,0.12); border: 1px solid rgba(244,63,94,0.2); color: #f43f5e; }
.pv-toast-enter-active { transition: all 0.25s ease-out; }
.pv-toast-leave-active { transition: all 0.2s ease-in; }
.pv-toast-enter-from { opacity: 0; transform: translateY(-8px); }
.pv-toast-leave-to { opacity: 0; }

/* ── Loading ── */
.pv-empty { flex: 1; display: grid; place-items: center; }
.pv-spinner { width: 24px; height: 24px; border: 2px solid rgba(255,255,255,0.06); border-top-color: rgba(255,255,255,0.3); border-radius: 50%; animation: sp 0.7s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }

/* ── Scroll ── */
.pv-scroll { flex: 1; overflow-y: auto; padding: 8px 16px 32px; }

/* ── Hero ── */
.pv-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 4px 24px;
  margin-bottom: 4px;
}
.pv-hero-art {
  width: 100px; height: 100px;
  border-radius: 20px;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
  background: linear-gradient(135deg, var(--t-a), var(--t-b));
  box-shadow: 0 16px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
}
.pv-hero-img {
  width: 100%; height: 100%;
  object-fit: cover;
  position: relative; z-index: 1;
}
.pv-hero-vinyl {
  position: absolute;
  right: -16px; top: 50%;
  transform: translateY(-50%);
  width: 60px; height: 60px;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, rgba(255,255,255,0.08) 0 1px, transparent 1px 5px);
  border: 6px solid rgba(10,10,14,0.8);
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  z-index: 2;
}
.pv-hero-meta { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pv-hero-badge {
  font-size: 9px; font-weight: 700;
  letter-spacing: 0.15em; text-transform: uppercase;
  color: rgba(74,222,128,0.8);
}
.pv-hero-name {
  font-size: 22px; font-weight: 800;
  color: rgba(255,255,255,0.95);
  letter-spacing: -0.01em;
  line-height: 1.15;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pv-hero-count { font-size: 13px; color: rgba(255,255,255,0.35); }

/* ── Separator ── */
.pv-sep {
  padding: 4px 4px 14px;
  display: flex; align-items: center; gap: 12px;
}
.pv-sep span {
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255,255,255,0.18);
  white-space: nowrap;
}
.pv-sep::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.04); }

/* ── Grid ── */
.pv-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.pv-card {
  --tone-a: var(--t-a, #00f5d4);
  --tone-b: var(--t-b, #2442ff);

  position: relative;
  border-radius: 18px;
  background: linear-gradient(142deg, rgba(18,21,26,0.7), rgba(8,9,13,0.8));
  border: 1px solid rgba(255,255,255,0.06);
  padding: 14px;
  cursor: pointer;
  overflow: hidden;
  text-align: left;
  font-family: inherit;
  color: #fff;
  transition: transform 0.22s cubic-bezier(.16,1,.3,1), border-color 0.22s, box-shadow 0.22s;
  animation: card-in 0.35s ease-out both;
}
.pv-card::before {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(118deg, color-mix(in srgb, var(--tone-a) 18%, transparent), transparent 40%, color-mix(in srgb, var(--tone-b) 12%, transparent) 70%);
  pointer-events: none;
}
.pv-card:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--tone-a) 30%, rgba(255,255,255,0.12));
  box-shadow: 0 16px 48px rgba(0,0,0,0.4), 0 0 24px color-mix(in srgb, var(--tone-a) 12%, transparent);
}
.pv-card.switching { opacity: 0.4; pointer-events: none; }

@keyframes card-in {
  from { opacity: 0; transform: translateY(10px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* ── Card Art ── */
.pv-card-art {
  position: relative;
  width: 100%; aspect-ratio: 1;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(135deg, var(--tone-a), var(--tone-b));
  box-shadow: 0 8px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1);
  margin-bottom: 10px;
}
.pv-card-img {
  width: 100%; height: 100%;
  object-fit: cover;
  position: relative; z-index: 1;
}
.pv-card-disc {
  position: absolute;
  right: -8px; bottom: -8px;
  width: 44px; height: 44px;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, rgba(255,255,255,0.06) 0 1px, transparent 1px 4px);
  border: 4px solid rgba(10,10,14,0.7);
  z-index: 2;
  opacity: 0;
  transform: translate(8px, 8px);
  transition: all 0.3s ease-out;
}
.pv-card:hover .pv-card-disc {
  opacity: 1;
  transform: translate(0, 0);
}

/* ── Card Info ── */
.pv-card-info {
  display: flex; flex-direction: column; gap: 2px;
  position: relative; z-index: 1;
}
.pv-card-name {
  font-size: 13px; font-weight: 700;
  color: rgba(255,255,255,0.9);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pv-card-count {
  font-size: 11px;
  color: rgba(255,255,255,0.35);
}

/* ── Responsive ── */
@media (min-width: 640px) {
  .pv-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (min-width: 960px) {
  .pv-grid { grid-template-columns: repeat(4, 1fr); }
}

/* ── Light ── */
.theme-light .pv { background: #f0f0f5; }
.theme-light .pv-title { color: #111; }
.theme-light .pv-sub { color: #999; }
.theme-light .pv-card { background: rgba(255,255,255,0.7); border-color: rgba(0,0,0,0.06); }
.theme-light .pv-card-name { color: #111; }
.theme-light .pv-card-count { color: #888; }
.theme-light .pv-hero-name { color: #111; }
.theme-light .pv-back { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.06); color: #666; }

/* ═══ Detail View ═══ */
.dt {
  position: fixed; inset: 0;
  background: #06060e;
  display: flex; flex-direction: column;
  overflow: hidden;
  z-index: 10;
}

.dt-back {
  position: absolute; top: 16px; left: 16px;
  width: 36px; height: 36px;
  border-radius: 50%;
  background: rgba(0,0,0,0.4);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.08);
  color: #fff;
  cursor: pointer;
  display: grid; place-items: center;
  z-index: 20;
  transition: background 0.2s;
}
.dt-back:hover { background: rgba(0,0,0,0.6); }

/* Hero */
.dt-hero {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  max-height: 320px;
  flex-shrink: 0;
  overflow: hidden;
}
.dt-hero-bg {
  width: 100%; height: 100%;
  object-fit: cover;
}
.dt-hero-fade {
  position: absolute; inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(6,6,14,0.2) 0%,
    rgba(6,6,14,0.5) 50%,
    #06060e 100%
  );
}
.dt-hero-content {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  padding: 20px 20px 16px;
  display: flex; flex-direction: column; gap: 6px;
}
.dt-hero-title {
  font-size: 26px; font-weight: 800;
  color: #fff;
  letter-spacing: -0.02em;
  line-height: 1.1;
  text-shadow: 0 2px 12px rgba(0,0,0,0.5);
}
.dt-hero-meta {
  font-size: 13px;
  color: rgba(255,255,255,0.55);
  margin-bottom: 4px;
}
.dt-action {
  display: inline-flex; align-items: center; gap: 6px;
  align-self: flex-start;
  padding: 8px 16px;
  border-radius: 10px;
  background: rgba(255,255,255,0.1);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.85);
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}
.dt-action:hover { background: rgba(255,255,255,0.16); }
.dt-action.active {
  background: rgba(74,222,128,0.15);
  border-color: rgba(74,222,128,0.3);
  color: #4ade80;
  cursor: default;
}

/* Wave canvas */
.dt-wave {
  position: absolute;
  bottom: 0; left: 0;
  width: 100%; height: 180px;
  pointer-events: none;
  z-index: 0;
}

/* Song list body */
.dt-body {
  position: relative; z-index: 1;
  flex: 1; overflow-y: auto;
  padding: 8px 0 32px;
}
.dt-loading { display: grid; place-items: center; padding: 60px 0; }
.dt-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 60px 0; color: rgba(255,255,255,0.2); font-size: 13px;
}
.dt-list { display: flex; flex-direction: column; }

.dt-row {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 20px;
  transition: background 0.15s;
  animation: dt-in 0.3s ease-out both;
}
.dt-row:hover { background: rgba(255,255,255,0.03); }

@keyframes dt-in {
  from { opacity: 0; transform: translateX(-8px); }
  to { opacity: 1; transform: translateX(0); }
}

.dt-num {
  width: 22px;
  font-size: 12px; font-weight: 600;
  color: rgba(255,255,255,0.15);
  text-align: right; flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.dt-cover {
  width: 60px; height: 60px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255,255,255,0.04);
}
.dt-cover-img { width: 100%; height: 100%; object-fit: cover; }
.dt-track { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dt-name {
  font-size: 14.5px; font-weight: 600;
  color: rgba(255,255,255,0.88);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dt-artist {
  font-size: 11.5px;
  color: rgba(255,255,255,0.3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dt-dur {
  font-size: 11px; font-family: monospace;
  color: rgba(255,255,255,0.18);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.theme-light .dt { background: #f0f0f5; }
.theme-light .dt-hero-fade { background: linear-gradient(to bottom, rgba(240,240,245,0.1) 0%, rgba(240,240,245,0.5) 50%, #f0f0f5 100%); }
.theme-light .dt-hero-title { color: #111; text-shadow: none; }
.theme-light .dt-hero-meta { color: #666; }
.theme-light .dt-name { color: #111; }
.theme-light .dt-artist { color: #888; }
.theme-light .dt-action { background: rgba(0,0,0,0.05); border-color: rgba(0,0,0,0.08); color: #333; }
.theme-light .dt-back { background: rgba(255,255,255,0.6); color: #333; }
</style>
