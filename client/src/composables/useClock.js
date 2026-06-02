import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 实时时钟 composable
 * 返回响应式的时、分、秒和完整时间字符串
 */
export function useClock() {
  const hours = ref('00')
  const minutes = ref('00')
  const seconds = ref('00')
  const period = ref('AM')
  const dateString = ref('')
  let timer = null

  const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

  function update() {
    const now = new Date()
    hours.value = String(now.getHours()).padStart(2, '0')
    minutes.value = String(now.getMinutes()).padStart(2, '0')
    seconds.value = String(now.getSeconds()).padStart(2, '0')
    period.value = now.getHours() >= 12 ? 'PM' : 'AM'

    const day = WEEKDAYS[now.getDay()]
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const date = String(now.getDate()).padStart(2, '0')
    dateString.value = `${day} ${now.getFullYear()}.${month}.${date}`
  }

  onMounted(() => {
    update()
    timer = setInterval(update, 1000)
  })

  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return {
    hours,
    minutes,
    seconds,
    period,
    dateString,
  }
}
