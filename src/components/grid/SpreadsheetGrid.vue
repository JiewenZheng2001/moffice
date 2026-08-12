<script setup lang="ts">
import { computed, ref, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useWorkbookStore } from '@/stores/workbookStore'
import { useUiStore } from '@/stores/uiStore'
import { createCell } from '@/model/cell'
import { indexToCol, colToIndex, toCellRef } from '@/utils/columnUtils'
import { useVirtualScroll } from '@/composables/useVirtualScroll'
import { gridScrollRef } from '@/composables/useGridScrollRef'
import ContextMenu from './ContextMenu.vue'
import type { Cell, CellFormat } from '@/model/types'

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

/** 单元格鼠标按下：格式刷模式应用格式，否则开始选区 */
function onCellMouseDown(row: number, col: number): void {
  // 点击单元格时让任何输入框失焦（避免复制粘贴被 isInputFocused 拦截）
  if (document.activeElement?.tagName === 'INPUT') {
    ;(document.activeElement as HTMLElement).blur()
  }
  saveCurrentEdit()

  // 格式刷模式：把源格式应用到目标格，不移动选区
  if (uiStore.isPainting) {
    const target = toCellRef(row, col)
    const fmt = uiStore.paintFormat
    if (Object.keys(fmt).length > 0) {
      // 应用格式（命令模式，支持撤销）
      workbookStore.applyFormat([target], fmt as never)
    }
    // 单次模式自动退出（连续模式保持）
    uiStore.finishPaintOnce()
    return
  }

  uiStore.startRangeSelection(toCellRef(row, col))
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

// ---- 右键菜单 ----
const contextMenuRef = ref<InstanceType<typeof ContextMenu> | null>(null)

function onCellContextMenu(e: MouseEvent, row: number, col: number): void {
  e.preventDefault()
  contextMenuRef.value?.show(e.clientX, e.clientY, row, col)
}

// ---- 列宽/行高拖拽调整 ----

function onColResizeStart(e: MouseEvent, colIndex: number): void {
  const sheet = workbookStore.activeSheet
  if (!sheet) return
  const currentWidth = sheet.columnWidths.get(colIndex) ?? 100
  uiStore.startResize('col', colIndex, e.clientX, e.clientY, currentWidth)
}

function onRowResizeStart(e: MouseEvent, rowIndex: number): void {
  const sheet = workbookStore.activeSheet
  if (!sheet) return
  const currentHeight = sheet.rowHeights.get(rowIndex) ?? 24
  uiStore.startResize('row', rowIndex, e.clientX, e.clientY, currentHeight)
}

function onWindowMouseMove(e: MouseEvent): void {
  if (!uiStore.resizeState) return
  const newSize = uiStore.updateResize(e.clientX, e.clientY)
  const sheet = workbookStore.activeSheet
  if (!sheet) return
  const { type, index } = uiStore.resizeState
  if (type === 'col') {
    sheet.columnWidths.set(index, newSize)
  } else {
    sheet.rowHeights.set(index, newSize)
  }
}

function onWindowMouseUp(_e: MouseEvent): void {
  if (!uiStore.resizeState) return
  uiStore.finishResize()
}

// 注册/注销 window 级 resize 监听
onMounted(() => {
  window.addEventListener('mousemove', onWindowMouseMove)
  window.addEventListener('mouseup', onWindowMouseUp)
})
onUnmounted(() => {
  window.removeEventListener('mousemove', onWindowMouseMove)
  window.removeEventListener('mouseup', onWindowMouseUp)
})


/** 获取指定列的实际宽度（优先取自定义宽度） */
function getColWidth(colIndex: number): number {
  return sheet.value?.columnWidths.get(colIndex) ?? 100
}

/** 获取指定行的实际高度（优先取自定义高度） */
function getRowHeight(rowIndex: number): number {
  return sheet.value?.rowHeights.get(rowIndex) ?? 24
}

function isSelected(row: number, col: number): boolean {
  return uiStore.isInSelection(toCellRef(row, col))
}

function isActive(row: number, col: number): boolean {
  return toCellRef(row, col) === uiStore.activeRef
}

/** 是否在剪切或复制的虚线框内 */
function isInCutRange(row: number, col: number): boolean {
  const range = uiStore.cutRange ?? uiStore.copyRange
  if (!range) return false
  const ref = toCellRef(row, col)
  return isBetweenRef(ref, range.startRef, range.endRef)
}

/** 判断 ref 是否在 startRef→endRef 矩形内 */
function isBetweenRef(ref: string, a: string, b: string): boolean {
  const r = parseRefRowCol(ref)
  const s = parseRefRowCol(a)
  const e = parseRefRowCol(b)
  if (!r || !s || !e) return false
  const rMin = Math.min(s.row, e.row), rMax = Math.max(s.row, e.row)
  const cMin = Math.min(s.col, e.col), cMax = Math.max(s.col, e.col)
  return r.row >= rMin && r.row <= rMax && r.col >= cMin && r.col <= cMax
}

function parseRefRowCol(ref: string): { row: number; col: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  return { col: colToIndex(m[1].toUpperCase()), row: parseInt(m[2], 10) - 1 }
}

function isEditing(row: number, col: number): boolean {
  return editCellRef.value === toCellRef(row, col)
}

/** 边框样式 → CSS border 宽度（thin/medium/thick 映射） */
const BORDER_WIDTHS: Record<string, string> = {
  thin: '1px',
  medium: '2px',
  thick: '3px',
  dashed: '1px',
  dotted: '1px',
  double: '3px',
}

/** 边框样式 → CSS border-style（实线/虚线等） */
const BORDER_STYLES: Record<string, string> = {
  thin: 'solid',
  medium: 'solid',
  thick: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
  double: 'double',
}

/**
 * 生成单元格的内联样式（应用 CellFormat）
 * 优先级高于 CSS 类中的默认网格线，用户设置的边框会覆盖网格线
 *
 * 边框渲染采用"邻居合并"策略，解决相邻单元格边框重叠变粗的问题：
 * - 每条边只由一个单元格负责绘制（约定：左/上单元格优先）
 * - 内部右/下边：由右/下邻居的 borderLeft/borderTop 绘制（自己画 left/top）
 * - 表格最右列/最下行：没有邻居，自己补绘 borderRight/borderBottom
 * - 单元格显示时：left/top 取"自己 borderLeft/top ?? 左/上邻居 borderRight/bottom"
 */
function cellStyle(row: number, col: number): Record<string, string> {
  const fmt = getCell(row, col).format
  const style: Record<string, string> = {}

  if (fmt.fontFamily) style.fontFamily = fmt.fontFamily
  if (fmt.fontSize) style.fontSize = `${fmt.fontSize}px`
  if (fmt.bold) style.fontWeight = 'bold'
  if (fmt.italic) style.fontStyle = 'italic'
  if (fmt.underline) style.textDecoration = 'underline'
  if (fmt.textColor) style.color = fmt.textColor
  if (fmt.backgroundColor) style.backgroundColor = fmt.backgroundColor
  if (fmt.textAlign) style.textAlign = fmt.textAlign
  if (fmt.verticalAlign) style.verticalAlign = fmt.verticalAlign

  // 邻居格式（虚拟滚动下 getCell 只读 Map，无渲染开销）
  const leftNeighbor = col > 0 ? getCell(row, col - 1).format : null
  const topNeighbor = row > 0 ? getCell(row - 1, col).format : null
  const hasRightNeighbor = col + 1 < colCount.value
  const hasBottomNeighbor = row + 1 < rowCount.value

  // 左/上：自己优先，否则继承邻居的右/下边框（共享边只画一次）
  const left = fmt.borderLeft ?? leftNeighbor?.borderRight
  const top = fmt.borderTop ?? topNeighbor?.borderBottom
  // 右/下：有邻居时不画（由邻居的 left/top 负责）；无邻居（边界）时补绘
  const right = hasRightNeighbor ? null : fmt.borderRight
  const bottom = hasBottomNeighbor ? null : fmt.borderBottom

  const borders: Array<[keyof CellFormat, string, CellFormat['borderLeft'] | null]> = [
    ['borderLeft', 'borderLeft', left ?? null],
    ['borderTop', 'borderTop', top ?? null],
    ['borderRight', 'borderRight', right ?? null],
    ['borderBottom', 'borderBottom', bottom ?? null],
  ]
  for (const [, cssKey, b] of borders) {
    if (b) {
      style[cssKey] = `${BORDER_WIDTHS[b.style]} ${BORDER_STYLES[b.style]} ${b.color}`
    }
  }
  return style
}

/**
 * 数字格式化显示（numberFormat 支持）
 * 支持：千分位 #,##0、小数位 0.00、百分比 0%、货币 ¥/$、组合
 * 日期/时间等复杂格式暂不支持（显示原始值）
 */
function formatNumberValue(value: number, format: string): string {
  const isPercent = format.includes('%')
  const currency = format.startsWith('¥') ? '¥' : format.startsWith('$') ? '$' : ''
  // 小数位数：格式中 "." 后 0 的个数（如 "0.00" → 2）
  const dotMatch = format.match(/\.(0+)/)
  const decimals = dotMatch ? dotMatch[1].length : 0
  const useThousands = format.includes(',')

  let v = value
  if (isPercent) v = value * 100

  let s = v.toFixed(decimals)
  if (useThousands) {
    const [int, frac] = s.split('.')
    // 千分位正则：从右往左每 3 位插逗号
    s = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '')
  }
  return currency + s + (isPercent ? '%' : '')
}

