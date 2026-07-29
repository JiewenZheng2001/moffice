<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorkbookStore } from '@/stores/workbookStore'

const uiStore = useUiStore()
const workbookStore = useWorkbookStore()

/** 公式栏双向绑定值 */
const formulaText = ref('')
/** 输入框引用（用于提交后失焦） */
const inputRef = ref<HTMLInputElement | null>(null)

/** 当前选中的单元格地址显示 */
const cellRef = computed(() => uiStore.activeRef)

/** 监听选区变化，同步显示当前单元格内容 */
watch(
  () => uiStore.activeRef,
  (currentRef) => {
    if (!currentRef) return
    const sheet = workbookStore.activeSheet
    const cell = sheet?.cells?.get(currentRef)
    formulaText.value = cell?.formula ?? String(cell?.rawValue ?? '')
  },
  { immediate: true },
)

/** Enter 确认 → 保存公式栏内容到当前单元格 */
function commitFormula(): void {
  const ref = uiStore.activeRef
  if (!ref) return
  workbookStore.setCellValue(ref, formulaText.value || null)
  // 提交后失焦，避免后续 Ctrl+C/V 被 isInputFocused 拦截
  inputRef.value?.blur()
}
</script>

<template>
  <div class="formula-bar">
    <!-- 名称框 -->
    <div class="name-box">
      {{ cellRef }}
    </div>
    <!-- 公式编辑区 -->
    <div class="formula-input-wrapper">
      <span class="formula-icon">fx</span>
      <input
        ref="inputRef"
        v-model="formulaText"
        class="formula-input"
        type="text"
        placeholder="输入内容或公式（= 开头）"
        @keydown.enter.prevent="commitFormula()"
      />
    </div>
  </div>
</template>

<style scoped>
.formula-bar {
  display: flex;
  align-items: center;
  height: var(--formula-bar-height);
  background: var(--grid-bg);
  padding: 0 4px;
}

.name-box {
  width: 80px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--grid-cell-border);
  border-radius: 2px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-right: 6px;
  flex-shrink: 0;
}

.formula-icon {
  font-style: italic;
  color: var(--text-disabled);
  margin-right: 4px;
  font-size: 12px;
}

.formula-input-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  border: 1px solid var(--grid-cell-border);
  border-radius: 2px;
  padding: 0 6px;
  height: 24px;
}

.formula-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 13px;
  font-family: inherit;
  background: transparent;
}
</style>
