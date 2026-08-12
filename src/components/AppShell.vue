<script setup lang="ts">
import { ref, onMounted } from 'vue'
import SpreadsheetGrid from './grid/SpreadsheetGrid.vue'
import FormulaBar from './formula-bar/FormulaBar.vue'
import Toolbar from './toolbar/Toolbar.vue'
import FormatToolbar from './toolbar/FormatToolbar.vue'
import AuthBar from './auth/AuthBar.vue'
import SheetTabs from './sheet-tabs/SheetTabs.vue'
import { useKeyboard } from '@/composables/useKeyboard'
import { gridScrollRef } from '@/composables/useGridScrollRef'
import { useWorkbookStore } from '@/stores/workbookStore'
import { isLoggedIn } from '@/services/authService'

// 激活全局键盘导航（方向键/Tab/Enter/F2/Esc）+ 预滚动
useKeyboard(gridScrollRef)

/** 登录态变化时刷新保存按钮可用性 */
const authed = ref(isLoggedIn())
function onAuthChange(): void {
  authed.value = isLoggedIn()
}

// 启动时自动恢复上次的工作簿（登录用户刷新后不再丢失现场）
onMounted(() => {
  if (isLoggedIn()) {
    void useWorkbookStore().restoreLastWorkbook()
  }
})
</script>

<template>
  <div class="app-shell">
    <!-- 登录栏（登录后才能保存到云端） -->
    <AuthBar @authed="onAuthChange" />

    <!-- 公式栏 -->
    <div class="formula-bar-wrapper">
      <FormulaBar />
    </div>

    <!-- 工具栏（文件操作 + 云端保存） -->
    <Toolbar :authed="authed" />

    <!-- 格式工具栏（字体/颜色/对齐/数字格式） -->
    <FormatToolbar />

    <!-- 表格区域（列头 + 行号 + 单元格 统一滚动） -->
    <div class="grid-wrapper">
      <SpreadsheetGrid />
    </div>

    <!-- 底部 Sheet 标签 -->
    <div class="sheet-tabs-wrapper">
      <SheetTabs />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--grid-bg);
}

.formula-bar-wrapper {
  flex-shrink: 0;
  border-bottom: 1px solid var(--grid-header-border);
}

.grid-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.sheet-tabs-wrapper {
  flex-shrink: 0;
  border-top: 1px solid var(--grid-header-border);
}
</style>
