<script setup lang="ts">
import { computed } from 'vue'
import { useWorkbookStore } from '@/stores/workbookStore'
import { useUiStore } from '@/stores/uiStore'
import { toCellRef } from '@/utils/columnUtils'
import { getSelectionBounds } from '@/services/clipboardManager'
import type { CellFormat } from '@/model/types'

const workbookStore = useWorkbookStore()
const uiStore = useUiStore()

/** 预设字体族 */
const FONT_FAMILIES = [
  '宋体',
  '黑体',
  '微软雅黑',
  'Arial',
  'Times New Roman',
  'Courier New',
]

/** 预设字号（px） */
const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32]

/** 预设背景色（含无色） */
const BG_COLORS = [
  null,
  '#FFFF00', // 黄
  '#FFC7CE', // 浅红
  '#C6EFCE', // 浅绿
  '#DDEBF7', // 浅蓝
  '#F2F2F2', // 浅灰
  '#FF9900', // 橙
  '#7030A0', // 紫
]

/** 预设文字色（含默认） */
const TEXT_COLORS = [
  null,
  '#FF0000',
  '#FF9900',
  '#00B050',
  '#0070C0',
  '#7030A0',
  '#808080',
  '#000000',
]

/** 数字格式预设 */
const NUMBER_FORMATS = [
  { label: '常规', value: null },
  { label: '千分位', value: '#,##0' },
  { label: '两位小数', value: '0.00' },
  { label: '百分比', value: '0%' },
  { label: '货币 ¥', value: '¥#,##0.00' },
  { label: '货币 $', value: '$#,##0.00' },
]

/** 当前激活格的格式（工具栏状态来源） */
const activeFormat = computed<CellFormat>(() => {
  const sheet = workbookStore.activeSheet
  return sheet?.cells.get(uiStore.activeRef)?.format ?? {}
})

/** 获取当前选区内的所有单元格引用 */
function getSelectedRefs(): string[] {
  const range = uiStore.getSelectionRange()
  const bounds = getSelectionBounds(range.startRef, range.endRef)
  const refs: string[] = []
  for (let r = bounds.startRow; r <= bounds.endRow; r++) {
    for (let c = bounds.startCol; c <= bounds.endCol; c++) {
      refs.push(toCellRef(r, c))
    }
  }
  return refs
}

/** 应用格式片段到整个选区 */
function apply(patch: Partial<CellFormat>): void {
  workbookStore.applyFormat(getSelectedRefs(), patch)
}

// ---- 字体 ----
function onFontFamilyChange(e: Event): void {
  const v = (e.target as HTMLSelectElement).value
  if (v) apply({ fontFamily: v })
}
function onFontSizeChange(e: Event): void {
  const v = parseInt((e.target as HTMLSelectElement).value, 10)
  if (v > 0) apply({ fontSize: v })
}

// ---- 粗体/斜体/下划线（toggle，以激活格状态为准） ----
function toggleBold(): void { apply({ bold: !activeFormat.value.bold }) }
function toggleItalic(): void { apply({ italic: !activeFormat.value.italic }) }
function toggleUnderline(): void { apply({ underline: !activeFormat.value.underline }) }

// ---- 对齐 ----
function setAlign(align: 'left' | 'center' | 'right'): void {
  apply({ textAlign: align })
}

// ---- 边框 ----
/** 给选区四周套上细边框（黑） */
function setAllBorders(): void {
  const border = { color: '#000000', style: 'thin' as const }
  apply({ borderTop: border, borderBottom: border, borderLeft: border, borderRight: border })
}

// ---- 颜色 ----
function setBgColor(color: string | null): void {
  apply({ backgroundColor: color ?? undefined })
}
function setTextColor(color: string | null): void {
  apply({ textColor: color ?? undefined })
}

// ---- 数字格式 ----
function onNumberFormatChange(e: Event): void {
  const v = (e.target as HTMLSelectElement).value
  apply({ numberFormat: v || undefined })
}
</script>

