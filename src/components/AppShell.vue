<script setup lang="ts">
import SpreadsheetGrid from './grid/SpreadsheetGrid.vue'
import FormulaBar from './formula-bar/FormulaBar.vue'
import Toolbar from './toolbar/Toolbar.vue'
import SheetTabs from './sheet-tabs/SheetTabs.vue'
import { useKeyboard } from '@/composables/useKeyboard'
import { gridScrollRef } from '@/composables/useGridScrollRef'

// 激活全局键盘导航（方向键/Tab/Enter/F2/Esc）+ 预滚动
useKeyboard(gridScrollRef)
</script>

<template>
  <div class="app-shell">
    <!-- 公式栏 -->
    <div class="formula-bar-wrapper">
      <FormulaBar />
    </div>

    <!-- 工具栏 -->
    <Toolbar />

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
