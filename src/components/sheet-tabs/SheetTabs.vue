<script setup lang="ts">
import { computed } from 'vue'
import { useWorkbookStore } from '@/stores/workbookStore'

const workbookStore = useWorkbookStore()

/** 所有 Sheet 列表 */
const sheets = computed(() => workbookStore.workbook.sheets)

/** 当前激活 Sheet */
const activeSheetId = computed(() => workbookStore.workbook.activeSheetId)

/** 切换 Sheet */
function selectSheet(sheetId: string): void {
  workbookStore.setActiveSheet(sheetId)
}

/** 新建 Sheet */
function addSheet(): void {
  const count = workbookStore.workbook.sheets.length
  workbookStore.addSheet(`Sheet${count + 1}`)
}
</script>

<template>
  <div class="sheet-tabs">
    <!-- Sheet 标签列表 -->
    <div class="tabs">
      <div
        v-for="sheet in sheets"
        :key="sheet.id"
        class="tab"
        :class="{ 'tab--active': sheet.id === activeSheetId }"
        @click="selectSheet(sheet.id)"
      >
        {{ sheet.name }}
      </div>
    </div>
    <!-- 新建 Sheet 按钮 -->
    <button class="add-btn" @click="addSheet" title="新建 Sheet">
      +
    </button>
  </div>
</template>

<style scoped>
.sheet-tabs {
  display: flex;
  align-items: center;
  height: var(--sheet-tab-height);
  background: var(--grid-header-bg);
  padding: 0 4px;
}

.tabs {
  display: flex;
  flex: 1;
  overflow-x: auto;
  gap: 2px;
}

.tab {
  padding: 2px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--grid-bg);
  border: 1px solid var(--grid-cell-border);
  border-radius: 2px 2px 0 0;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.tab--active {
  color: var(--color-primary);
  border-bottom-color: var(--grid-bg);
  background: var(--grid-bg);
}

.add-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
  margin-left: 4px;
}

.add-btn:hover {
  color: var(--color-primary);
}
</style>
