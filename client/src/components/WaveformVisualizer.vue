<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  active: { type: Boolean, default: false },
  barCount: { type: Number, default: 32 },
  color: { type: String, default: '#00f0ff' },
})

const bars = ref([])
let animTimer = null

function generateBars() {
  bars.value = Array.from({ length: props.barCount }, () =>
    Math.random() * 0.7 + 0.1
  )
}

function animate() {
  if (!props.active) return
  bars.value = bars.value.map((v, i) => {
    const target = Math.random() * 0.8 + 0.1
    const lerp = 0.15 + Math.sin(Date.now() / 400 + i * 0.3) * 0.1
    return v + (target - v) * lerp
  })
  animTimer = requestAnimationFrame(animate)
}

watch(() => props.active, (val) => {
  if (val) {
    generateBars()
    animate()
  } else {
    if (animTimer) cancelAnimationFrame(animTimer)
  }
}, { immediate: true })

onMounted(() => {
  generateBars()
  if (props.active) animate()
})

onUnmounted(() => {
  if (animTimer) cancelAnimationFrame(animTimer)
})
</script>

<template>
  <div class="waveform-container">
    <div
      v-for="(height, i) in bars"
      :key="i"
      class="waveform-bar"
      :style="{
        height: `${height * 100}%`,
        backgroundColor: active ? color : 'rgba(0, 240, 255, 0.15)',
        transitionDelay: `${i * 20}ms`,
      }"
    />
  </div>
</template>

<style scoped>
.waveform-container {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 48px;
  padding: 4px 0;
}

.waveform-bar {
  flex: 1;
  min-height: 2px;
  border-radius: 1px;
  transition: height 0.15s ease, background-color 0.3s ease;
}
</style>
