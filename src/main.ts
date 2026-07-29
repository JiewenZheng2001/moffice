import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
import { asyncFormulaService } from './services/asyncFormulaService'

// 启动时初始化公式计算 Worker（后台线程，不阻塞 UI）
asyncFormulaService.init()

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
