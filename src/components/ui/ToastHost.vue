<template>
  <div class="toast-host">
    <TransitionGroup name="toast">
      <div v-for="item in toastState.items" :key="item.id" class="toast" :data-type="item.type">
        <span class="toast-icon">{{ iconOf(item.type) }}</span>
        <div class="ya-grow">
          <div v-if="item.title" class="toast-title">{{ item.title }}</div>
          <div class="toast-msg">{{ item.message }}</div>
        </div>
        <button class="toast-close" aria-label="关闭" @click="dismissToast(item.id)">✕</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { dismissToast, toastState } from '@/composables/useToast.js'

const iconOf = (type) =>
  ({ ok: '✅', warn: '⚠️', error: '⛔', info: 'ℹ️' })[type] || 'ℹ️'
</script>

<style scoped>
.toast-host {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: min(360px, calc(100vw - 40px));
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  font-size: 13px;
}

.toast[data-type='ok'] {
  border-left: 3px solid var(--ok-500);
}
.toast[data-type='warn'] {
  border-left: 3px solid var(--warn-500);
}
.toast[data-type='error'] {
  border-left: 3px solid var(--danger-500);
}
.toast[data-type='info'] {
  border-left: 3px solid var(--info-500);
}

.toast-icon {
  font-size: 14px;
  line-height: 1.5;
}

.toast-title {
  font-weight: 650;
  margin-bottom: 2px;
}

.toast-msg {
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

.toast-close {
  color: var(--text-muted);
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
}

.toast-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 240ms var(--ease-out);
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px) scale(0.96);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px) scale(0.96);
}
</style>
