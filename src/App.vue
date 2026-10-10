<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" />
  </router-view>
  <ToastHost />
</template>

<script setup>
import ToastHost from '@/components/ui/ToastHost.vue'
</script>
