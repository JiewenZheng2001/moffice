<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useWorkbookStore } from '@/stores/workbookStore'
import { exportXlsx, exportCsv } from '@/services/exportService'
import { importXlsx, importCsv } from '@/services/importService'
import { saveWorkbook, loadWorkbook, listWorkbooks, renameWorkbook, deleteWorkbook, ApiError } from '@/services/workbookService'
import type { WorkbookMeta } from '@/services/workbookService'

/** 是否已登录（由 AppShell 传入，控制云端按钮可用性） */
const props = defineProps<{ authed: boolean }>()

const workbookStore = useWorkbookStore()
const fileInput = ref<HTMLInputElement | null>(null)

// ---- 后端保存状态 ----

/** 保存状态：idle 未操作 / saving 保存中 / saved 已保存 / error 失败 */
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const saveState = ref<SaveState>('idle')
const saveError = ref('')

/** 打开面板（工作簿列表） */
const openPanelVisible = ref(false)
const workbookList = ref<WorkbookMeta[]>([])
const listError = ref('')

// ---- 自动保存（数据变更后 debounce 2s 自动保存） ----

const AUTOSAVE_DELAY = 2000
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving = false

/** 手动保存当前工作簿到后端 */
async function handleSave(): Promise<void> {
  // 防重入：自动保存进行中时手动保存直接等它完成
  if (saving) return
  saving = true
  saveState.value = 'saving'
  saveError.value = ''
  try {
    await saveWorkbook(workbookStore.workbook)
    // 保存成功 → 记住工作簿 id（刷新后自动恢复用）
    workbookStore.persistWorkbookId(workbookStore.workbook.id)
    saveState.value = 'saved'
  } catch (err) {
    saveState.value = 'error'
    saveError.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    saving = false
  }
}

/**
 * 深度监听工作簿数据变更 → 防抖后自动保存
 *
 * 注意点：
 * 1. deep watch 才能捕获 cells Map 的增删改（Pinia 的 state 本身是响应式的）
 * 2. 加载/导入/恢复工作簿也会触发变更 → 用 autoSaveSuppressed 标记跳过（加载后无需回写）
 * 3. 保存中又发生变更 → 重置计时器，等下一轮（始终保存最新状态）
 */

watch(
  () => workbookStore.workbook,
  () => {
    // 加载/恢复/导入触发的工作簿替换 → 跳过自动保存回写
    if (workbookStore.autoSaveSuppressed) {
      workbookStore.autoSaveSuppressed = false
      return
    }
    // 未登录不自动保存（无 token，保存必然 401）
    if (!props.authed) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void handleSave()
    }, AUTOSAVE_DELAY)
    saveState.value = 'idle' // 有未保存变更
  },
  { deep: true },
)

onUnmounted(() => {
  if (saveTimer) clearTimeout(saveTimer)
})

// ---- 打开/保存面板 ----

/** 展开打开面板 → 拉取工作簿列表 */
async function toggleOpenPanel(): Promise<void> {
  openPanelVisible.value = !openPanelVisible.value
  if (!openPanelVisible.value) return
  listError.value = ''
  try {
    const res = await listWorkbooks()
    workbookList.value = res.workbooks
  } catch (err) {
    listError.value = err instanceof ApiError ? err.message : String(err)
    workbookList.value = []
  }
}

/** 加载选中的工作簿 */
async function handleOpen(id: string): Promise<void> {
  try {
    const loaded = await loadWorkbook(id)
    // replaceWorkbook 内部已置 autoSaveSuppressed（跳过自动保存回写）+ 持久化 id
    workbookStore.replaceWorkbook(loaded)
    openPanelVisible.value = false
    saveState.value = 'saved'
  } catch (err) {
    alert('打开失败：' + (err as Error).message)
  }
}

/** 重命名工作簿（浏览器 prompt 输入新名字） */
async function handleRename(wb: WorkbookMeta): Promise<void> {
  const newName = prompt('输入新名称：', wb.name)
  if (newName === null || newName.trim() === '' || newName.trim() === wb.name) return
  try {
    await renameWorkbook(wb.id, newName.trim())
    // 如果重命名的是当前打开的工作簿，同步 store 名称
    if (wb.id === workbookStore.workbook.id) {
      workbookStore.workbook.name = newName.trim()
      workbookStore.autoSaveSuppressed = true // 改名不触发保存回写（后端已改）
    }
    await refreshList()
  } catch (err) {
    alert('重命名失败：' + (err as Error).message)
  }
}

/** 删除工作簿（confirm 确认） */
async function handleDelete(wb: WorkbookMeta): Promise<void> {
  if (!confirm(`确定删除「${wb.name}」？此操作不可恢复。`)) return
  try {
    await deleteWorkbook(wb.id)
    await refreshList()
  } catch (err) {
    alert('删除失败：' + (err as Error).message)
  }
}

/** 重新拉取列表（重命名/删除后刷新） */
async function refreshList(): Promise<void> {
  try {
    const res = await listWorkbooks()
    workbookList.value = res.workbooks
  } catch {
    /* 面板已打开时失败静默 */
  }
}

/** 触发文件选择 → 导入 */
function handleImportClick(): void {
  fileInput.value?.click()
}

/** 导入文件 */
async function handleFileChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const ext = file.name.split('.').pop()?.toLowerCase()
    let result

    if (ext === 'xlsx') {
      result = await importXlsx(file)
    } else if (ext === 'csv') {
      result = await importCsv(file)
    } else {
      alert('不支持的文件格式，请选择 .xlsx 或 .csv 文件')
      return
    }

    if (result.sheets.length > 0) {
      // 多 sheet 全量导入（替换整个工作簿，等价于"打开文件"）
      // importSheets 内部已置 autoSaveSuppressed + 持久化新 id
      workbookStore.importSheets(result.sheets)
    }
  } catch (err) {
    console.error('导入失败:', err)
    alert('导入失败：' + (err as Error).message)
  } finally {
    // 清除选择，让同一个文件可重复导入
    input.value = ''
  }
}

