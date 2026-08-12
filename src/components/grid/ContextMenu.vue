<script setup lang="ts">
import { ref } from 'vue'
import { useWorkbookStore } from '@/stores/workbookStore'
import { useUiStore } from '@/stores/uiStore'
import { toCellRef } from '@/utils/columnUtils'
import {
  clipboardManager,
  serializeSelection,
  getSelectionBounds,
  computePasteCells,
  parseTSV,
} from '@/services/clipboardManager'
import { CutPasteCommand } from '@/model/command'
import { commandService } from '@/services/commandService'

const workbookStore = useWorkbookStore()
const uiStore = useUiStore()

// 由父组件 SpreadsheetGrid 控制
const visible = ref(false)
const x = ref(0)
const y = ref(0)
const targetRow = ref(0)
const targetCol = ref(0)

/** 显示菜单 */
function show(px: number, py: number, row: number, col: number): void {
  x.value = px
  y.value = py
  targetRow.value = row
  targetCol.value = col
  visible.value = true
}

/** 隐藏菜单 */
function hide(): void {
  visible.value = false
}

/** 选中目标格并执行操作 */
function focusTarget(): void {
  const ref = `${String.fromCharCode(65 + targetCol.value)}${targetRow.value + 1}`
  uiStore.selectCell(ref)
}

async function onCopy(): Promise<void> {
  const sheet = workbookStore.activeSheet
  if (!sheet) return
  focusTarget()
  const range = uiStore.getSelectionRange()
  const bounds = getSelectionBounds(range.startRef, range.endRef)
  const tsv = serializeSelection(sheet, bounds)
  clipboardManager.startCopy({ startRef: range.startRef, endRef: range.endRef }, tsv)
  hide()
}

async function onCut(): Promise<void> {
  const sheet = workbookStore.activeSheet
  if (!sheet) return
  focusTarget()
  const range = uiStore.getSelectionRange()
  const bounds = getSelectionBounds(range.startRef, range.endRef)
  const tsv = serializeSelection(sheet, bounds)
  clipboardManager.startCut({ startRef: range.startRef, endRef: range.endRef }, tsv)
  hide()
}

async function onPaste(): Promise<void> {
  const sheet = workbookStore.activeSheet
  if (!sheet) return
  focusTarget()

  // 源选区：剪切/复制虚线框位置（公式相对引用偏移需要）
  const offsetSourceBounds = clipboardManager.sourceRange
    ? getSelectionBounds(clipboardManager.sourceRange.startRef, clipboardManager.sourceRange.endRef)
    : null
  // 仅剪切模式清空源格
  const isCutPaste = clipboardManager.isCutMode

  const clipText = await clipboardManager.readSystemClipboard()
  const data = parseTSV(clipText)
  if (data.length === 0) { hide(); return }
  const cells = computePasteCells(sheet, uiStore.activeRef, data, offsetSourceBounds)

  if (isCutPaste && offsetSourceBounds) {
    const sourceRefs: string[] = []
    for (let r = offsetSourceBounds.startRow; r <= offsetSourceBounds.endRow; r++) {
      for (let c = offsetSourceBounds.startCol; c <= offsetSourceBounds.endCol; c++) {
        sourceRefs.push(toCellRef(r, c))
      }
    }
    commandService.execute(
      new CutPasteCommand(sheet, sourceRefs, cells, clipboardManager.tsvCache),
      { skipClipboardReset: true },
    )
    // 剪切粘贴的公式统一求值
    workbookStore.evaluatePastedFormulas(cells)
    clipboardManager.exitCutMode()
  } else {
    workbookStore.pasteCells(cells)
  }
  hide()
}

function onInsertRowAbove(): void {
  focusTarget()
  workbookStore.insertRow(targetRow.value - 1)
  hide()
}

function onInsertRowBelow(): void {
  focusTarget()
  workbookStore.insertRow(targetRow.value)
  hide()
}

function onDeleteRow(): void {
  focusTarget()
  workbookStore.deleteRow(targetRow.value)
  hide()
}

function onInsertColLeft(): void {
  focusTarget()
  workbookStore.insertColumn(targetCol.value - 1)
  hide()
}

function onInsertColRight(): void {
  focusTarget()
  workbookStore.insertColumn(targetCol.value)
  hide()
}

function onDeleteCol(): void {
  focusTarget()
  workbookStore.deleteColumn(targetCol.value)
  hide()
}

// 点击菜单外部关闭
function onBackdropClick(): void {
  hide()
}

defineExpose({ show, hide })
</script>

<template>
  <!-- 遮罩层（捕获点击关闭） -->
  <div v-if="visible" class="context-menu-backdrop" @click="onBackdropClick" @contextmenu.prevent="onBackdropClick">
    <div
      class="context-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
      @click.stop
    >
      <div class="menu-item" @click="onCopy">
        <span>复制</span>
        <span class="menu-shortcut">Ctrl+C</span>
      </div>
      <div class="menu-item" @click="onCut">
        <span>剪切</span>
        <span class="menu-shortcut">Ctrl+X</span>
      </div>
      <div class="menu-item" @click="onPaste">
        <span>粘贴</span>
        <span class="menu-shortcut">Ctrl+V</span>
      </div>
      <div class="menu-divider" />
      <div class="menu-item" @click="onInsertRowAbove">
        <span>在上方插入行</span>
      </div>
      <div class="menu-item" @click="onInsertRowBelow">
        <span>在下方插入行</span>
      </div>
      <div class="menu-item menu-item--danger" @click="onDeleteRow">
        <span>删除当前行</span>
      </div>
      <div class="menu-divider" />
      <div class="menu-item" @click="onInsertColLeft">
        <span>在左侧插入列</span>
      </div>
      <div class="menu-item" @click="onInsertColRight">
        <span>在右侧插入列</span>
      </div>
      <div class="menu-item menu-item--danger" @click="onDeleteCol">
        <span>删除当前列</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.context-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.context-menu {
  position: fixed;
  min-width: 180px;
  background: #fff;
  border: 1px solid var(--grid-header-border);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  padding: 4px 0;
  z-index: 1000;
}

.menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 16px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.menu-item:hover {
  background: var(--grid-row-hover-bg);
}

.menu-item--danger {
  color: #e53935;
}

.menu-shortcut {
  color: var(--text-secondary);
  font-size: 11px;
  margin-left: 24px;
}

.menu-divider {
  height: 1px;
  background: var(--grid-cell-border);
  margin: 4px 0;
}
</style>
