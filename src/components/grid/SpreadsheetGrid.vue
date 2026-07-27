<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import { useWorkbookStore } from '@/stores/workbookStore'
import { useUiStore } from '@/stores/uiStore'
import { createCell } from '@/model/cell'
import { indexToCol, colToIndex, toCellRef } from '@/utils/columnUtils'
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

/** 编辑状态 */
const editValue = ref('')
const editCellRef = ref<string | null>(null)

/** 获取单元格数据 */
function getCell(row: number, col: number): Cell {
  const ref = toCellRef(row, col)
  const cells = sheet.value?.cells
  return cells?.get(ref) ?? createCell(ref)
}

/** 单击 → 选中 */
function handleCellClick(row: number, col: number): void {
  const ref = toCellRef(row, col)
  uiStore.selectCell(ref)
  editCellRef.value = null
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

const activeRef = computed(() => uiStore.activeRef)

function isSelected(row: number, col: number): boolean {
  return toCellRef(row, col) === activeRef.value
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
</script>

<template>
  <div class="grid-scroll">
    <table class="grid-table">
      <thead>
        <tr>
          <!-- 左上角 -->
          <th class="corner" />
          <!-- 列标 -->
          <th
            v-for="label in columnLabels"
            :key="label"
            class="col-header"
          >
            {{ label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="rowIdx in rowCount" :key="rowIdx">
          <!-- 行号 -->
          <td class="row-header">
            {{ rowIdx }}
          </td>
          <!-- 单元格 -->
          <td
            v-for="colIdx in colCount"
            :key="colIdx"
            class="cell"
            :class="{
              'cell--selected': isSelected(rowIdx - 1, colIdx - 1),
            }"
            @click="handleCellClick(rowIdx - 1, colIdx - 1)"
            @dblclick="handleCellDblClick(rowIdx - 1, colIdx - 1)"
          >
            <template v-if="isEditing(rowIdx - 1, colIdx - 1)">
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
                {{ getCell(rowIdx - 1, colIdx - 1).computedValue ?? '' }}
              </span>
            </template>
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

/* 选中态 */
.cell--selected {
  outline: 2px solid var(--grid-active-cell-border);
  outline-offset: -2px;
  background: var(--grid-selection-bg);
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
</style>