<template>
  <div class="format-toolbar">
    <!-- 字体族 -->
    <select
      class="ft-select ft-font-family"
      :value="activeFormat.fontFamily ?? '宋体'"
      title="字体"
      @change="onFontFamilyChange"
    >
      <option v-for="f in FONT_FAMILIES" :key="f" :value="f">{{ f }}</option>
    </select>

    <!-- 字号 -->
    <select
      class="ft-select ft-font-size"
      :value="activeFormat.fontSize ?? 12"
      title="字号"
      @change="onFontSizeChange"
    >
      <option v-for="s in FONT_SIZES" :key="s" :value="s">{{ s }}</option>
    </select>

    <!-- 粗体/斜体/下划线 -->
    <button
      class="ft-btn"
      :class="{ 'ft-btn--active': activeFormat.bold }"
      title="粗体 Ctrl+B"
      @click="toggleBold"
    ><b>B</b></button>
    <button
      class="ft-btn"
      :class="{ 'ft-btn--active': activeFormat.italic }"
      title="斜体 Ctrl+I"
      @click="toggleItalic"
    ><i>I</i></button>
    <button
      class="ft-btn"
      :class="{ 'ft-btn--active': activeFormat.underline }"
      title="下划线 Ctrl+U"
      @click="toggleUnderline"
    ><u>U</u></button>

    <div class="ft-divider" />

    <!-- 对齐 -->
    <button class="ft-btn" title="左对齐" @click="setAlign('left')">≡</button>
    <button class="ft-btn" title="居中对齐" @click="setAlign('center')">☰</button>
    <button class="ft-btn" title="右对齐" @click="setAlign('right')">≡⤳</button>

    <div class="ft-divider" />

    <!-- 边框 -->
    <button class="ft-btn" title="全部边框（细线）" @click="setAllBorders">▦</button>

    <!-- 背景色 -->
    <div class="ft-color-wrap" title="背景色">
      <button
        class="ft-btn ft-color-btn"
        :style="{ backgroundColor: activeFormat.backgroundColor ?? 'transparent' }"
      >▨</button>
      <div class="ft-color-palette">
        <button
          v-for="c in BG_COLORS"
          :key="c ?? 'none'"
          class="ft-swatch"
          :style="{ backgroundColor: c ?? 'transparent' }"
          :title="c ?? '无色'"
          @click="setBgColor(c)"
        />
      </div>
    </div>

    <!-- 文字色 -->
    <div class="ft-color-wrap" title="文字颜色">
      <button
        class="ft-btn ft-color-btn"
        :style="{ color: activeFormat.textColor ?? '#000' }"
      >A</button>
      <div class="ft-color-palette">
        <button
          v-for="c in TEXT_COLORS"
          :key="c ?? 'default'"
          class="ft-swatch"
          :style="{ backgroundColor: c ?? 'transparent', borderColor: c ?? '#000' }"
          :title="c ?? '默认'"
          @click="setTextColor(c)"
        />
      </div>
    </div>

    <div class="ft-divider" />

    <!-- 数字格式 -->
    <select
      class="ft-select"
      :value="activeFormat.numberFormat ?? ''"
      title="数字格式"
      @change="onNumberFormatChange"
    >
      <option v-for="f in NUMBER_FORMATS" :key="f.label" :value="f.value ?? ''">{{ f.label }}</option>
    </select>
  </div>
</template>

<style scoped>
.format-toolbar {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 8px;
  background: var(--grid-bg);
  border-bottom: 1px solid var(--grid-cell-border);
  gap: 3px;
  font-size: 12px;
}

.ft-select {
  height: 22px;
  border: 1px solid var(--grid-cell-border);
  border-radius: 2px;
  background: var(--grid-bg);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.ft-select:hover {
  border-color: var(--color-primary);
}

.ft-font-family {
  width: 90px;
}

.ft-font-size {
  width: 52px;
}

.ft-btn {
  min-width: 26px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: 2px;
  background: none;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ft-btn:hover {
  background: var(--grid-header-bg);
  border-color: var(--grid-cell-border);
}

.ft-btn--active {
  background: var(--color-primary-light, #e8f0fe);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.ft-divider {
  width: 1px;
  height: 16px;
  background: var(--grid-cell-border);
  margin: 0 4px;
}

/* 颜色选择：按钮 + hover 弹出色板 */
.ft-color-wrap {
  position: relative;
  display: inline-flex;
}

.ft-color-btn {
  border: 1px solid var(--grid-cell-border);
}

.ft-color-palette {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 10;
  padding: 4px;
  background: var(--grid-bg);
  border: 1px solid var(--grid-cell-border);
  border-radius: 2px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  grid-template-columns: repeat(4, 18px);
  gap: 2px;
}

.ft-color-wrap:hover .ft-color-palette {
  display: grid;
}

.ft-swatch {
  width: 18px;
  height: 18px;
  border: 1px solid var(--grid-cell-border);
  border-radius: 2px;
  cursor: pointer;
  padding: 0;
}

.ft-swatch:hover {
  outline: 2px solid var(--color-primary);
}
</style>
