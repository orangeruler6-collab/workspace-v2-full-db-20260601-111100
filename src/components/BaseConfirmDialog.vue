<template>
  <Teleport to="body">
    <div v-if="show" class="confirm-mask" @click.self="$emit('cancel')">
      <div class="confirm-box" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <div class="confirm-ears" aria-hidden="true">
          <span></span>
          <span></span>
        </div>
        <div class="confirm-icon" :class="type">{{ icon }}</div>
        <div class="confirm-content">
          <div :id="titleId" class="confirm-title">{{ title }}</div>
          <div v-if="message" class="confirm-message">{{ message }}</div>
        </div>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="$emit('cancel')">{{ cancelText }}</button>
          <button class="confirm-btn" :class="type" @click="$emit('confirm')">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  message: { type: String, default: '' },
  confirmText: { type: String, default: '确认' },
  cancelText: { type: String, default: '取消' },
  type: { type: String, default: 'default' }
})

defineEmits(['confirm', 'cancel'])

const titleId = 'confirm-title-' + Math.random().toString(36).slice(2)
const icon = computed(() => props.type === 'danger' ? '!' : '?')
</script>

<style scoped>
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(5, 3, 14, 0.72);
  backdrop-filter: blur(10px);
}

.confirm-box {
  position: relative;
  width: min(440px, 100%);
  border: 1.5px solid color-mix(in srgb, var(--border-mid) 72%, var(--usagi-border, rgba(255, 216, 79, 0.34)));
  border-radius: 26px 28px 22px 29px;
  background:
    radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--usagi-yellow, #ffd84f) 12%, transparent), transparent 38%),
    linear-gradient(135deg, color-mix(in srgb, var(--surface) 88%, var(--usagi-paper, rgba(255, 242, 184, 0.08))), var(--surface));
  box-shadow: var(--usagi-sticker-shadow, var(--shadow-lg)), var(--shadow-lg);
  padding: 20px;
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 14px;
  transform: rotate(-0.35deg);
}

.confirm-ears {
  position: absolute;
  left: 28px;
  top: -22px;
  display: flex;
  gap: 8px;
  transform: rotate(-8deg);
}

.confirm-ears span {
  width: 15px;
  height: 42px;
  border: 1.5px solid color-mix(in srgb, var(--usagi-ink, #4a3024) 48%, var(--usagi-border, rgba(255, 216, 79, 0.34)));
  border-bottom: 0;
  border-radius: 999px 999px 10px 10px;
  background: linear-gradient(180deg, var(--usagi-cream, #fff2b8), color-mix(in srgb, var(--usagi-yellow, #ffd84f) 62%, var(--surface)));
}

.confirm-ears span:last-child {
  transform: rotate(14deg);
}

.confirm-icon {
  width: 42px;
  height: 42px;
  border-radius: 42% 58% 46% 54%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 34% 22%, rgba(255, 255, 255, 0.6), transparent 34%),
    linear-gradient(145deg, var(--usagi-cream, #fff2b8), var(--usagi-yellow, #ffd84f));
  border: 2px solid color-mix(in srgb, var(--usagi-ink, #4a3024) 46%, var(--border));
  color: var(--usagi-ink, #4a3024);
  font-size: 22px;
  font-weight: 800;
  box-shadow: 0 9px 18px color-mix(in srgb, var(--usagi-yellow, #ffd84f) 16%, transparent);
}

.confirm-icon.danger {
  background:
    radial-gradient(circle at 34% 22%, rgba(255, 255, 255, 0.5), transparent 34%),
    linear-gradient(145deg, #ffd6dd, #ff8fa3);
  border-color: rgba(127, 29, 29, 0.45);
  color: #7f1d1d;
}

.confirm-content {
  min-width: 0;
}

.confirm-title {
  color: var(--text);
  font-size: 15px;
  font-weight: 950;
  line-height: 1.35;
}

.confirm-message {
  margin-top: 7px;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.confirm-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 6px;
}

.confirm-btn {
  min-width: 76px;
  min-height: 34px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, var(--usagi-border, rgba(255, 216, 79, 0.34)));
  border-radius: 13px 15px 12px 15px;
  padding: 0 14px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 900;
  background:
    radial-gradient(circle at 28% 18%, rgba(255, 255, 255, 0.52), transparent 34%),
    linear-gradient(135deg, var(--usagi-yellow, #ffd84f), var(--usagi-orange, #f59e0b));
  color: var(--usagi-ink, #4a3024);
  box-shadow: 0 8px 18px color-mix(in srgb, var(--usagi-yellow, #ffd84f) 16%, transparent);
}

.confirm-btn.cancel {
  background: color-mix(in srgb, var(--control-bg, transparent) 78%, var(--usagi-paper, transparent));
  color: var(--text-dim);
  box-shadow: none;
}

.confirm-btn.cancel:hover {
  border-color: var(--border-bright);
  color: var(--text);
}

.confirm-btn.danger {
  background: linear-gradient(135deg, #fb7185, #ef4444);
  border-color: rgba(239, 68, 68, 0.7);
  color: #fff;
}

.confirm-btn:hover {
  filter: brightness(1.04);
  transform: translateY(-1px);
}

:global(:root:not([data-ui-style="usagi"]) .confirm-box) {
  border: 1px solid var(--border-mid);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  transform: none;
}

:global(:root:not([data-ui-style="usagi"]) .confirm-ears) {
  display: none;
}

:global(:root:not([data-ui-style="usagi"]) .confirm-icon) {
  border-radius: 12px;
  background: rgba(167, 139, 250, 0.14);
  border: 1px solid rgba(167, 139, 250, 0.28);
  color: var(--primary-light);
  box-shadow: none;
}

:global(:root:not([data-ui-style="usagi"]) .confirm-icon.danger) {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.32);
  color: #f87171;
}

:global(:root:not([data-ui-style="usagi"]) .confirm-title) {
  font-weight: 800;
}

:global(:root:not([data-ui-style="usagi"]) .confirm-btn) {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  box-shadow: none;
  font-weight: 800;
}

:global(:root:not([data-ui-style="usagi"]) .confirm-btn.cancel) {
  background: transparent;
  color: var(--text-dim);
}

:global(:root:not([data-ui-style="usagi"]) .confirm-btn.danger) {
  background: #ef4444;
  border-color: rgba(239, 68, 68, 0.7);
  color: #fff;
}
</style>
