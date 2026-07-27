<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import { useWorkbookStore } from '@/stores/workbookStore'
import { useUiStore } from '@/stores/uiStore'
import { createCell } from '@/model/cell'
import { indexToCol, colToIndex, toCellRef } from '@/utils/columnUtils'
import { useVirtualScroll } from '@/composables/useVirtualScroll'
import { gridScrollRef } from '@/composables/useGridScrollRef'
import type { Cell } from '@/model/types'

const workbookStore = useWorkbookStore()
const uiStore = useUiStore()

const sheet = computed(() => workbookStore.activeSheet)
const rowCount = computed(() => sheet.value?.rowCount ?? 200)
const colCount = computed(() => sheet.value?.columnCount ?? 26)

/** 列标数组 */
const columnLabels = computed(() =>
  Array.from({ length: colCount.value }, (_, i) => indexToCol(i)),
)

// ---- 虚拟滚动 ----
// 使用共享 ref，让 useKeyboard 也能读取同一个 DOM 元素
const scrollContainer = gridScrollRef
const {
  startRow, endRow, offsetY, totalHeight, visibleRows, isRowVisible, updateContainerHeight,
} = useVirtualScroll(scrollContainer, {
  totalRows: rowCount,
  rowHeight: 24,
  overscan: 5,
})
// 当行数变化时重新测量
watch(rowCount, () => updateContainerHeight())

/** 编辑状态 */
const editValue = ref('')
const editCellRef = ref<string | null>(null)

/** 当前激活格的行列索引（用于高亮行列标签） */
const activeColIndex = computed(() => {
  const ref = uiStore.activeRef
  if (!ref) return -1
  const match = ref.match(/^([A-Z]+)(\d+)$/i)
  return match ? colToIndex(match[1].toUpperCase()) : -1
})

const activeRowIndex = computed(() => {
  const ref = uiStore.activeRef
  if (!ref) return -1
  const match = ref.match(/^([A-Z]+)(\d+)$/i)
  return match ? parseInt(match[2], 10) - 1 : -1
})

/** 获取单元格数据 */
function getCell(row: number, col: number): Cell {
  const ref = toCellRef(row, col)
  const cells = sheet.value?.cells
  return cells?.get(ref) ?? createCell(ref)
}

/** 双击 → 进入编辑 */
async function handleCellDblClick(row: number, col: number): Promise<void> {
  const ref = toCellRef(row, col)
  uiStore.selectCell(ref)
  editCellRef.value = ref
  const cell = getCell(row, col)
  editValue.value = cell.formula ?? String(cell.rawValue ?? '')
  uiStore.startEdit()

  // 等 Vue 渲染出 input 后再聚焦，确保 autofocus 生效
  await nextTick()
  const input = document.querySelector('.cell-input') as HTMLInputElement | null
  input?.focus()
}

/** 确认编辑 → 保存值，关闭编辑器并下移一行 */
function confirmEditAndMoveDown(): void {
  const ref = editCellRef.value
  if (!ref) return
  saveCurrentEdit()

  // 下移一行
  const match = ref.match(/^([A-Z]+)(\d+)$/i)
  if (match) {
    const col = colToIndex(match[1].toUpperCase())
    const row = parseInt(match[2], 10) - 1
    uiStore.selectCell(toCellRef(row + 1, col))
  }
}

/** 仅保存当前编辑值（失焦时使用），不清除选区 */
function saveEditOnBlur(): void {
  saveCurrentEdit()
}

/** 保存当前编辑值到 Store */
function saveCurrentEdit(): void {
  const ref = editCellRef.value
  if (!ref) return
  workbookStore.setCellValue(ref, editValue.value || null)
  editCellRef.value = null
  uiStore.cancelEdit()
}

/** 添加行输入 */
const addRowCount = ref(100)

function handleAddRows(): void {
  if (addRowCount.value > 0) {
    workbookStore.addRows(addRowCount.value)
  }
}


function isSelected(row: number, col: number): boolean {
  return uiStore.isInSelection(toCellRef(row, col))
}

function isActive(row: number, col: number): boolean {
  return toCellRef(row, col) === uiStore.activeRef
}

function isEditing(row: number, col: number): boolean {
  return editCellRef.value === toCellRef(row, col)
}

