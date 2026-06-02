<script setup>
import { ref, onMounted } from 'vue'

const props = defineProps({
  song: { type: Object, default: null },
})

const emit = defineEmits(['close'])

const detail = ref(null)
const artistWiki = ref(null)
const comments = ref([])
const loading = ref(true)

// Sub-page states
const showWikiCard = ref(false)
const showCommentsCard = ref(false)

async function fetchDetail() {
  if (!props.song?.songId) return
  loading.value = true
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080'
  const id = props.song.songId

  try {
    const detailRes = await fetch(`${API_BASE}/api/track/${id}`).then(r => r.json()).catch(() => null)
    detail.value = detailRes || props.song

    const artistId = detailRes?.artistId
    const [wikiRes, commentsRes] = await Promise.all([
      artistId ? fetch(`${API_BASE}/api/artist/${artistId}`).then(r => r.json()).catch(() => null) : null,
      fetch(`${API_BASE}/api/comments/${id}`).then(r => r.json()).catch(() => null),
    ])

    artistWiki.value = wikiRes
    comments.value = commentsRes?.comments?.slice(0, 8) || []
  } catch (err) {
    console.warn('[SongDetail] 加载失败:', err.message)
  } finally {
    loading.value = false
  }
}

onMounted(fetchDetail)
</script>

<template>
  <!-- Artist Wiki Card -->
  <div v-if="showWikiCard" class="sub-page">
    <div class="sub-header">
      <button class="back-btn" @click="showWikiCard = false">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </button>
      <span class="font-dot text-lg text-text-primary tracking-widest">ARTIST WIKI</span>
      <div class="w-8"></div>
    </div>
    <div class="sub-content" v-if="artistWiki">
      <p class="text-sm text-text-dim leading-relaxed">{{ artistWiki.briefDesc }}</p>
      <div v-if="artistWiki.introduction?.length" class="mt-6">
        <div v-for="(intro, i) in artistWiki.introduction" :key="i" class="mt-4">
          <span class="font-mono text-[10px] text-neon-cyan tracking-widest uppercase">{{ intro.ti }}</span>
          <p class="text-sm text-text-dim leading-relaxed mt-2">{{ intro.txt }}</p>
        </div>
      </div>
    </div>
  </div>

  <!-- Hot Comments Card -->
  <div v-else-if="showCommentsCard" class="sub-page">
    <div class="sub-header">
      <button class="back-btn" @click="showCommentsCard = false">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </button>
      <span class="font-dot text-lg text-text-primary tracking-widest">HOT COMMENTS</span>
      <div class="w-8"></div>
    </div>
    <div class="sub-content">
      <div v-for="c in comments" :key="c.id" class="comment-item">
        <p class="text-sm text-text-dim leading-relaxed">{{ c.content }}</p>
        <div class="flex items-center gap-3 mt-2">
          <span class="font-mono text-[10px] text-text-muted">{{ c.nickname }}</span>
          <span class="font-mono text-[10px] text-neon-green">♥ {{ c.likedCount }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Main Song Detail -->
  <div v-else class="song-detail-page">
    <!-- Header -->
    <div class="sd-header">
      <button class="back-btn" @click="emit('close')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </button>
      <span class="font-dot text-lg text-text-primary tracking-widest">SONG DETAIL</span>
      <div class="w-8"></div>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <span class="text-text-dim text-xs font-mono">加载中...</span>
    </div>

    <template v-else-if="detail">
      <!-- Cover + Info -->
      <div class="sd-main">
        <div class="sd-cover">
          <img v-if="detail.coverUrl" :src="detail.coverUrl.replace(/^http:\/\//, 'https://')" class="w-full h-full object-cover rounded-2xl" alt="cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-text-dim text-5xl bg-cyber-surface rounded-2xl">🎵</div>
        </div>
        <h2 class="font-sans text-2xl font-bold text-text-primary text-center mt-4">{{ detail.title }}</h2>
        <p class="font-mono text-[11px] text-text-dim tracking-widest text-center mt-1">{{ detail.artist }}</p>
      </div>

      <!-- Artist Wiki -->
      <div class="sd-section" v-if="artistWiki?.briefDesc">
        <div class="sd-section-header" @click="showWikiCard = true">
          <span class="sd-section-title font-mono text-[10px] text-text-dim tracking-widest uppercase">Artist Wiki</span>
          <svg class="sd-expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </div>
        <div class="sd-wiki">
          <p class="text-xs text-text-dim leading-relaxed">{{ artistWiki.briefDesc.slice(0, 100) }}...</p>
        </div>
      </div>

      <!-- Hot Comments -->
      <div class="sd-section" v-if="comments.length > 0">
        <div class="sd-section-header" @click="showCommentsCard = true">
          <span class="sd-section-title font-mono text-[10px] text-text-dim tracking-widest uppercase">Hot Comments ({{ comments.length }})</span>
          <svg class="sd-expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </div>
        <div class="sd-comments">
          <div v-for="c in comments.slice(0, 2)" :key="c.id" class="sd-comment">
            <p class="text-xs text-text-dim leading-relaxed">{{ c.content }}</p>
            <div class="flex items-center gap-2 mt-2">
              <span class="font-mono text-[9px] text-text-muted">{{ c.nickname }}</span>
              <span class="font-mono text-[9px] text-neon-green">♥ {{ c.likedCount }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.song-detail-page,
.sub-page {
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

.sd-header,
.sub-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  max-width: 400px;
  margin-bottom: 32px;
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

.sd-main {
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 32px;
}

.sd-cover {
  width: 200px;
  height: 200px;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.sd-section {
  width: 100%;
  max-width: 360px;
  margin-bottom: 24px;
}

.sd-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  margin-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: all 0.2s;
}

.sd-section-header:hover {
  border-bottom-color: rgba(0, 240, 255, 0.2);
}

.sd-expand-icon {
  width: 16px;
  height: 16px;
  color: #71717a;
  transition: color 0.3s ease;
  flex-shrink: 0;
}

.sd-section-header:hover .sd-expand-icon {
  color: #00f0ff;
}

.sd-wiki {
  padding: 14px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 10px;
  border-left: 2px solid rgba(138, 43, 226, 0.3);
}

.sd-comments {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sd-comment {
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 10px;
  border-left: 2px solid rgba(0, 240, 255, 0.2);
}

/* Sub-page content */
.sub-content {
  width: 100%;
  max-width: 400px;
}

.comment-item {
  padding: 16px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 12px;
  border-left: 3px solid rgba(0, 240, 255, 0.2);
  margin-bottom: 12px;
}
</style>
