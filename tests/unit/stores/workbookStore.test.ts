import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkbookStore } from '@/stores/workbookStore'
import { useFormulaStore } from '@/stores/formulaStore'
import { useUiStore } from '@/stores/uiStore'
import { commandService } from '@/services/commandService'
import { clipboardManager } from '@/services/clipboardManager'
import { CutPasteCommand } from '@/model/command'
import { createCell } from '@/model/cell'

// jsdom 无 clipboard，mock 掉
beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(''),
    },
    configurable: true,
  })
})

function freshStore() {
  setActivePinia(createPinia())
  commandService.clear()
  return useWorkbookStore()
}

/** 读取单元格 rawValue */
function raw(store: ReturnType<typeof useWorkbookStore>, ref: string): unknown {
  return store.activeSheet?.cells.get(ref)?.rawValue ?? null
}

describe('workbookStore 工作簿 id 持久化与自动恢复', () => {
  it('初始 id 写入 localStorage，多次实例化 id 稳定（刷新不换表）', () => {
    localStorage.clear()
    const store1 = freshStore()
    const id = store1.workbook.id
    expect(localStorage.getItem('moffice_workbook_id')).toBe(id)

    // 模拟刷新：新 pinia 实例（同 localStorage）
    const store2 = freshStore()
    expect(store2.workbook.id).toBe(id)
  })

  it('replaceWorkbook 持久化新 id 并抑制自动保存', () => {
    localStorage.clear()
    const store = freshStore()
    const loaded = {
      id: 'wb-loaded-1',
      name: '加载的表',
      sheets: store.workbook.sheets,
      activeSheetId: store.workbook.activeSheetId,
    }
    store.replaceWorkbook(loaded)
    expect(store.workbook.id).toBe('wb-loaded-1')
    expect(localStorage.getItem('moffice_workbook_id')).toBe('wb-loaded-1')
    expect(store.autoSaveSuppressed).toBe(true)
  })

  it('newWorkbook 创建空白表 + 新 id 持久化 + 抑制自动保存', () => {
    localStorage.clear()
    const store = freshStore()
    const oldId = store.workbook.id
    store.setCellValue('A1', 'x') // 有数据
    store.newWorkbook()

    expect(store.workbook.id).not.toBe(oldId)
    expect(store.workbook.sheets).toHaveLength(1)
    expect(store.workbook.sheets[0].cells.size).toBe(0) // 空白
    expect(localStorage.getItem('moffice_workbook_id')).toBe(store.workbook.id)
    expect(store.autoSaveSuppressed).toBe(true)
    expect(commandService.canUndo).toBe(false) // 命令栈清空
  })

  it('resetForLogout：登出重置为空白工作簿（数据隔离）', () => {
    localStorage.clear()
    const store = freshStore()
    const oldId = store.workbook.id
    store.setCellValue('A1', '机密数据')
    store.setCellValue('B2', 42)
    store.undo() // 让命令栈里有记录
    store.redo()

    store.resetForLogout()

    // 换新 id 且持久化（后续编辑写入新记录，不覆盖旧用户云端数据）
    expect(store.workbook.id).not.toBe(oldId)
    expect(localStorage.getItem('moffice_workbook_id')).toBe(store.workbook.id)
    // 空白单表
    expect(store.workbook.sheets).toHaveLength(1)
    expect(store.workbook.sheets[0].cells.size).toBe(0)
    // 命令栈已清空：撤销/重做都不能恢复旧数据
    store.undo()
    expect(store.workbook.sheets[0].cells.size).toBe(0)
    store.redo()
    expect(store.workbook.sheets[0].cells.size).toBe(0)
  })

  it('restoreLastWorkbook 成功时替换当前工作簿', async () => {
    localStorage.clear()
    const store = freshStore()
    // mock loadWorkbook 返回数据
    vi.doMock('@/services/workbookService', () => ({
      loadWorkbook: vi.fn().mockResolvedValue({
        id: 'wb-restored',
        name: '恢复的表',
        sheets: [],
        activeSheetId: '',
      }),
    }))
    const ok = await store.restoreLastWorkbook()
    expect(ok).toBe(true)
    expect(store.workbook.id).toBe('wb-restored')
  })
})