/** 单元格显示文本：公式错误优先 → 数字格式 → 原值 */
function displayText(cell: { error: string | null; computedValue: unknown; format: CellFormat }): string {
  if (cell.error) return cell.error
  const val = cell.computedValue
  const fmt = cell.format
  if (typeof val === 'number' && fmt.numberFormat && fmt.numberFormat !== 'General') {
    return formatNumberValue(val, fmt.numberFormat)
  }
  return val === null || val === undefined ? '' : String(val)
}

/**
 * 当通过键盘（F2 / 直接输入）进入编辑模式时，
 * editCellRef 可能还未设置 → 自动同步为当前选区
 * 并聚焦输入框（双击路径在 handleCellDblClick 中已聚焦）
 */
watch(
  () => uiStore.isEditing,
  async (editing) => {
    // 任何路径退出编辑（Esc/Tab/失焦/提交）都清空 editCellRef，
    // 保证下一次进入编辑时 watch 条件 `!editCellRef.value` 成立。
    // 否则会出现：编辑 → Esc（仅 uiStore.cancelEdit）→ 再输入字符 → watch 被跳过 → 编辑框残留旧值
    if (!editing) {
      editCellRef.value = null
      return
    }
    if (editing && !editCellRef.value) {
      const ref = uiStore.activeRef
      editCellRef.value = ref
      const sheet = workbookStore.activeSheet
      const cell = sheet?.cells?.get(ref)
      // 直接键盘输入（type-to-edit）：初始内容为输入字符，替换原值
      // F2 / 双击：保留原内容
      editValue.value = uiStore.editInitialValue
        ?? cell?.formula
        ?? String(cell?.rawValue ?? '')
      uiStore.consumeEditInitialValue()
      // 等 Vue 渲染出 input 后再聚焦，确保键盘输入直接进入编辑器
      await nextTick()
      const input = document.querySelector('.cell-input') as HTMLInputElement | null
      input?.focus()
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

</script>

<template>
  <div
    ref="scrollContainer"
    class="grid-scroll"
    :class="{ 'grid-scroll--painting': uiStore.isPainting }"
    @mouseup="uiStore.finishSelection()"
    @mouseleave="uiStore.finishSelection()"
  >
    <table class="grid-table">
      <thead>
        <tr>
          <th class="corner" />
          <th v-for="label in columnLabels" :key="label" class="col-header" :class="{ 'col-header--active': colToIndex(label) === activeColIndex }" :style="{ width: getColWidth(colToIndex(label)) + 'px', minWidth: getColWidth(colToIndex(label)) + 'px' }">
            {{ label }}
            <div
              class="col-resize-handle"
              @mousedown.stop.prevent="onColResizeStart($event, colToIndex(label))"
            />
          </th>
        </tr>
      </thead>
      <tbody>
        <!-- 上方占位 spacer -->
        <tr v-if="offsetY > 0" :style="{ height: offsetY + 'px' }" />
        <tr v-for="row in visibleRows" :key="row.index">
          <td class="row-header" :class="{ 'row-header--active': row.index === activeRowIndex }" :style="{ height: getRowHeight(row.index) + 'px' }">
            {{ row.number }}
            <div
              class="row-resize-handle"
              @mousedown.stop.prevent="onRowResizeStart($event, row.index)"
            />
          </td>
          <td
            v-for="colIdx in colCount"
            :key="colIdx"
            class="cell"
            :style="[{ width: getColWidth(colIdx - 1) + 'px', minWidth: getColWidth(colIdx - 1) + 'px' }, cellStyle(row.index, colIdx - 1)]"
            :class="{
              'cell--selected': isSelected(row.index, colIdx - 1),
              'cell--active': isActive(row.index, colIdx - 1),
              'cell--cut': isInCutRange(row.index, colIdx - 1),
            }"
            @mousedown.prevent="onCellMouseDown(row.index, colIdx - 1)"
            @mouseenter="if (uiStore.isDragging) { uiStore.extendSelection(toCellRef(row.index, colIdx - 1)); }"
            @dblclick="handleCellDblClick(row.index, colIdx - 1)"
            @contextmenu.prevent="onCellContextMenu($event, row.index, colIdx - 1)"
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
                {{ displayText(getCell(row.index, colIdx - 1)) }}
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
  <ContextMenu ref="contextMenuRef" />
</template>

<style scoped>
/* 滚动容器 */
.grid-scroll {
  flex: 1;
  overflow: auto;
  position: relative;
}

/* 格式刷模式：光标变为刷子提示 */
.grid-scroll--painting {
  cursor: copy;
}

.grid-scroll--painting .cell {
  cursor: copy;
}

.grid-table {
  /* separate 模式让 box-shadow 在 <td> 上正常渲染（collapse 有 Chromium bug） */
  border-collapse: separate;
  border-spacing: 0;
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

/* 列宽拖拽手柄 */
.col-resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  z-index: 1;
}
.col-resize-handle:hover {
  background: var(--primary-color);
  opacity: 0.3;
}

/* 行号（sticky 左冻结，同时为 resize 手柄提供定位容器） */
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

/* 行高拖拽手柄 */
.row-resize-handle {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 5px;
  cursor: row-resize;
  z-index: 1;
}
.row-resize-handle:hover {
  background: var(--primary-color);
  opacity: 0.3;
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

/* 当前激活格（separate 模式下 box-shadow 可正常渲染，不参与 z-index 穿透） */
.cell--active {
  position: relative;
  box-shadow: 0 0 0 2px var(--grid-active-cell-border);
  z-index: 0;
}

/* 剪切模式虚线框（Excel marching ants 效果） */
.cell--cut {
  outline: 2px dashed var(--grid-active-cell-border);
  outline-offset: -1px;
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
