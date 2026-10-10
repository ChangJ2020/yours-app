<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="ya-modal-mask" @click.self="onMask">
        <div class="ya-modal" :style="{ width: width }" role="dialog" aria-modal="true">
          <div class="ya-modal-head">
            <div class="ya-row-between">
              <div>
                <h3 class="modal-title">
                  <span v-if="icon">{{ icon }}</span>
                  {{ title }}
                </h3>
                <p v-if="subtitle" class="modal-sub">{{ subtitle }}</p>
              </div>
              <button class="ya-btn ya-btn-quiet ya-btn-icon" aria-label="关闭" @click="close">✕</button>
            </div>
          </div>

          <div class="ya-modal-body">
            <slot />
          </div>

          <div v-if="$slots.footer" class="ya-modal-foot">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  icon: { type: String, default: '' },
  width: { type: String, default: '620px' },
  closeOnMask: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue', 'close'])

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onMask() {
  if (props.closeOnMask) close()
}
</script>

<style scoped>
.modal-title {
  font-size: 16.5px;
  font-weight: 680;
  display: flex;
  align-items: center;
  gap: 8px;
}

.modal-sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.55;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 180ms var(--ease-out);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
