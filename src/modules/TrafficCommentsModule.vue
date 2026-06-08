<template>
  <div class="traffic-comments-module">
    <div class="module-page-header">
      <div class="module-page-title">
        <span class="module-page-icon">评</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">TRAFFIC COMMENTS</div>
          <h2>投流评论生成</h2>
        </div>
      </div>
    </div>

    <section class="traffic-comments-layout">
      <CommentGeneratorPanel
        title="自定义评论"
        caption="沿用文案工具的评论生成、飞书写入和 Word 导出"
        :context="commentContext"
      />
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import CommentGeneratorPanel from './tools/CommentGeneratorPanel.vue'

const props = defineProps({
  trafficContext: {
    type: Object,
    default: null
  }
})

const commentContext = computed(() => {
  const source = props.trafficContext || {}
  return {
    account: source.accountName || source.account || '',
    videoUrl: source.videoUrl || source.link || '',
    scenario: '投流申请配套评论',
    script: source.applyText || source.script || source.text || ''
  }
})
</script>

<style scoped>
.traffic-comments-module {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.traffic-comments-layout {
  width: min(860px, 100%);
}
</style>
