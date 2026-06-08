<template>
  <Teleport to="body">
    <div
      v-if="current"
      class="usagi-feedback"
      :class="[`tone-${current.tone}`, `kind-${current.kind}`, `intensity-${current.intensity}`, `mood-${current.mood}`]"
      :style="{ '--x': current.x + 'px', '--y': current.y + 'px', '--hue': current.hue }"
      role="status"
      aria-live="polite">
      <span
        v-for="ring in current.rings"
        :key="ring.id"
        class="usagi-ring"
        :style="ring.style"></span>
      <span
        v-for="spark in current.sparks"
        :key="spark.id"
        class="usagi-spark"
        :style="spark.style"></span>
      <span
        v-for="streak in current.streaks"
        :key="streak.id"
        class="usagi-streak"
        :style="streak.style"></span>

      <div class="usagi-card">
        <div class="usagi-avatar" aria-hidden="true">
          <span class="usagi-face-effect"></span>
          <img :src="current.image" alt="" />
          <span class="usagi-sweat"></span>
          <span class="usagi-z usagi-z-one">Z</span>
          <span class="usagi-z usagi-z-two">z</span>
        </div>
        <div class="usagi-copy">
          <strong>{{ current.title }}</strong>
          <span>{{ current.detail }}</span>
          <small v-if="current.metaLine">{{ current.metaLine }}</small>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import usagiIdleImage from '../assets/usagi-pet-states/idle.png'
import usagiHappyImage from '../assets/usagi-pet-states/happy.png'
import usagiSleepImage from '../assets/usagi-pet-states/sleep.png'
import usagiPanicImage from '../assets/usagi-pet-states/panic.png'
import usagiSignImage from '../assets/usagi-pet-states/sign.png'

const current = ref(null)
let timer = null
let lastAt = 0
let pendingLight = null

const titleByKind = {
  handoff: '新订单跳进来了',
  'task-done': '这一单收掉！',
  generate: '脑袋冒烟完成',
  save: '已稳稳放好',
  favorite: '这条先抱走',
  copy: '已经塞进剪贴板',
  warning: '等一下下',
  error: '呜哇，卡住了',
  ai: '翻资料中',
  success: '好！过！',
  info: '收到'
}

const detailByKind = {
  handoff: ['有新任务交到你手里了，先别慌，乌萨奇帮你盯住。', '叮！新订单落地，先看账号和要求。'],
  'task-done': ['完成得很漂亮，工位小兔原地弹起。', '这一格清掉了，班味被击退一点。'],
  generate: ['资料翻完了，先看结果，不满意我们再咬一口。', '脑袋转到冒烟，但东西拿回来了。'],
  save: ['放好了，不会偷偷跑掉。', '已收纳，桌面瞬间顺眼一点。'],
  favorite: ['这条有点香，先收藏起来。', '灵感被抱走，之后还能再翻出来。'],
  copy: ['已经复制好，贴出去就行。', '剪贴板已塞满，轻拿轻放。'],
  warning: ['先停半拍，这里可能要确认一下。', '乌萨奇拽住你一下，别急着冲。'],
  error: ['这里卡了一下，不是你的问题，我们继续抓。', '呜哇，撞墙了，但还能修。'],
  success: ['这一小步过了，继续推进。', '可以，工作台回血一点。'],
  info: ['收到，我在旁边看着。', '嗯哼，先记下。']
}

const moodByKind = {
  handoff: 'alert',
  'task-done': 'jump',
  generate: 'spark',
  save: 'happy',
  favorite: 'happy',
  copy: 'happy',
  warning: 'alert',
  error: 'panic',
  ai: 'think',
  success: 'happy',
  info: 'idle'
}

