import { ref, onMounted, onUnmounted } from 'vue'

export function useClock() {
  const currentTime = ref('')
  let timer = null

  function update() {
    const now = new Date()
    currentTime.value = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  }

  function startClock() {
    update()
    timer = setInterval(update, 1000)
  }

  function stopClock() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  onMounted(startClock)
  onUnmounted(stopClock)

  return {
    currentTime,
    startClock,
    stopClock
  }
}
