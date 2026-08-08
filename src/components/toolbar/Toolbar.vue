<script setup lang="ts">
import { ref } from 'vue'
import { useWorkbookStore } from '@/stores/workbookStore'
import { exportXlsx, exportCsv } from '@/services/exportService'
import { importXlsx, importCsv } from '@/services/importService'

const workbookStore = useWorkbookStore()
const fileInput = ref<HTMLInputElement | null>(null)

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
</style>
