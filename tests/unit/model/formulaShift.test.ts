import { describe, it, expect } from 'vitest'
import { shiftFormulaRefs, shiftCellRef } from '@/model/formulaShift'

describe('formulaShift 相对引用偏移', () => {
  describe('shiftCellRef 单引用', () => {
    it('相对引用偏移', () => {
      expect(shiftCellRef('A1', 1, 0)).toBe('A2') // 下移一行
      expect(shiftCellRef('A1', 0, 1)).toBe('B1') // 右移一列
      expect(shiftCellRef('B2', 1, 1)).toBe('C3')
    })

    it('绝对引用不偏移', () => {
      expect(shiftCellRef('$A$1', 5, 5)).toBe('$A$1')
    })

    it('混合引用只偏移非 $ 部分', () => {
      expect(shiftCellRef('$A1', 1, 2)).toBe('$A2') // 列锁定，行偏移
      expect(shiftCellRef('A$1', 2, 1)).toBe('B$1') // 行锁定，列偏移
    })

    it('多字母列偏移', () => {
      expect(shiftCellRef('Z1', 0, 1)).toBe('AA1')
      expect(shiftCellRef('AA1', 0, 1)).toBe('AB1')
    })

    it('越界返回原引用（不产生非法引用）', () => {
      expect(shiftCellRef('A1', 0, -1)).toBe('A1')
      expect(shiftCellRef('A1', -1, 0)).toBe('A1')
    })
  })

  describe('shiftFormulaRefs 公式整体偏移', () => {
    it('简单公式', () => {
      expect(shiftFormulaRefs('=A1+B1', 1, 0)).toBe('=A2+B2')
    })

    it('右移一列', () => {
      expect(shiftFormulaRefs('=A1+B1', 0, 1)).toBe('=B1+C1')
    })

    it('范围引用起止都偏移', () => {
      expect(shiftFormulaRefs('=SUM(A1:B2)', 1, 1)).toBe('=SUM(B2:C3)')
    })

    it('绝对引用保持', () => {
      expect(shiftFormulaRefs('=$A$1+A1', 1, 0)).toBe('=$A$1+A2')
    })

    it('混合引用', () => {
      expect(shiftFormulaRefs('=$A1+A$1', 1, 1)).toBe('=$A2+B$1')
    })

    it('函数名不偏移', () => {
      expect(shiftFormulaRefs('=SUM(A1)+MAX(B2)', 1, 0)).toBe('=SUM(A2)+MAX(B3)')
    })

    it('字符串字面量中的文本不偏移', () => {
      expect(shiftFormulaRefs('="A1"+A1', 1, 0)).toBe('="A1"+A2')
    })

    it('跨 sheet 引用偏移', () => {
      expect(shiftFormulaRefs('=Sheet2!A1*2', 1, 0)).toBe('=Sheet2!A2*2')
    })

    it('无偏移时原样返回', () => {
      expect(shiftFormulaRefs('=A1+B1', 0, 0)).toBe('=A1+B1')
    })

    it('单元格引用作函数参数', () => {
      expect(shiftFormulaRefs('=IF(A1>0, A1, B1)', 1, 1)).toBe('=IF(B2>0, B2, C2)')
    })
  })
})