/** 导出 XLSX（导出工作簿的全部 sheets） */
async function handleExportXlsx(): Promise<void> {
  const sheets = workbookStore.workbook.sheets
  if (sheets.length === 0) return
  await exportXlsx(sheets)
}

/** 导出 CSV */
async function handleExportCsv(): Promise<void> {
  const sheet = workbookStore.activeSheet
  if (!sheet) return
  await exportCsv(sheet)
}
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-group">
      <button class="tb-btn" title="撤销 Ctrl+Z" @click="workbookStore.undo()">
        <span>↩</span>
      </button>
      <button class="tb-btn" title="重做 Ctrl+Y" @click="workbookStore.redo()">
        <span>↪</span>
      </button>
    </div>
    <div class="toolbar-divider" />
    <div class="toolbar-group">
      <!-- 新建工作簿 -->
      <button class="tb-btn" title="新建工作簿" @click="workbookStore.newWorkbook()">
        <span>➕ 新建</span>
      </button>
      <!-- 后端保存/打开（需登录） -->
      <div class="open-wrap">
        <button
          class="tb-btn"
          :disabled="!authed"
          :title="authed ? '打开云端工作簿' : '请先登录'"
          @click="toggleOpenPanel"
        >
          <span>📂 打开</span>
        </button>
        <!-- 打开面板：工作簿列表 -->
        <div v-if="openPanelVisible" class="open-panel">
          <div v-if="listError" class="open-panel-error">{{ listError }}</div>
          <div v-else-if="workbookList.length === 0" class="open-panel-empty">
            暂无已保存的工作簿
          </div>
          <div
            v-for="wb in workbookList"
            v-else
            :key="wb.id"
            class="open-item"
          >
            <span class="open-item-main" @click="handleOpen(wb.id)">
              <span class="open-item-name">{{ wb.name }}</span>
              <span class="open-item-time">{{ wb.updated_at }}</span>
            </span>
            <span class="open-item-actions">
              <button class="open-item-btn" title="重命名" @click.stop="handleRename(wb)">✏️</button>
              <button class="open-item-btn open-item-btn--danger" title="删除" @click.stop="handleDelete(wb)">🗑️</button>
            </span>
          </div>
        </div>
      </div>
      <button
        class="tb-btn"
        :disabled="saveState === 'saving' || !authed"
        :title="authed ? '保存到云端 Ctrl+S' : '请先登录'"
        @click="handleSave"
      >
        <span>{{ saveState === 'saving' ? '⏳ 保存中' : '💾 保存' }}</span>
      </button>
      <!-- 保存状态提示 -->
      <span
        v-if="!authed"
        class="save-status"
      >未登录，仅本地编辑</span>
      <span
        v-else
        class="save-status"
        :class="{
          'save-status--ok': saveState === 'saved',
          'save-status--error': saveState === 'error',
        }"
      >
        {{ saveState === 'saved' ? '已保存' : saveState === 'error' ? saveError : saveState === 'saving' ? '保存中…' : '' }}
      </span>
    </div>
    <div class="toolbar-group">
      <button class="tb-btn" @click="handleImportClick">
        <span>📥 导入</span>
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".xlsx,.csv"
        style="display:none"
        @change="handleFileChange"
      />
      <button class="tb-btn" @click="handleExportXlsx" title="导出 Excel (.xlsx)">
        <span>📤 XLSX</span>
      </button>
      <button class="tb-btn" @click="handleExportCsv" title="导出 CSV (.csv)">
        <span>📄 CSV</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 8px;
  background: var(--grid-bg);
  border-bottom: 1px solid var(--grid-cell-border);
  gap: 4px;
}

.toolbar-group {
  display: flex;
  gap: 2px;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--grid-cell-border);
  margin: 0 6px;
}

.tb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
}

.tb-btn:hover {
  background: var(--grid-row-hover-bg);
  border-color: var(--grid-cell-border);
}

.tb-btn:active {
  background: var(--grid-selection-bg);
}

.tb-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ---- 打开面板 ---- */
.open-wrap {
  position: relative;
  display: inline-flex;
}

.open-panel {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  width: 260px;
  max-height: 300px;
  overflow-y: auto;
  margin-top: 4px;
  background: var(--grid-bg);
  border: 1px solid var(--grid-cell-border);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

.open-panel-empty,
.open-panel-error {
  padding: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.open-panel-error {
  color: #d03050;
}

.open-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border-bottom: 1px solid var(--grid-cell-border);
}

.open-item:last-child {
  border-bottom: none;
}

.open-item:hover {
  background: var(--grid-row-hover-bg);
}

.open-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.open-item-name {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.open-item-time {
  color: var(--text-disabled);
  font-size: 11px;
  flex-shrink: 0;
}

/* 操作按钮：默认透明，hover 显示 */
.open-item-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  flex-shrink: 0;
}

.open-item:hover .open-item-actions {
  opacity: 1;
}

.open-item-btn {
  border: none;
  background: none;
  font-size: 13px;
  padding: 2px 4px;
  border-radius: 2px;
  cursor: pointer;
}

.open-item-btn:hover {
  background: var(--grid-selection-bg);
}

.open-item-btn--danger:hover {
  background: #fde8e8;
}

/* ---- 保存状态提示 ---- */
.save-status {
  font-size: 12px;
  color: var(--text-secondary);
  margin-left: 4px;
  white-space: nowrap;
}

.save-status--ok {
  color: var(--color-primary);
}

.save-status--error {
  color: #d03050;
}
</style>
