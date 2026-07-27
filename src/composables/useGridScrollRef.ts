import { ref } from 'vue'

/**
 * 共享的滚动容器 DOM 引用
 * SpreadsheetGrid 绑定 DOM，useKeyboard 读取它来做预滚动
 */
export const gridScrollRef = ref<HTMLElement | null>(null)
