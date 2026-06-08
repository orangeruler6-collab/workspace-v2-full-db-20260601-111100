<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="base-toast"
      :class="[type, big ? 'big' : '']"
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </div>
  </Teleport>
</template>

<script setup>
defineProps({
  show: { type: Boolean, default: false },
  message: { type: String, default: '' },
  type: { type: String, default: 'info' },
  big: { type: Boolean, default: false }
})
</script>

<style scoped>
.base-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 10018;
  max-width: min(520px, calc(100vw - 32px));
  transform: translateX(-50%);
  padding: 11px 22px;
  border: 1px solid var(--border-mid);
  border-radius: 10px;
  background: var(--toast-bg);
  box-shadow: var(--shadow-lg);
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
  text-align: center;
  white-space: normal;
  word-break: break-word;
  pointer-events: none;
  backdrop-filter: blur(10px);
  animation: toast-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.base-toast.success {
  left: auto;
  right: 28px;
  bottom: 20px;
  max-width: min(320px, calc(100vw - 132px));
  transform: none;
  padding: 8px 13px;
  border-color: color-mix(in srgb, #f0c85a 36%, var(--border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--toast-bg) 82%, #fff4bd);
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 800;
  opacity: 0.72;
  box-shadow: 0 10px 26px rgba(31, 18, 68, 0.14);
  animation-name: toast-success-side-in;
}

.base-toast.error {
  border-color: var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger-text);
}

.base-toast.big {
  padding: 16px 26px;
  font-size: 15px;
}

@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(16px) scale(0.95); }
  to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
}

@keyframes toast-success-side-in {
  from { opacity: 0; transform: translateY(10px) scale(0.96); }
  to { opacity: 0.72; transform: translateY(0) scale(1); }
}

@media (max-width: 560px) {
  .base-toast.success {
    right: 14px;
    bottom: 12px;
    max-width: calc(100vw - 112px);
  }
}
</style>
