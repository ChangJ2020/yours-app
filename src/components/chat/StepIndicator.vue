<template>
  <ol class="steps">
    <li v-for="(step, i) in steps" :key="step.key" class="step" :data-state="step.state">
      <div class="step-dot">
        <span v-if="step.state === 'done'">✓</span>
        <span v-else>{{ i + 1 }}</span>
      </div>
      <div class="step-text">
        <div class="step-title">{{ step.title }}</div>
        <div class="step-hint">{{ step.state === 'active' ? step.hint : '' }}</div>
      </div>
      <div v-if="i < steps.length - 1" class="step-line" />
    </li>
  </ol>
</template>

<script setup>
defineProps({
  steps: { type: Array, default: () => [] },
})
</script>

<style scoped>
.steps {
  display: flex;
  align-items: flex-start;
  gap: 0;
  list-style: none;
  padding: 0;
  margin: 0;
}

.step {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.step-dot {
  position: relative;
  z-index: 2;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12.5px;
  font-weight: 700;
  background: var(--bg-elevated);
  color: var(--text-muted);
  border: 1.5px solid var(--border-strong);
  transition: all var(--dur) var(--ease-out);
}

.step[data-state='active'] .step-dot {
  background: linear-gradient(135deg, var(--brand-600), var(--brand-500));
  border-color: transparent;
  color: #fff;
  animation: ya-pulse-ring 2s infinite;
}

.step[data-state='done'] .step-dot {
  background: var(--ok-50);
  border-color: color-mix(in srgb, var(--ok-500) 45%, transparent);
  color: var(--ok-600);
}

.step-text {
  min-width: 0;
  padding-right: 12px;
}

.step-title {
  font-size: 13px;
  font-weight: 620;
  color: var(--text-muted);
  white-space: nowrap;
  transition: color var(--dur);
}

.step[data-state='active'] .step-title {
  color: var(--text-primary);
}

.step[data-state='done'] .step-title {
  color: var(--text-secondary);
}

.step-hint {
  font-size: 11.5px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 190px;
}

.step-line {
  position: absolute;
  top: 14px;
  left: 28px;
  right: 6px;
  height: 2px;
  background: var(--border);
  z-index: 1;
}

.step[data-state='done'] .step-line {
  background: color-mix(in srgb, var(--ok-500) 45%, transparent);
}

@media (max-width: 720px) {
  .step-text {
    display: none;
  }
  .step-line {
    right: 8px;
  }
}
</style>