describe('workbookStore', () => {
  describe('基础操作', () => {
    it('初始有一个默认 Sheet', () => {
      const store = freshStore()
      expect(store.workbook.sheets).toHaveLength(1)
      expect(store.activeSheet?.name).toBe('Sheet1')
    })

    it('addSheet 添加新 Sheet 并自动激活（Excel 行为）', () => {
      const store = freshStore()
      store.addSheet('Sheet2')
      expect(store.workbook.sheets).toHaveLength(2)
      // 新建即激活（对标 Excel）
      expect(store.activeSheet?.name).toBe('Sheet2')
    })

    it('addSheet 缺省名自动去重（Sheet1/2/3...）', () => {
      const store = freshStore()
      store.addSheet('自定义')
      store.addSheet()
      store.addSheet()
      expect(store.workbook.sheets.map((s) => s.name)).toEqual(['Sheet1', '自定义', 'Sheet2', 'Sheet3'])
    })

    it('setActiveSheet 切换激活 sheet', () => {
      const store = freshStore()
      store.addSheet('Sheet2')
      const s2 = store.workbook.sheets[1]
      store.setActiveSheet(s2.id)
      expect(store.activeSheet?.id).toBe(s2.id)
    })

    it('addRows 增加行数（不进命令栈）', () => {
      const store = freshStore()
      const before = store.activeSheet!.rowCount
      store.addRows(50)
      expect(store.activeSheet!.rowCount).toBe(before + 50)
    })

    it('pasteCells 批量写入', () => {
      const store = freshStore()
      store.pasteCells(new Map([
        ['A1', 1],
        ['B2', 'x'],
      ]))
      expect(raw(store, 'A1')).toBe(1)
      expect(raw(store, 'B2')).toBe('x')
    })

    it('pasteCells 公式引用同批粘贴的单元格：先写值再求值（D1=C1 显示 5 而非 0）', () => {
      const store = freshStore()
      store.setCellValue('A1', 5)
      store.setCellValue('B1', '=A1')

      // 模拟复制 A1:B1 → 粘贴 C1:D1（B1 公式 =A1 偏移为 =C1，引用同批粘贴的 C1）
      store.pasteCells(new Map([
        ['C1', 5],
        ['D1', '=C1'],
      ]))

      expect(raw(store, 'C1')).toBe(5)
      expect(store.activeSheet!.cells.get('C1')!.computedValue).toBe(5)
      expect(store.activeSheet!.cells.get('D1')!.formula).toBe('=C1')
      // 关键断言：D1 引用同批粘贴的 C1，值必须是 5（旧 bug 是 0）
      expect(store.activeSheet!.cells.get('D1')!.computedValue).toBe(5)
    })

    it('pasteCells 撤销：写值 + 求值一次撤销全部恢复', () => {
      const store = freshStore()
      store.setCellValue('A1', 5)
      store.pasteCells(new Map([
        ['C1', 5],
        ['D1', '=C1'],
      ]))
      expect(store.activeSheet!.cells.get('D1')!.computedValue).toBe(5)

      // 第一次撤销：公式求值（D1 回到纯文本 "=C1"）
      store.undo()
      // 第二次撤销：PasteCommand（C1/D1 都清除）
      store.undo()
      expect(store.activeSheet!.cells.has('C1')).toBe(false)
      expect(store.activeSheet!.cells.has('D1')).toBe(false)
    })

    it('insertRow / deleteRow / insertColumn / deleteColumn 走命令栈', () => {
      const store = freshStore()
      store.insertRow(0)
      expect(store.activeSheet!.rowCount).toBe(201)
      expect(commandService.canUndo).toBe(true)
      store.undo()
      expect(store.activeSheet!.rowCount).toBe(200)
    })
  })

  describe('setCellValue', () => {
    it('写入普通值', () => {
      const store = freshStore()
      store.setCellValue('A1', 'hello')
      expect(raw(store, 'A1')).toBe('hello')
    })

    it('数值字符串自动转 number（"3" → 3）', () => {
      const store = freshStore()
      store.setCellValue('A1', '3')
      expect(raw(store, 'A1')).toBe(3)
    })

    it('带空格的数值字符串也转换', () => {
      const store = freshStore()
      store.setCellValue('A1', ' 3.14 ')
      expect(raw(store, 'A1')).toBe(3.14)
    })

    it('负数转换', () => {
      const store = freshStore()
      store.setCellValue('A1', '-5')
      expect(raw(store, 'A1')).toBe(-5)
    })

    it('非数值字符串保留原样', () => {
      const store = freshStore()
      store.setCellValue('A1', 'abc123')
      expect(raw(store, 'A1')).toBe('abc123')
    })

    it('null 清空单元格', () => {
      const store = freshStore()
      store.setCellValue('A1', 'x')
      store.setCellValue('A1', null)
      expect(store.activeSheet!.cells.has('A1')).toBe(false)
    })

    it('支持撤销', () => {
      const store = freshStore()
      store.setCellValue('A1', 'new')
      store.undo()
      expect(store.activeSheet!.cells.has('A1')).toBe(false)
      store.redo()
      expect(raw(store, 'A1')).toBe('new')
    })
  })

  describe('公式', () => {
    it('公式求值：computedValue 是结果，formula 是原文', () => {
      const store = freshStore()
      store.setCellValue('A1', 10)
      store.setCellValue('A2', 20)
      store.setCellValue('A3', '=SUM(A1:A2)')
      expect(raw(store, 'A3')).toBe('=SUM(A1:A2)')
      expect(store.activeSheet!.cells.get('A3')!.computedValue).toBe(30)
    })

    it('依赖传播：修改被引用单元格 → 公式自动重算', () => {
      const store = freshStore()
      store.setCellValue('A1', 1)
      store.setCellValue('B1', '=A1*2')
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe(2)

      store.setCellValue('A1', 100)
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe(200)
    })

    it('多级依赖传播：C1 = B1*2, B1 = A1+1', () => {
      const store = freshStore()
      store.setCellValue('A1', 1)
      store.setCellValue('B1', '=A1+1')
      store.setCellValue('C1', '=B1*2')
      expect(store.activeSheet!.cells.get('C1')!.computedValue).toBe(4)

      store.setCellValue('A1', 10)
      expect(store.activeSheet!.cells.get('C1')!.computedValue).toBe(22)
    })

    it('循环引用显示 #CIRCULAR!', () => {
      const store = freshStore()
      store.setCellValue('A1', '=B1')
      store.setCellValue('B1', '=A1')
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe('#CIRCULAR!')
    })

    it('公式错误 #DIV/0! 显示并传播', () => {
      const store = freshStore()
      store.setCellValue('A1', '=1/0')
      expect(store.activeSheet!.cells.get('A1')!.computedValue).toBe('#DIV/0!')
      expect(store.activeSheet!.cells.get('A1')!.error).toBe('#DIV/0!')
    })

    it('覆盖公式格为普通值 → 清除依赖，下游重算', () => {
      const store = freshStore()
      store.setCellValue('A1', 5)
      store.setCellValue('B1', '=A1*2')
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe(10)

      store.setCellValue('B1', 'text')
      expect(store.activeSheet!.cells.get('B1')!.formula).toBeNull()
      expect(raw(store, 'B1')).toBe('text')
    })

    it('撤销公式设置后依赖关系恢复', () => {
      const store = freshStore()
      store.setCellValue('A1', 1)
      store.setCellValue('B1', '=A1*2')
      store.undo() // 撤销 B1 公式
      expect(store.activeSheet!.cells.has('B1')).toBe(false)

      // 重新设置公式后重做
      store.redo()
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe(2)
    })

    it('撤销公式后传播重算恢复旧值', () => {
      const store = freshStore()
      store.setCellValue('A1', 5)
      store.setCellValue('B1', '=A1*2')
      // 改 A1 触发传播
      store.setCellValue('A1', 7)
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe(14)
      // 撤销 A1 的修改 → B1 应重算回 10
      store.undo()
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe(10)
    })
  })

  describe('clearCells', () => {
    it('批量清空并支持撤销', () => {
      const store = freshStore()
      store.setCellValue('A1', 1)
      store.setCellValue('B2', 'x')
      expect(store.clearCells(['A1', 'B2', 'C9'])).toBe(true)
      expect(store.activeSheet!.cells.has('A1')).toBe(false)
      expect(store.activeSheet!.cells.has('B2')).toBe(false)

      store.undo()
      expect(raw(store, 'A1')).toBe(1)
      expect(raw(store, 'B2')).toBe('x')
    })

    it('无内容时返回 false 不入栈', () => {
      const store = freshStore()
      expect(store.clearCells(['A1', 'A2'])).toBe(false)
      expect(commandService.canUndo).toBe(false)
    })
  })

  describe('applyFormat', () => {
    it('批量应用格式并支持撤销', () => {
      const store = freshStore()
      store.setCellValue('A1', 1)
      store.applyFormat(['A1', 'B1'], { bold: true })
      expect(store.activeSheet!.cells.get('A1')!.format.bold).toBe(true)
      expect(store.activeSheet!.cells.get('B1')!.format.bold).toBe(true)
      expect(store.activeSheet!.cells.get('B1')!.rawValue).toBeNull() // 惰性创建

      store.undo()
      expect(store.activeSheet!.cells.get('A1')!.format.bold).toBeUndefined()
      // B1 仅因格式存在 → 撤销后删除
      expect(store.activeSheet!.cells.has('B1')).toBe(false)
    })

    it('格式操作不触发公式重算（needsRecalc=false）', () => {
      const store = freshStore()
      store.setCellValue('A1', 1)
      store.setCellValue('B1', '=A1*2')
      const spy = vi.spyOn(useFormulaStore(), 'getAffectedCells')
      store.applyFormat(['A1'], { bold: true })
      store.undo()
      // 格式命令跳过重算 → getAffectedCells 不应被调用
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe('多 Sheet 与命令栈隔离', () => {
    it('切换 Sheet 清空命令栈', () => {
      const store = freshStore()
      store.setCellValue('A1', 1)
      expect(commandService.canUndo).toBe(true)
      store.addSheet('Sheet2')
      store.setActiveSheet(store.workbook.sheets[1].id)
      expect(commandService.canUndo).toBe(false)
    })

    it('切换 Sheet 退出剪贴板模式', () => {
      const store = freshStore()
      clipboardManager.startCut({ startRef: 'A1', endRef: 'A1' }, 'x')
      expect(clipboardManager.isCutMode).toBe(true)
      store.addSheet('Sheet2')
      store.setActiveSheet(store.workbook.sheets[1].id)
      expect(clipboardManager.isCutMode).toBe(false)
    })

    it('importSheets 替换整个工作簿并激活第一个', () => {
      const store = freshStore()
      store.setCellValue('A1', 'old')
      store.importSheets([
        { name: '导入1', cells: new Map([['A1', 'v1']]), columnWidths: new Map() },
        { name: '导入2', cells: new Map([['B1', 'v2']]), columnWidths: new Map() },
      ])
      expect(store.workbook.sheets).toHaveLength(2)
      expect(store.activeSheet?.name).toBe('导入1')
      expect(raw(store, 'A1')).toBe('v1')
      expect(commandService.canUndo).toBe(false) // 导入清空历史
    })

    it('importSheets 空数组不生效', () => {
      const store = freshStore()
      store.importSheets([])
      expect(store.workbook.sheets).toHaveLength(1)
    })

    it('undo 恢复剪切命令的虚线框状态', () => {
      const store = freshStore()
      store.setCellValue('A1', 'x')
      // 模拟剪切粘贴：CutPasteCommand 通过 commandService 执行
      commandService.execute(
        new CutPasteCommand(store.activeSheet!, ['A1'], new Map([['C1', 'x']]), 'x'),
      )
      // 执行后退出剪切模式
      expect(clipboardManager.isCutMode).toBe(false)
      store.undo()
      // undo 后恢复剪切模式（虚线框）
      expect(clipboardManager.isCutMode).toBe(true)
      expect(clipboardManager.sourceRange).toEqual({ startRef: 'A1', endRef: 'A1' })
    })
  })

  describe('getSelectionRange 相关（uiStore 协作）', () => {
    it('uiStore 选区变化影响公式栏（集成）', () => {
      const store = freshStore()
      const uiStore = useUiStore()
      store.setCellValue('A1', 'data')
      uiStore.selectCell('A1')
      expect(uiStore.activeRef).toBe('A1')
      expect(raw(store, 'A1')).toBe('data')
    })

    it('startEdit 退出所有剪贴板模式', () => {
      const store = freshStore()
      const uiStore = useUiStore()
      clipboardManager.startCopy({ startRef: 'A1', endRef: 'A1' }, 'x')
      uiStore.startEdit()
      expect(clipboardManager.isActive).toBe(false)
      expect(uiStore.isEditing).toBe(true)
    })
  })

  describe('跨 Sheet 公式引用', () => {
    it('Sheet2!A1 引用求值', () => {
      const store = freshStore()
      store.addSheet('Sheet2')
      const s2 = store.workbook.sheets[1]
      // 在 Sheet2 写入数据
      const s2Cell = createCell('A1')
      s2Cell.rawValue = 5
      s2Cell.computedValue = 5
      s2.cells.set('A1', s2Cell)

      // 切回 Sheet1：公式引用 Sheet2!A1
      store.setActiveSheet(store.workbook.sheets[0].id)
      store.setCellValue('B1', '=Sheet2!A1*2')
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe(10)
    })

    it('跨 sheet 联动：改 Sheet2 的 A1 → Sheet1 公式重算', () => {
      const store = freshStore()
      store.addSheet('Sheet2')
      // 切回 Sheet1：公式引用 Sheet2!A1
      store.setActiveSheet(store.workbook.sheets[0].id)
      store.setCellValue('B1', '=Sheet2!A1*2')
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe(0) // Sheet2!A1 空 = 0

      // 切到 Sheet2 改 A1
      const s2 = store.workbook.sheets[1]
      store.setActiveSheet(s2.id)
      store.setCellValue('A1', 10)

      // 切回 Sheet1 验证联动
      const s1 = store.workbook.sheets[0]
      store.setActiveSheet(s1.id)
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe(20)
    })

    it('跨 sheet 范围求和：=SUM(Sheet2!A1:A2)', () => {
      const store = freshStore()
      store.addSheet('Sheet2')
      const s2 = store.workbook.sheets[1]
      store.setActiveSheet(s2.id)
      store.setCellValue('A1', 1)
      store.setCellValue('A2', 2)

      const s1 = store.workbook.sheets[0]
      store.setActiveSheet(s1.id)
      store.setCellValue('C1', '=SUM(Sheet2!A1:A2)')
      expect(store.activeSheet!.cells.get('C1')!.computedValue).toBe(3)
    })

    it('跨 sheet 公式支持撤销重做', () => {
      const store = freshStore()
      store.addSheet('Sheet2')
      const s2 = store.workbook.sheets[1]
      store.setActiveSheet(s2.id)
      store.setCellValue('A1', 7)
      const s1 = store.workbook.sheets[0]
      store.setActiveSheet(s1.id)

      store.setCellValue('B1', '=Sheet2!A1+1')
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe(8)

      store.undo()
      expect(store.activeSheet!.cells.has('B1')).toBe(false)
      store.redo()
      expect(store.activeSheet!.cells.get('B1')!.computedValue).toBe(8)
    })
  })
})
