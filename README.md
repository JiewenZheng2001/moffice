# MOffice · 在线表格编辑器

> 基于 **Vue 3 + TypeScript + Pinia** 的类 Excel 在线表格编辑器。公式引擎、虚拟滚动、命令模式撤销/重做、依赖图循环检测等核心技术难点**全部手写实现**，不引入任何第三方表格库。

![Vue 3](https://img.shields.io/badge/Vue-3.5-42b883) ![TypeScript](https://img.shields.io/badge/TypeScript-6-strict-blue) ![Pinia](https://img.shields.io/badge/Pinia-4-yellow) ![Tests](https://img.shields.io/badge/tests-270%20passed-green) ![Coverage](https://img.shields.io/badge/branch%20coverage-96.9%25-brightgreen)

---

## ✨ 功能特性

| 模块 | 说明 |
|------|------|
| 📝 **单元格编辑** | 双击 / F2 编辑，Enter / Tab 确认跳格，Esc 取消，公式栏同步 |
| 🧮 **公式引擎** | 手写 Lexer → Parser → Evaluator，支持 `SUM` `AVERAGE` `COUNT` `COUNTA` `MAX` `MIN` `IF` `CONCATENATE`、范围引用、`$A$1` 绝对引用、7 级运算符优先级（含右结合幂运算） |
| 🔗 **依赖图** | 手写 DAG 双向索引，DFS 三色标记检测循环引用（`#CIRCULAR!`），变更 BFS 传播重算；多 Sheet 按 ID 隔离 |
| ↩️ **撤销/重做** | 命令模式双栈（50 步），`CompoundCommand` 原子批量，剪切+粘贴单命令撤销，撤销后恢复虚线框与剪贴板 |
| ✂️ **剪贴板** | Excel 风格复制/剪切虚线框，TSV 格式与 Excel / Google Sheets 互通，剪切粘贴一次性语义 |
| 📊 **单元格格式化** | 字体/字号/粗体/斜体/下划线（Ctrl+B/I/U）、文字与背景色、四边边框、水平对齐、数字格式（千分位/小数/百分比/货币） |
| 📑 **多 Sheet** | 标签页切换/新建，XLSX 多 sheet 全量导入导出 |
| ⚡ **虚拟滚动** | 手写 `useVirtualScroll`，仅渲染可视区 + 缓冲区，10 万行只维护约 50 个 DOM 节点 |
| 🧵 **Web Workers** | 公式求值移至 Worker 线程，`postMessage` 通信，不阻塞 UI |
| 📁 **导入导出** | XLSX（exceljs）/ CSV（papaparse）双向，UTF-8 BOM 兼容 Excel |

## 🏗️ 架构

```
components/   Vue 组件层（Grid / Toolbar / FormulaBar / SheetTabs ...）
composables/  响应式逻辑（useVirtualScroll / useKeyboard）
stores/       Pinia 状态层（workbookStore / uiStore / formulaStore）
services/     服务层（commandService / clipboardManager / 导入导出）
engine/       公式引擎（纯函数，零依赖）：Lexer → Parser → Evaluator + DependencyGraph
model/        数据模型（纯 TS，零依赖）：Cell / Sheet / Workbook / Command
```

**核心设计原则**：

- `model/` 与 `engine/` **零框架依赖**，纯函数可脱离 Vue 独立运行与单元测试
- 严格单向数据流：组件事件 → Store Action → **Command（命令模式）** → 数据变更 → 响应式渲染
- 所有数据变更必须经 `commandService.execute()`，这是撤销/重做与剪贴板状态一致性的基础

## 🚀 快速开始

```bash
pnpm install        # 安装依赖
pnpm dev            # 开发服务器 → http://localhost:5173
pnpm test           # 运行全部测试（270 个）
pnpm test:coverage  # 覆盖率报告
pnpm build          # 生产构建
pnpm typecheck      # 类型检查
```

## ⌨️ 快捷键

| 快捷键 | 功能 | 快捷键 | 功能 |
|--------|------|--------|------|
| Ctrl+Z | 撤销 | Ctrl+Y / Ctrl+Shift+Z | 重做 |
| Ctrl+C | 复制 | Ctrl+X | 剪切 |
| Ctrl+V | 粘贴 | Ctrl+B / I / U | 粗体 / 斜体 / 下划线 |
| 方向键 | 移动选区 | Shift+方向键 | 扩展选区 |
| Tab / Enter | 右移 / 下移 | F2 | 编辑当前格 |
| Esc | 取消编辑 / 退出虚线框 | Delete | 清空单元格 |
| Ctrl+Shift+= | 插入行 | Ctrl+- | 删除行 |

## 🧪 测试

**270 个测试用例全部通过**（Vitest）：

| 模块 | 数量 | 说明 |
|------|------|------|
| 公式引擎 | 115 | Lexer / Parser / Evaluator / Dependency，**分支覆盖 96.9%，函数覆盖 100%** |
| 命令模式 | 46 | 全部命令 execute / undo + 双栈管理 |
| Stores | 53 | 公式传播、撤销重算、多 Sheet 依赖隔离、选区模型 |
| 剪贴板 | 20 | ClipboardManager 状态机 + TSV 工具 |
| 组件 | 26 | 网格渲染、格式工具栏、Sheet 标签 |
| 集成 | 10 | 真实 keydown 事件驱动：复制→粘贴→撤销→重做全链路 |

测试驱动发现并修复了 6 个真实 bug（绝对引用丢失、循环引用检测被忽略、粘贴误退复制模式等）。

## 📁 项目结构

```
src/
├── engine/        # 公式引擎（tokenize → parse → evaluate + 依赖图）
├── model/         # 数据模型 + 命令定义（零依赖）
├── stores/        # Pinia Stores
├── services/      # 命令调度 / 剪贴板状态机 / 导入导出
├── composables/   # 虚拟滚动 / 键盘导航
├── components/    # UI 组件
└── workers/       # 公式求值 Worker
```

## 📄 License

MIT