/**
 * 当通过键盘（F2/Enter）进入编辑模式时，
 * editCellRef 可能还未设置 → 自动同步为当前选区
 */
watch(
  () => uiStore.isEditing,
  (editing) => {
    if (editing && !editCellRef.value) {
      const ref = uiStore.activeRef
      editCellRef.value = ref
      const sheet = workbookStore.activeSheet
      const cell = sheet?.cells?.get(ref)
      editValue.value = cell?.formula ?? String(cell?.rawValue ?? '')
    }
  },
)

// 当编辑中的格被滚出视口 → 自动保存并取消编辑
watch(
  () => [editCellRef.value, startRow.value] as const,
  ([ref]) => {
    if (!ref) return
    const match = ref.match(/^([A-Z]+)(\d+)$/i)
    if (!match) return
    const row = parseInt(match[2], 10) - 1
    if (!isRowVisible(row)) {
      saveCurrentEdit()
    }
  },
)

/** 选区变化时保证目标格完整可见（鼠标点击等非键盘操作依赖此 watch） */
watch(
  () => uiStore.activeRef,
  (ref) => {
    if (!ref) return
    const match = ref.match(/^([A-Z]+)(\d+)$/i)
    if (!match) return
    const col = colToIndex(match[1].toUpperCase())
    const row = parseInt(match[2], 10) - 1

    void nextTick(() => {
      const el = scrollContainer.value
      if (!el) return

      const ROW_H = 24
      const COL_W = 100
      const COL_HEADER_H = 24  // <thead> 高度
      const ROW_HEADER_W = 48
      const JUMP_ROWS = 5
      const JUMP_COLS = 1

      // ---- 垂直（cellTop 必须加 COL_HEADER_H） ----
      const cellTop = COL_HEADER_H + row * ROW_H
      const cellBottom = cellTop + ROW_H
      const vpTop = el.scrollTop
      const vpBottom = vpTop + el.clientHeight

      if (cellTop < vpTop) {
        el.scrollTop = Math.max(0, cellTop - JUMP_ROWS * ROW_H - 1)
      } else if (cellBottom > vpBottom) {
        el.scrollTop = cellTop - el.clientHeight + ROW_H + JUMP_ROWS * ROW_H + 1
      }

      // ---- 水平 ----
      const cellLeft = col * COL_W + ROW_HEADER_W
      const cellRight = cellLeft + COL_W
      const vpLeft = el.scrollLeft
      const vpRight = vpLeft + el.clientWidth

      if (cellLeft < vpLeft) {
        el.scrollLeft = Math.max(0, cellLeft - JUMP_COLS * COL_W - 1)
      } else if (cellRight > vpRight) {
        el.scrollLeft = cellLeft - el.clientWidth + COL_W + JUMP_COLS * COL_W + 1
      }
    })
  },
  { flush: 'post' },
)
</script>

<template>
  <div ref="scrollContainer" class="grid-scroll" @mouseup="uiStore.finishSelection()" @mouseleave="uiStore.finishSelection()">
    <table class="grid-table">
      <thead>
        <tr>
          <th class="corner" />
          <th v-for="label in columnLabels" :key="label" class="col-header" :class="{ 'col-header--active': colToIndex(label) === activeColIndex }">{{ label }}</th>
        </tr>
      </thead>
      <tbody>
        <!-- 上方占位 spacer -->
        <tr v-if="offsetY > 0" :style="{ height: offsetY + 'px' }" />
        <tr v-for="row in visibleRows" :key="row.index">
          <td class="row-header" :class="{ 'row-header--active': row.index === activeRowIndex }">{{ row.number }}</td>
          <td
            v-for="colIdx in colCount"
            :key="colIdx"
            class="cell"
            :class="{
              'cell--selected': isSelected(row.index, colIdx - 1),
              'cell--active': isActive(row.index, colIdx - 1),
            }"
            @mousedown.prevent="uiStore.startRangeSelection(toCellRef(row.index, colIdx - 1))"
            @mouseenter="if (uiStore.isDragging) { uiStore.extendSelection(toCellRef(row.index, colIdx - 1)); }"
            @dblclick="handleCellDblClick(row.index, colIdx - 1)"
          >
            <template v-if="isEditing(row.index, colIdx - 1)">
              <input
                v-model="editValue"
                class="cell-input"
                @keydown.enter.prevent="confirmEditAndMoveDown()"
                @keydown.escape.prevent="editCellRef = null; uiStore.cancelEdit()"
                @blur="saveEditOnBlur()"
              />
            </template>
            <template v-else>
              <span class="cell-value">
                {{ getCell(row.index, colIdx - 1).computedValue ?? '' }}
              </span>
            </template>
          </td>
        </tr>
        <!-- 下方占位 spacer -->
        <tr v-if="endRow < rowCount" :style="{ height: (totalHeight - endRow * 24) + 'px' }" />
        <!-- 添加行输入行（放在 spacer 之后，不参与虚拟滚动高度计算） -->
        <tr class="add-row-row">
          <td class="row-header add-row-label" @click="handleAddRows()">+</td>
          <td :colspan="colCount" class="add-row-cell">
            <input
              v-model.number="addRowCount"
              class="add-row-input"
              type="number"
              min="1"
              @keydown.enter.prevent="handleAddRows()"
            />
            <span class="add-row-text">行</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* 滚动容器 */
