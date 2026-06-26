<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  comments: { type: Array, default: () => [] },
})

const activeComments = ref([])
let timer = null
let idCounter = 0

function random(min, max) {
  return Math.random() * (max - min) + min
}

// 检查新位置是否与现有评论重叠
function isOverlapping(newTop, newLeft) {
  const threshold = 15 // 最小间距（百分比）
  return activeComments.value.some(c => {
    const dTop = Math.abs(c.top - newTop)
    const dLeft = Math.abs(c.left - newLeft)
    return dTop < threshold && dLeft < threshold
  })
}

function spawn() {
  if (!props.comments.length) return

  const src = props.comments[Math.floor(Math.random() * props.comments.length)]
  const id = ++idCounter
  const lifetime = random(12000, 18000)

  // 找一个不重叠的位置
  let top, left
  let attempts = 0
  const maxAttempts = 20

  do {
    top = random(8, 75)
    // 左右两边显示，避免遮挡中间内容
    left = Math.random() > 0.5 ? random(55, 95) : random(2, 42)
    attempts++
  } while (attempts < maxAttempts && isOverlapping(top, left))

  // 随机漂移方向
  const driftX = random(-30, 30)
  const driftY = random(-60, -20)

  // 随机动画延迟
  const fadeInDelay = random(0, 500)

  // 随机选择发光颜色
  const glowColor = Math.random() > 0.5
    ? 'rgba(0, 240, 255, 0.15)'
    : 'rgba(189, 0, 255, 0.12)'

  activeComments.value.push({
    id,
    content: src.content,
    nickname: src.nickname,
    likedCount: src.likedCount,
    top,
    left,
    driftX,
    driftY,
    lifetime,
    fadeInDelay,
    glowColor,
  })

  // 内存回收
  setTimeout(() => {
    const idx = activeComments.value.findIndex(c => c.id === id)
    if (idx !== -1) activeComments.value.splice(idx, 1)
  }, lifetime + fadeInDelay + 1000)
}

function startTimer() {
  stopTimer()
  const tick = () => {
    spawn()
    timer = setTimeout(tick, random(3000, 5000))
  }
  timer = setTimeout(tick, random(500, 1500))
}

function stopTimer() {
  if (timer) { clearTimeout(timer); timer = null }
}

watch(() => props.comments, (val) => {
  if (val.length > 0) startTimer()
  else stopTimer()
}, { immediate: true })

onMounted(() => {
  if (props.comments.length > 0) startTimer()
})

onUnmounted(() => {
  stopTimer()
  activeComments.value = []
})
</script>

<template>
  <div class="floating-comments">
    <div
      v-for="c in activeComments"
      :key="c.id"
      class="ghost-comment"
      :style="{
        top: c.top + '%',
        left: c.left + '%',
        '--drift-x': c.driftX + 'px',
        '--drift-y': c.driftY + 'px',
        '--lifetime': c.lifetime + 'ms',
        '--fade-delay': c.fadeInDelay + 'ms',
        '--glow': c.glowColor,
      }"
    >
      <p class="comment-text">{{ c.content }}</p>
      <div class="comment-meta">
        <span class="comment-user">{{ c.nickname }}</span>
        <span class="comment-likes" v-if="c.likedCount">♥ {{ c.likedCount }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.floating-comments {
  position: fixed;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  overflow: hidden;
}

.ghost-comment {
  position: absolute;
  max-width: 280px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.015);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  animation: ghost-drift var(--lifetime) ease-in-out var(--fade-delay) forwards;
  opacity: 0;
}

.comment-text {
  font-family: 'Nunito', var(--font-sans), sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.6;
  color: #a1a1aa;
  text-shadow: 0 0 20px var(--glow);
  margin: 0;
}

.comment-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.comment-user {
  font-family: var(--font-mono), 'Space Mono', monospace;
  font-size: 10px;
  color: #71717a;
  letter-spacing: 0.05em;
}

.comment-likes {
  font-family: var(--font-mono), 'Space Mono', monospace;
  font-size: 10px;
  color: #52525b;
}

@keyframes ghost-drift {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.96);
    filter: blur(2px);
  }
  8% {
    opacity: 0.7;
    filter: blur(0);
    transform: translate(0, 0) scale(1);
  }
  85% {
    opacity: 0.6;
    transform: translate(var(--drift-x), var(--drift-y)) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(calc(var(--drift-x) * 1.5), calc(var(--drift-y) * 1.5)) scale(0.97);
    filter: blur(3px);
  }
}
</style>
