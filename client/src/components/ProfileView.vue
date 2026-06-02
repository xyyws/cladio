<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'

const emit = defineEmits(['close', 'avatar-updated'])

function goBack() {
  emit('close')
}

// Editable Bio
const bio = ref(localStorage.getItem('claudio-bio') || 'Your mood is my prompt.\nI hate algorithms. I have taste.')
const isEditingBio = ref(false)

watch(bio, (val) => {
  localStorage.setItem('claudio-bio', val)
})

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
    emit('avatar-updated', ev.target.result)
  }
  reader.readAsDataURL(file)
}

// Particle System
const canvasRef = ref(null)
let ctx = null
let particles = []
let mouse = { x: -1000, y: -1000 }
let animationId = null

function initParticles(width, height) {
  particles = []
  const count = width < 768 ? 80 : 150
  for(let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2.5 + 0.5,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      baseVx: (Math.random() - 0.5) * 0.5,
      baseVy: (Math.random() - 0.5) * 0.5,
      color: Math.random() > 0.5 ? 'rgba(0, 240, 255, ' : 'rgba(138, 43, 226, ',
      alpha: Math.random() * 0.5 + 0.2
    })
  }
}

function animate() {
  if (!canvasRef.value) return
  const width = canvasRef.value.width
  const height = canvasRef.value.height
  ctx.clearRect(0, 0, width, height)
  
  particles.forEach(p => {
    // Mouse interaction - repel effect
    const dx = mouse.x - p.x
    const dy = mouse.y - p.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    
    if (dist < 180) {
      const angle = Math.atan2(dy, dx)
      const force = (180 - dist) / 180
      // Repel from mouse
      p.vx -= Math.cos(angle) * force * 0.4
      p.vy -= Math.sin(angle) * force * 0.4
    } else {
      // Smoothly return to base velocity
      p.vx += (p.baseVx - p.vx) * 0.05
      p.vy += (p.baseVy - p.vy) * 0.05
    }

    // Add some friction
    p.vx *= 0.98
    p.vy *= 0.98

    p.x += p.vx
    p.y += p.vy

    // Screen wrapping
    if (p.x < 0) p.x = width
    if (p.x > width) p.x = 0
    if (p.y < 0) p.y = height
    if (p.y > height) p.y = 0

    // Draw particle
    ctx.fillStyle = p.color + p.alpha + ')'
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fill()
  })

  animationId = requestAnimationFrame(animate)
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  ctx = canvas.getContext('2d')

  const resize = () => {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    initParticles(canvas.width, canvas.height)
  }
  
  window.addEventListener('resize', resize)
  resize()

  const onMouseMove = (e) => {
    mouse.x = e.clientX
    mouse.y = e.clientY
  }
  const onMouseLeave = () => {
    mouse.x = -1000
    mouse.y = -1000
  }

  // Attach mouse listeners to the overlay so it captures all moves
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseleave', onMouseLeave)

  animate()

  // Cleanup
  onUnmounted(() => {
    window.removeEventListener('resize', resize)
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseleave', onMouseLeave)
    cancelAnimationFrame(animationId)
  })
})
</script>

<template>
  <div class="profile-overlay">
    <!-- Interactive Particle Background -->
    <canvas ref="canvasRef" class="particle-canvas"></canvas>

    <div class="profile-content">
      <div class="header">
        <div class="font-dot text-2xl tracking-widest text-text-primary uppercase">DJ Profile</div>
      </div>
      
      <div class="profile-card">
        <div class="dj-header">
          <div class="dj-avatar cursor-pointer" @click="uploadDjAvatar">
            <img v-if="djAvatar" :src="djAvatar" class="w-full h-full object-cover rounded-[10px]" alt="Claudio">
            <img v-else src="https://api.dicebear.com/7.x/bottts/svg?seed=Claudio" class="w-full h-full opacity-80 mix-blend-screen" alt="Claudio">
            <input ref="djAvatarInput" type="file" accept="image/*" class="hidden" @change="onDjAvatarChange">
          </div>
          <div class="dj-title">
            <h2 class="font-dot text-4xl text-text-primary tracking-widest uppercase">Claudio</h2>
            <p class="font-mono text-[10px] text-neon-green mt-1 tracking-widest">一开机我就打碟</p>
          </div>
        </div>

        <div class="dj-bio" @click="isEditingBio = true">
          <textarea
            v-if="isEditingBio"
            v-model="bio"
            class="bio-input font-mono text-xs text-text-dim leading-relaxed"
            rows="2"
            @blur="isEditingBio = false"
            @keydown.enter.exact="isEditingBio = false"
            autofocus
          ></textarea>
          <template v-else>
            <p class="font-mono text-xs text-text-dim leading-relaxed whitespace-pre-line">{{ bio }}</p>
          </template>
        </div>
        
        <div class="dj-stats font-mono">
          <div class="stat-item"><span class="label">ON AIR</span><span class="val">24/7</span></div>
          <div class="stat-item"><span class="label">GENRES</span><span class="val text-neon-cyan">∞</span></div>
          <div class="stat-item"><span class="label">LISTENER</span><span class="val">1</span></div>
        </div>

        <div class="dj-tags">
          <span class="tag">JAZZ-HIPHOP</span>
          <span class="tag">NEO-CLASSICAL</span>
          <span class="tag">90S华语</span>
          <span class="tag">HIP-HOP</span>
          <span class="tag">SYNTHWAVE</span>
          <span class="tag">SHIBUYA-KEI</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  max-width: 480px;
  height: auto;
  max-height: 400px;
  background: rgba(6, 6, 14, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  z-index: 100;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), inset 0 0 60px rgba(138, 43, 226, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.08);
  animation: card-in 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes card-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

.particle-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none; /* Let clicks pass through */
  z-index: 1;
}

.profile-content {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 440px;
  padding: 20px;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}

.profile-card {
  width: 100%;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), inset 0 0 40px rgba(0, 240, 255, 0.02);
  backdrop-filter: blur(10px);
}

.dj-header {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
}

.dj-avatar {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  background: rgba(0, 240, 255, 0.05);
  border: 1px solid rgba(0, 240, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 20px rgba(0, 240, 255, 0.05), 0 0 15px rgba(0, 240, 255, 0.1);
  overflow: hidden;
  padding: 4px;
}

.dj-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dj-bio {
  margin-bottom: 16px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 10px;
  border-left: 2px solid #00f0ff;
  cursor: text;
  min-height: 40px;
}

.bio-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  color: #5a5a6e;
  font-size: 12px;
  line-height: 1.6;
  padding: 0;
}

.dj-stats {
  display: flex;
  gap: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  padding: 12px 0;
  margin-bottom: 16px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-item .label {
  font-size: 8px;
  letter-spacing: 0.2em;
  color: #5a5a6e;
}

.stat-item .val {
  font-size: 18px;
  color: #e8e8ec;
  font-weight: bold;
}

.dj-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  font-family: var(--font-mono);
  font-size: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  color: #a0a0b0;
  background: rgba(255, 255, 255, 0.02);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  transition: all 0.2s;
}

.tag:hover {
  border-color: #00f0ff;
  color: #00f0ff;
  background: rgba(0, 240, 255, 0.05);
  transform: translateY(-2px);
}
</style>
