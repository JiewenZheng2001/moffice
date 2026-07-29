import type { Sheet } from '@/model/types'
import type { FormulaErrorType } from '@/engine'

/**
 * 异步公式服务 —— 使用 Web Worker 在后台计算公式
 * 失败时返回错误标记，调用方自行决定是否回退同步计算
 */
class AsyncFormulaService {
  private worker: Worker | null = null
  private pending = new Map<number, {
    resolve: (v: WorkerResult) => void
    reject: (err: Error) => void
  }>()
  private nextId = 1
  private ready = false

  init(): void {
    if (this.worker) return
    try {
      this.worker = new Worker(
        new URL('@/workers/formula.worker.ts', import.meta.url),
        { type: 'module' },
      )
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleMessage(e.data)
      this.worker.onerror = () => { this.ready = false }
      this.ready = true
    } catch {
      this.ready = false
    }
  }

  get isReady(): boolean { return this.ready && !!this.worker }

  computeAsync(formula: string, sheet: Sheet): Promise<WorkerResult> {
    if (!this.worker || !this.ready) {
      return Promise.resolve({ value: '#ERROR!', deps: [], error: 'Worker not ready' })
    }

    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })

      const cells: Record<string, number | string | null> = {}
      for (const [ref, cell] of sheet.cells) {
        if (cell.error) cells[ref] = null
        else if (typeof cell.computedValue === 'number' || typeof cell.computedValue === 'string')
          cells[ref] = cell.computedValue
        else cells[ref] = null
      }

      this.worker!.postMessage({ id, formula, cells })

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          resolve({ value: '#ERROR!', deps: [], error: 'timeout' })
        }
      }, 5000)
    })
  }

  destroy(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = false
    for (const [, e] of this.pending) e.reject(new Error('destroyed'))
    this.pending.clear()
  }

  private handleMessage(data: WorkerResponse): void {
    const e = this.pending.get(data.id)
    if (!e) return
    this.pending.delete(data.id)
    e.resolve({ value: data.value as WorkerResult['value'], deps: data.deps, error: data.error })
  }
}

interface WorkerResponse { id: number; value: unknown; deps: string[]; error?: string }

export interface WorkerResult {
  value: number | string | boolean | FormulaErrorType
  deps: string[]
  error?: string
}

export const asyncFormulaService = new AsyncFormulaService()
