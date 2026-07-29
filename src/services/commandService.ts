import type { ICommand } from '@/model/command'
import { CompoundCommand } from '@/model/command'

/**
 * CommandService —— 命令模式调度中心
 * 管理 undo/redo 双栈，所有修改数据操作必须通过它执行
 *
 * 使用方式：
 *   import { commandService } from '@/services/commandService'
 *   const cmd = new SetCellCommand(sheet, 'A1', 'hello')
 *   commandService.execute(cmd)
 *   commandService.undo()        // Ctrl+Z
 *   commandService.redo()        // Ctrl+Y
 */
class CommandService {
  /** 最大栈深度，防止内存无限增长 */
  private static readonly MAX_STACK = 50

  private undoStack: ICommand[] = []
  private redoStack: ICommand[] = []

  /** 是否有可撤销的操作 */
  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  /** 是否有可重做的操作 */
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** 获取当前撤销栈长度（调试用） */
  get undoCount(): number {
    return this.undoStack.length
  }

  /** 获取当前重做栈长度（调试用） */
  get redoCount(): number {
    return this.redoStack.length
  }

  /**
   * 执行一组命令，打包为一个原子操作（撤销/重做时整体处理）
   */
  executeBatch(commands: ICommand[], description?: string): void {
    if (commands.length === 0) return
    const compound = new CompoundCommand(commands, description)
    this.execute(compound)
  }

  /**
   * 执行一个命令
   * - 新命令入 undo 栈时清空 redo 栈（防止分支历史）
   * - 超出 MAX_STACK 时移除最旧的命令
   */
  execute(command: ICommand): void {
    command.execute()
    this.undoStack.push(command)
    this.redoStack = [] // 新操作使重做历史失效

    // 限制栈深
    while (this.undoStack.length > CommandService.MAX_STACK) {
      this.undoStack.shift()
    }
  }

  /** 撤销最近一次操作，返回被撤销的命令（供外部做依赖重算） */
  undo(): ICommand | null {
    const command = this.undoStack.pop()
    if (!command) return null
    command.undo()
    this.redoStack.push(command)
    return command
  }

  /** 重做最近一次撤销，返回被重做的命令 */
  redo(): ICommand | null {
    const command = this.redoStack.pop()
    if (!command) return null
    command.execute()
    this.undoStack.push(command)
    return command
  }

  /** 清空所有历史（切换 Sheet 等场景） */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}

/** 全局单例 */
export const commandService = new CommandService()