const imageByMood = {
  idle: usagiIdleImage,
  happy: usagiHappyImage,
  jump: usagiHappyImage,
  spark: usagiHappyImage,
  alert: usagiSignImage,
  panic: usagiPanicImage,
  think: usagiSignImage,
  sleep: usagiSleepImage
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function rand(min, max) {
  return min + Math.random() * (max - min)
}

function makeAnchor(detail) {
  if (Number.isFinite(detail?.x) && Number.isFinite(detail?.y)) {
    return { x: detail.x, y: detail.y }
  }
  if (detail?.intensity === 'light') {
    return {
      x: window.innerWidth - 156,
      y: window.innerHeight - 132
    }
  }
  return {
    x: window.innerWidth * rand(0.42, 0.62),
    y: window.innerHeight * rand(0.3, 0.48)
  }
}

function toneFromType(type) {
  if (type === 'error') return 'error'
  if (type === 'warning' || type === 'warn') return 'warning'
  return 'success'
}

function normalizeLegacy(detail = {}) {
  return {
    ...detail,
    type: detail.type || 'success',
    kind: detail.kind || 'success',
    intensity: detail.intensity || (detail.big ? 'hero' : 'pop'),
    message: detail.message || detail.detail,
    detail: detail.detail || detail.message
  }
}

function metaLine(detail) {
  const meta = detail?.meta || {}
  const parts = [meta.sender, meta.account, meta.task].filter(Boolean)
  return parts.join(' / ').slice(0, 72)
}

function buildEffect(rawDetail = {}) {
  const detail = normalizeLegacy(rawDetail)
  const now = Date.now()
  const type = detail.type === 'warn' ? 'warning' : detail.type || 'success'
  const kind = detail.kind || (type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'success')
  const intensity = detail.intensity || 'pop'
  const anchor = makeAnchor({ ...detail, intensity })
  const tone = toneFromType(type)
  const hue = String(tone === 'error' ? 350 : tone === 'warning' ? 38 : pick([38, 46, 150, 188, 262]))
  const isLight = intensity === 'light'
  const isNotice = intensity === 'notice'
  const sparkCount = isLight ? 5 : isNotice ? 6 : intensity === 'hero' ? 22 : 14
  const rings = isLight ? [] : Array.from({ length: intensity === 'hero' ? 3 : 2 }, (_, index) => ({
    id: `ring-${now}-${index}`,
    style: {
      '--delay': `${index * 88}ms`,
      '--size': `${rand(108, intensity === 'hero' ? 260 : 190)}px`
    }
  }))
  const sparks = Array.from({ length: sparkCount }, (_, index) => ({
    id: `spark-${now}-${index}`,
    style: {
      '--angle': `${(360 / sparkCount) * index + rand(-18, 18)}deg`,
      '--distance': `${rand(isLight ? 28 : 46, intensity === 'hero' ? 182 : 118)}px`,
      '--delay': `${rand(0, 140)}ms`,
      '--size': `${rand(4, intensity === 'hero' ? 14 : 10)}px`,
      '--local-hue': `${Number(hue) + rand(-16, 16)}`
    }
  }))
  const streaks = isLight ? [] : Array.from({ length: tone === 'success' ? 5 : 3 }, (_, index) => ({
    id: `streak-${now}-${index}`,
    style: {
      '--sx': `${rand(-118, 118)}px`,
      '--sy': `${rand(-84, 72)}px`,
      '--rotate': `${rand(-28, 28)}deg`,
      '--delay': `${index * 42}ms`,
      '--length': `${rand(68, intensity === 'hero' ? 156 : 112)}px`
    }
  }))
  const fallbackDetails = detailByKind[kind] || detailByKind[type] || detailByKind.success
  return {
    id: `feedback-${now}`,
    kind,
    type,
    tone,
    intensity,
    mood: detail.petMood || moodByKind[kind] || moodByKind[type] || 'happy',
    x: anchor.x,
    y: anchor.y,
    hue,
    title: detail.title || titleByKind[kind] || titleByKind[type] || titleByKind.success,
    detail: detail.detail || detail.message || pick(fallbackDetails),
    metaLine: metaLine(detail),
    image: imageByMood[detail.petMood || moodByKind[kind] || moodByKind[type] || 'happy'] || usagiHappyImage,
    rings,
    sparks,
    streaks
  }
}

function launch(event) {
  const detail = event?.detail || {}
  const now = Date.now()
  const isLight = detail.intensity === 'light'
  if (isLight && now - lastAt < 900) {
    pendingLight = detail
    return
  }
  if (!isLight && now - lastAt < 260) return
  lastAt = now
  current.value = buildEffect(detail)
  if (timer) window.clearTimeout(timer)
  const duration = detail.timeout || (current.value.intensity === 'hero' ? 5200 : current.value.intensity === 'light' ? 2100 : 3400)
  timer = window.setTimeout(() => {
    current.value = null
    if (pendingLight) {
      const next = pendingLight
      pendingLight = null
      window.setTimeout(() => launch({ detail: next }), 120)
    }
  }, duration)
}

onMounted(() => {
  window.addEventListener('usagi:feedback', launch)
  window.addEventListener('usagi:celebrate', launch)
})

onUnmounted(() => {
  window.removeEventListener('usagi:feedback', launch)
  window.removeEventListener('usagi:celebrate', launch)
  if (timer) window.clearTimeout(timer)
})
</script>

<style scoped>
.usagi-feedback {
  position: fixed;
  left: var(--x);
  top: var(--y);
  z-index: 10030;
  width: 1px;
  height: 1px;
  pointer-events: none;
  color: var(--text);
}

.usagi-card {
  position: absolute;
  left: 0;
  top: 0;
  display: grid;
  grid-template-columns: 56px minmax(150px, 280px);
  align-items: center;
  gap: 12px;
  min-height: 74px;
  padding: 10px 15px 10px 10px;
  border: 2px solid color-mix(in srgb, hsl(var(--hue) 70% 48%) 30%, #6b4b34);
  border-radius: 22px 24px 20px 24px;
  background:
    radial-gradient(circle at 15% 15%, rgba(255, 246, 206, 0.74), transparent 38%),
    linear-gradient(135deg, color-mix(in srgb, #fff3ce 68%, var(--toast-bg)), color-mix(in srgb, #fff 52%, var(--toast-bg)));
  box-shadow:
    0 16px 42px rgba(72, 48, 30, 0.16),
    0 0 0 5px color-mix(in srgb, hsl(var(--hue) 72% 64%) 8%, transparent);
  color: #3d2a1f;
  transform: translate(-50%, -50%);
  animation: usagiCardPop 0.58s cubic-bezier(0.16, 1, 0.3, 1) both, usagiCardFloat 3.2s ease-in-out 0.58s infinite;
  backdrop-filter: blur(14px) saturate(1.08);
}

.intensity-light .usagi-card {
  grid-template-columns: 42px minmax(120px, 210px);
  min-height: 58px;
  padding: 8px 12px 8px 8px;
  border-width: 1.5px;
  border-radius: 18px;
  animation: usagiLightIn 0.42s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.tone-error .usagi-card {
  background:
    radial-gradient(circle at 15% 15%, rgba(255, 221, 226, 0.9), transparent 38%),
    linear-gradient(135deg, color-mix(in srgb, #fff 52%, var(--danger-bg)), color-mix(in srgb, #ffe8ec 72%, var(--toast-bg)));
}

.tone-warning .usagi-card {
  background:
    radial-gradient(circle at 15% 15%, rgba(255, 236, 182, 0.94), transparent 38%),
    linear-gradient(135deg, color-mix(in srgb, #fff5c7 78%, var(--toast-bg)), color-mix(in srgb, #fff 54%, var(--toast-bg)));
}

.usagi-avatar {
  position: relative;
  width: 56px;
  height: 58px;
}

.intensity-light .usagi-avatar {
  width: 42px;
  height: 44px;
}

.usagi-avatar img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform-origin: 50% 82%;
  filter: drop-shadow(0 8px 12px rgba(70, 43, 20, 0.18));
  animation: usagiHappy 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.mood-jump .usagi-avatar img,
.mood-spark .usagi-avatar img {
  animation-name: usagiJump;
}

.mood-alert .usagi-avatar img {
  animation-name: usagiAlert;
}

.mood-panic .usagi-avatar img {
  animation-name: usagiPanic;
}

.mood-think .usagi-avatar img {
  animation-name: usagiThink;
}

.usagi-face-effect {
  position: absolute;
  right: -5px;
  top: 1px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #4a3024;
  opacity: 0;
}

.mood-alert .usagi-face-effect,
.mood-panic .usagi-face-effect {
  opacity: 1;
  animation: usagiPopDot 0.9s ease-in-out infinite;
}

.usagi-sweat {
  position: absolute;
  right: 1px;
  top: 18px;
  width: 7px;
  height: 12px;
  border-radius: 999px;
  background: #69c8ff;
  opacity: 0;
  transform: rotate(18deg);
}

.mood-panic .usagi-sweat,
.mood-alert .usagi-sweat {
  opacity: 1;
  animation: usagiSweat 1.1s ease-in-out infinite;
}

.usagi-z {
  position: absolute;
  right: -8px;
  top: -8px;
  color: #6f5dff;
  font-weight: 900;
  opacity: 0;
}

.mood-sleep .usagi-z-one,
.mood-sleep .usagi-z-two {
  animation: usagiZ 2.2s ease-in-out infinite;
}

.mood-sleep .usagi-z-two {
  animation-delay: 0.7s;
  right: -15px;
  top: 8px;
  font-size: 12px;
}

.usagi-copy {
  min-width: 0;
}

.usagi-copy strong,
.usagi-copy span,
.usagi-copy small {
  display: block;
  min-width: 0;
}

.usagi-copy strong {
  font-size: 15px;
  font-weight: 950;
  line-height: 1.25;
}

.intensity-light .usagi-copy strong {
  font-size: 13px;
}

.usagi-copy span {
  margin-top: 4px;
  color: rgba(61, 42, 31, 0.78);
  font-size: 12px;
  line-height: 1.45;
}

.intensity-light .usagi-copy span {
  font-size: 11px;
  margin-top: 2px;
}

.usagi-copy small {
  margin-top: 6px;
  color: rgba(61, 42, 31, 0.56);
  font-size: 10px;
  line-height: 1.3;
}

.usagi-spark,
.usagi-ring,
.usagi-streak {
  position: absolute;
  left: 0;
  top: 0;
  display: block;
  transform: translate(-50%, -50%);
}

.usagi-spark {
  width: var(--size);
  height: var(--size);
  border-radius: 36% 64% 48% 52%;
  background:
    radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.92), transparent 32%),
    hsl(var(--local-hue) 88% 62%);
  animation: usagiSpark 1.1s ease-out both;
  animation-delay: var(--delay);
}

.tone-error .usagi-spark {
  border-radius: 50% 50% 46% 54%;
}

.usagi-ring {
  width: var(--size);
  height: var(--size);
  border: 2px solid hsl(var(--hue) 88% 60% / 0.3);
  border-radius: 50%;
  animation: usagiRing 1.2s ease-out both;
  animation-delay: var(--delay);
}

.usagi-streak {
  width: var(--length);
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, hsl(var(--hue) 88% 62% / 0.68), transparent);
  animation: usagiStreak 0.92s ease-out both;
  animation-delay: var(--delay);
}

@keyframes usagiCardPop {
  0% { opacity: 0; transform: translate(-50%, -44%) scale(0.74) rotate(-5deg); }
  65% { opacity: 1; transform: translate(-50%, -50%) scale(1.04) rotate(1deg); }
  100% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0deg); }
}

@keyframes usagiLightIn {
  0% { opacity: 0; transform: translate(-42%, -36%) scale(0.82) rotate(-4deg); }
  100% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0deg); }
}

@keyframes usagiCardFloat {
  0%, 100% { margin-top: 0; }
  50% { margin-top: -5px; }
}

@keyframes usagiHappy {
  0% { transform: translateY(7px) rotate(-6deg) scale(0.86); }
  48% { transform: translateY(-4px) rotate(6deg) scale(1.08); }
  100% { transform: translateY(0) rotate(0deg) scale(1); }
}

@keyframes usagiJump {
  0% { transform: translateY(10px) scale(0.9); }
  35% { transform: translateY(-10px) rotate(-6deg) scale(1.08); }
  62% { transform: translateY(2px) rotate(5deg) scale(1); }
  100% { transform: translateY(0) rotate(0deg); }
}

@keyframes usagiAlert {
  0%, 100% { transform: rotate(0deg) scale(1); }
  25% { transform: rotate(-8deg) scale(1.04); }
  55% { transform: rotate(8deg) scale(1.02); }
}

@keyframes usagiPanic {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  18% { transform: translateX(-3px) rotate(-6deg); }
  36% { transform: translateX(3px) rotate(6deg); }
  54% { transform: translateX(-2px) rotate(-4deg); }
}

@keyframes usagiThink {
  0%, 100% { transform: rotate(-2deg) translateY(0); }
  50% { transform: rotate(4deg) translateY(-4px); }
}

@keyframes usagiPopDot {
  0%, 100% { transform: scale(0.8); }
  50% { transform: scale(1.08); }
}

@keyframes usagiSweat {
  0%, 100% { transform: translateY(0) rotate(18deg); }
  50% { transform: translateY(4px) rotate(18deg); }
}

@keyframes usagiZ {
  0% { opacity: 0; transform: translateY(8px) scale(0.7); }
  20%, 75% { opacity: 0.8; }
  100% { opacity: 0; transform: translate(8px, -18px) scale(1.05); }
}

@keyframes usagiSpark {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
  18% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--angle)) translateX(var(--distance)) scale(0.15); }
}

@keyframes usagiRing {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.12); }
  16% { opacity: 0.82; }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.08); }
}

@keyframes usagiStreak {
  0% { opacity: 0; transform: translate(calc(-50% + var(--sx)), calc(-50% + var(--sy))) rotate(var(--rotate)) scaleX(0.1); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--sx) * -0.25), calc(-50% + var(--sy) * -0.15)) rotate(var(--rotate)) scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .usagi-feedback,
  .usagi-card,
  .usagi-avatar img,
  .usagi-spark,
  .usagi-ring,
  .usagi-streak {
    animation: none !important;
  }
}

@media (max-width: 560px) {
  .usagi-card {
    grid-template-columns: 46px minmax(132px, calc(100vw - 132px));
    max-width: calc(100vw - 32px);
  }
}
</style>