.grid-scroll {
  flex: 1;
  overflow: auto;
  position: relative;
}

.grid-table {
  border-collapse: collapse;
  table-layout: fixed;
  min-width: 100%;
}

/* 左上角空白格 */
.corner {
  position: sticky;
  top: 0;
  left: 0;
  z-index: 3;
  width: var(--row-header-width);
  min-width: var(--row-header-width);
  height: var(--column-header-height);
  background: var(--grid-header-bg);
  border-right: 1px solid var(--grid-header-border);
  border-bottom: 1px solid var(--grid-header-border);
}

/* 列标 */
.col-header {
  position: sticky;
  top: 0;
  z-index: 2;
  height: var(--column-header-height);
  background: var(--grid-header-bg);
  border-right: 1px solid var(--grid-cell-border);
  border-bottom: 1px solid var(--grid-header-border);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  text-align: center;
  user-select: none;
  width: var(--default-cell-width);
  min-width: var(--default-cell-width);
  transition: background 0.1s;
}

.col-header--active {
  background: var(--grid-selection-bg);
  color: var(--primary-color);
  font-weight: 700;
}

/* 行号 */
.row-header {
  position: sticky;
  left: 0;
  z-index: 1;
  width: var(--row-header-width);
  min-width: var(--row-header-width);
  height: var(--default-cell-height);
  background: var(--grid-header-bg);
  border-right: 1px solid var(--grid-header-border);
  border-bottom: 1px solid var(--grid-cell-border);
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  user-select: none;
  transition: background 0.1s;
}

.row-header--active {
  background: var(--grid-selection-bg);
  color: var(--primary-color);
  font-weight: 700;
}

/* 普通单元格 */
.cell {
  width: var(--default-cell-width);
  min-width: var(--default-cell-width);
  height: var(--default-cell-height);
  padding: 0 4px;
  border-right: 1px solid var(--grid-cell-border);
  border-bottom: 1px solid var(--grid-cell-border);
  background: var(--grid-bg);
  cursor: cell;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
}

.cell:hover {
  background: var(--grid-row-hover-bg);
}

/* 选区范围（多格蓝色背景） */
.cell--selected {
  background: var(--grid-selection-bg);
}

/* 当前激活格（深色边框） */
.cell--active {
  outline: 2px solid var(--grid-active-cell-border);
  outline-offset: -2px;
  z-index: 0;
}

.cell-value {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: var(--default-cell-height);
}

.cell-input {
  width: 100%;
  height: calc(var(--default-cell-height) - 2px);
  border: none;
  outline: none;
  font-size: 13px;
  font-family: inherit;
  padding: 0;
  background: var(--grid-active-cell-bg);
}

/* 添加行输入行 */
.add-row-row {
  border-top: 2px solid var(--grid-active-cell-border);
}

.add-row-label {
  color: var(--primary-color);
  font-weight: bold;
  cursor: pointer;
  user-select: none;
}

.add-row-label:hover {
  background: var(--grid-row-hover-bg);
}

.add-row-cell {
  padding: 6px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.add-row-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.add-row-input {
  width: 64px;
  padding: 2px 6px;
  border: 1px solid var(--grid-header-border);
  border-radius: 3px;
  text-align: center;
  font-size: 13px;
  outline: none;
}

.add-row-input:focus {
  border-color: var(--primary-color);
}


</style>
