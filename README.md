# MOffice · 在线表格编辑器

> 基于 **Vue 3 + TypeScript + Pinia** 的类 Excel 在线表格编辑器。公式引擎、虚拟滚动、命令模式撤销/重做、依赖图循环检测等核心技术难点**全部手写实现**，不引入任何第三方表格库；支持注册登录与云端工作簿存储。

![Vue 3](https://img.shields.io/badge/Vue-3.5-42b883) ![TypeScript](https://img.shields.io/badge/TypeScript-6_strict-blue) ![Pinia](https://img.shields.io/badge/Pinia-4-yellow) ![License](https://img.shields.io/badge/License-Apache_2.0-blue)

---

## 功能特性

| 模块 | 说明 |
|------|------|
| **单元格编辑** | 双击 / F2 编辑，Enter / Tab 确认跳格，Esc 取消，公式栏同步；选中状态直接输入字符即进入编辑并替换内容；Delete / Backspace 清空选区 |
| **公式引擎** | 手写 Lexer → Parser → Evaluator，支持 `SUM` `AVERAGE` `COUNT` `COUNTA` `MAX` `MIN` `IF` `CONCATENATE`、范围引用、`$A$1` 绝对引用、跨 Sheet 引用（`Sheet1!A1`）、7 级运算符优先级（含右结合幂运算）、`&` 字符串拼接 |
| **依赖图** | 手写 DAG 双向索引，DFS 三色标记检测循环引用（`#CIRCULAR!`），变更 BFS 传播重算；多 Sheet 按 ID 隔离 |
| **撤销/重做** | 命令模式双栈（50 步），`CompoundCommand` 原子批量，剪切+粘贴单命令撤销，撤销后恢复虚线框与剪贴板，连续格式操作自动合并 |
| **剪贴板** | Excel 风格复制/剪切虚线框，TSV 格式与 Excel / Google Sheets 互通，剪切粘贴一次性语义 |
| **单元格格式化** | 字体/字号/粗体/斜体/下划线（Ctrl+B/I/U）、文字与背景色、四边边框、水平对齐、数字格式（千分位/小数/百分比/货币）、格式刷（双击进入粘滞模式，Esc 退出） |
| **行列操作** | 拖拽调整行高/列宽；插入/删除行、列（右键菜单与快捷键），公式引用自动偏移 |
| **多 Sheet** | 标签页切换/新建，跨 Sheet 公式，XLSX 多 sheet 全量导入导出 |
| **虚拟滚动** | 手写 `useVirtualScroll`，仅渲染可视区 + 缓冲区，大数据量下保持少量 DOM 节点 |
| **Web Worker** | 公式求值移至 Worker 线程，`postMessage` 通信，5 秒超时兜底，不阻塞 UI |
| **导入导出** | XLSX（exceljs）/ CSV（papaparse）双向，导出保留公式与样式，UTF-8 BOM 兼容 Excel |
| **云端存储** | 注册/登录（JWT），云端工作簿列表/打开/重命名/删除，Ctrl+S 手动保存 + 2 秒 debounce 自动保存 |

## 架构

```
components/   Vue 组件层（Grid / Toolbar / FormulaBar / SheetTabs / ContextMenu / AuthBar）
composables/  响应式逻辑（useVirtualScroll / useKeyboard）
stores/       Pinia 状态层（workbookStore / uiStore / formulaStore）
services/     服务层（commandService / clipboardManager / 导入导出 / 云端 API / 异步公式）
engine/       公式引擎（纯函数，零依赖）：Lexer → Parser → Evaluator + DependencyGraph
model/        数据模型（纯 TS，零依赖）：Cell / Sheet / Workbook / Command
```

**核心设计原则**：

- `model/` 与 `engine/` **零框架依赖**，纯函数可脱离 Vue 独立运行与单元测试
- 严格单向数据流：组件事件 → Store Action → **Command（命令模式）** → 数据变更 → 响应式渲染
- 所有数据变更必须经 `commandService.execute()`，这是撤销/重做与剪贴板状态一致性的基础

## 快速开始

```bash
pnpm install        # 安装依赖（npm install 亦可）
pnpm dev            # 开发服务器 → http://localhost:5173
pnpm test           # 运行全部测试（353 个）
pnpm test:coverage  # 覆盖率报告（聚焦 src/engine）
pnpm build          # 生产构建
pnpm typecheck      # 类型检查

# 后端二选一，本地启动（保存/加载/登录需要）：
# 方案 A：Express（默认，Vite proxy 已指向 localhost:3000）
cd server && pnpm install && pnpm dev        # API → http://localhost:3000

# 方案 B：Cloudflare Workers（Hono + D1 数据库）
cd workers && pnpm install
npx wrangler d1 create moffice
npx wrangler d1 execute moffice --file=./schema.sql
npx wrangler dev                             # 默认 8787 端口，需将 VITE_API_BASE 指向 http://localhost:8787
```

开发模式下前端通过 Vite proxy 访问后端（`/api` → `localhost:3000`），无需额外配置。

## 云端 API

仓库内置两套后端实现，接口完全一致（前端零改动）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册（成功后自动登录） |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/workbooks` | 工作簿列表（元信息） |
| POST | `/api/workbooks` | 保存 / 覆盖 |
| GET | `/api/workbooks/:id` | 加载 |
| PATCH | `/api/workbooks/:id` | 重命名 |
| DELETE | `/api/workbooks/:id` | 删除 |

## 部署

纯静态前端 + 独立后端 API，代码已包含两套后端部署配置：

```
GitHub 仓库
  ├─ 前端 SPA      → Vercel（vercel.json 已配置 Vite + SPA 回退）
  ├─ 后端方案 A    → Render（server/render.yaml 蓝图：免费层 + SQLite 持久磁盘）
  └─ 后端方案 B    → Cloudflare Workers（workers/wrangler.toml + D1，免费 5GB）
```

**环境变量**（详见 `.env.example` 与 `workers/wrangler.toml`）：

| 位置 | 变量 | 说明 |
|------|------|------|
| 前端构建 | `VITE_API_BASE` | 后端地址，如 `https://moffice-api.onrender.com`；留空则走 Vite proxy（开发） |
| 后端（两方案通用） | `CORS_ORIGIN` | 允许的前端域名（逗号分隔多域名） |
| 后端（两方案通用） | `JWT_SECRET` | JWT 签名密钥，部署后必须设置（否则重启 token 失效） |
| Render 后端 | `PORT` | 端口（Render 自动注入） |

- 方案 A（Render）：使用 Node 内置 `node:sqlite`，数据落在 `/app/data/moffice.db`（1GB 持久磁盘，重启不丢数据）
- 方案 B（Workers）：D1 数据库由 `wrangler d1 create` + `schema.sql` 迁移创建；`JWT_SECRET` 通过 `wrangler secret put` 设置，不落明文

## 快捷键

| 快捷键 | 功能 | 快捷键 | 功能 |
|--------|------|--------|------|
| Ctrl+Z | 撤销 | Ctrl+Y / Ctrl+Shift+Z | 重做 |
| Ctrl+C / X / V | 复制 / 剪切 / 粘贴 | Ctrl+B / I / U | 粗体 / 斜体 / 下划线 |
| Ctrl+S | 保存到云端 | Ctrl+Shift+= / Ctrl+- | 插入行 / 删除行 |
| 方向键 | 移动选区 | Shift+方向键 | 扩展选区 |
| Tab / Enter | 右移 / 下移 | F2 | 编辑当前格 |
| Esc | 取消编辑 / 退出虚线框与格式刷 | Delete / Backspace | 清空选区 |
| 直接输入字符 | 进入编辑并替换内容 | 右键菜单 | 插入/删除行、列 |

## 测试

**353 个测试用例**（Vitest，18 个测试文件）：

| 模块 | 数量 | 说明 |
|------|------|------|
| 公式引擎 | 129 | Lexer / Parser / Evaluator / Dependency + 跨 Sheet 引用 + 边界用例 |
| 命令模式 | 59 | 全部命令 execute / undo + 双栈管理 + 连续格式合并 |
| 公式偏移 | 15 | 插入/删除行列后的引用重写 |
| Stores | 71 | 公式传播、撤销重算、多 Sheet 依赖隔离、跨 Sheet 联动、选区模型 |
| 剪贴板 | 20 | ClipboardManager 状态机 + TSV 工具 |
| 组件 | 32 | 网格渲染、格式工具栏（含格式刷）、Sheet 标签 |
| 集成 | 13 | 真实 keydown 事件驱动：复制→粘贴→撤销→重做全链路 |
| 自动保存 | 4 | 2 秒 debounce 自动保存（fake timers） |
| 序列化 | 5 | Map 往返转换 |
| 导出 | 5 | XLSX 导出与往返一致性 |

覆盖率统计聚焦公式引擎（`src/engine`），运行 `pnpm test:coverage` 查看报告。测试驱动发现并修复了 8 个真实 bug（绝对引用丢失、循环引用检测被忽略、粘贴误退复制模式、跨 sheet 同毫秒 id 冲突等）。

## 项目结构

```
src/
├── engine/        # 公式引擎（tokenize → parse → evaluate + 依赖图，含跨 Sheet）
├── model/         # 数据模型 + 命令定义 + 序列化 + 公式偏移（零依赖）
├── stores/        # Pinia Stores（workbook / ui / formula）
├── services/      # 命令调度 / 剪贴板状态机 / 导入导出 / 云端 API / 异步公式
├── composables/   # 虚拟滚动 / 键盘导航
├── components/    # UI 组件（网格 / 工具栏 / 公式栏 / Sheet 标签 / 右键菜单 / 登录栏）
└── workers/       # 公式求值 Web Worker

server/            # 后端方案 A：Express + node:sqlite（Render 部署）
├── src/
│   ├── index.ts   # Express 路由（REST + 鉴权中间件）
│   ├── db.ts      # node:sqlite（users / workbooks 表 + 迁移）
│   └── auth.ts    # scrypt 哈希 + 手写 JWT
├── Dockerfile     # 容器镜像
└── render.yaml    # Render 蓝图（含 SQLite 持久磁盘）

workers/           # 后端方案 B：Cloudflare Workers（Hono + D1，接口与 server/ 一致）
├── src/           # index.ts / db.ts / auth.ts
├── schema.sql     # D1 建表脚本
└── wrangler.toml  # Worker 配置（D1 binding + CORS）
```

## License

本项目采用 [Apache License 2.0](LICENSE)。
