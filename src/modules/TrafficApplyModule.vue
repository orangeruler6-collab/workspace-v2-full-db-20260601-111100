<template>
  <GrossMarginModule
    :path="path"
    module-id="trafficApply"
    :current-user="currentUser"
    :traffic-context="trafficContext"
  />
</template>

<script setup>
import GrossMarginModule from './GrossMarginModule.vue'

defineProps({
  path: {
    type: String,
    default: ''
  },
  moduleId: {
    type: String,
    default: 'trafficApply'
  },
  currentUser: {
    type: Object,
    default: null
  },
  trafficContext: {
    type: Object,
    default: null
  }
})
</script>
