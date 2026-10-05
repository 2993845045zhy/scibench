# SciBench

<div align="center">
  <img src="packages/desktop/build/icon.png" alt="SciBench" width="128" height="128" />
</div>

<p align="center">个人本地科研工作站 —— 以 <a href="https://github.com/zai-org/ZCode">ZCode 开源版</a>（Apache-2.0）为底座魔改，形态对标 ClawsGO Science，但完全运行在本机。</p>

## 这是什么

ZCode 是 AI 编程工作台；SciBench 在它之上加了一层**科研工作流**：文献、实验、论文、台架、交付物全部有专属界面，科研链路（综述→复现→写作→验证→评审→投稿）做成一条命令/一个按钮，长任务有实时进度仪表盘。

三个设计立场：

1. **完全本地**——不经云端沙箱；数据在本机 Git 里，可复现可追溯
2. **与对话共写**——工作台是右侧大面板，agent 在左边干活，右边实时看产物变化，不切换上下文
3. **视觉即 ZCode**——所有新增 UI 直接复用 ZCode 官方组件与设计 token（SettingsResourceList、官方 todo 行样式、Progress 等），不另起炉灶

## 功能总览

### 科研工作台（应用右侧面板，九栏 + 文件树）

| 栏目 | 内容 |
|---|---|
| 总览 | 项目大标题 + 进行中横幅 + **操作台**：8 条链路命令按钮直发当前会话（或新建会话），带参链路点行展开参数输入，不用手打命令 |
| 进度 | **实时步骤**（TodoWrite 投影，与聊天面板同源）+ **链路运行状态**（`.research/progress/*.json`，watcher + 轮询自动刷新） |
| LaTeX | 源码/PDF 并排（官方 Resizable + CodeViewer），SyncTeX 双向跳转，源码区字号/主题跟随设置 |
| 图表 | 图墙 + 图上拖拽圈注（位置随指令交给 agent）+ **版本历史**：`fig.png`/`fig_v2.png`/`fig_v3.png` 自动归并，版本条翻版，`versions.json` 备注；反馈指令自带「存 vN+1 不覆盖旧版」约定 |
| 实验 | 证据卡（参数快照/数据指纹/结论），verdict 徽章（PROCEED/REFINE/PIVOT/NEGATIVE） |
| 台架 | `tests/` 下 `bench_/cmp_` 脚本盘点 + 结果文档数据表渲染 |
| 代码 | 工作台内代码查看（官方 PreviewPane，30+ 语言高亮） |
| 文献 | 三源解析：BibTeX / 编号列表 / `docs/papers/` 本地 PDF；条目级内嵌 PDF 预览 |
| 交付 | 按类分组（投稿包/论文/评审/文献/实验）+ **成品预览**：PDF/图片/markdown 渲染/文本/zip |

### research-station 插件（默认启用）

- **链路命令**：`/paper-flow`（全链路无人值守）、`/lit-review`、`/reproduce`、`/verify`、`/peer-review`、`/submit`、`/bench-all`、`/report`
- **进度上报协议**：链路执行时写 `.research/progress/<chain>.json`，工作台进度页实时可视化
- **技能**：`research-init`（项目脚手架）、`exp-log`（实验证据记录，原始数据入库规则）、`paper-pipeline`（论文工作流）
- **science MCP**（24 个工具，5 条管线：复现/写作/调研/论文/交付），装在本机 venv：`~/opt/research-venv`（`mcp<2`）

### 科研项目目录约定（工作台按此自动发现，零配置）

```
experiments/<日期>-<slug>/meta.md   # 证据卡（exp-log 技能生成）
paper/main.tex · paper/figures/     # LaTeX 与图
docs/lit/<slug>/                    # 文献调研产物
docs/reports/                       # 组会报告
docs/<bench>_result.md              # 台架结果文档
.research/progress/                 # 链路进度状态
figures/ · docs/figures/            # 图表（三处任一）
tests/bench_* · cmp_*               # 测试台架
```

## 运行

环境：Node.js 24.x + pnpm 10.x（本机在 `~/opt/node24`）。

```bash
pnpm bootstrap        # 安装依赖 + 构建桌面运行资源（首次）
pnpm dev:desktop      # 桌面端开发模式（tsup watch + vite + electron）
```

一次性准备（Linux，Electron SUID 沙箱）：

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Web 模式（无桌面，本机部署在 `~/opt/scibench`，`scibench --web` 启动）：桌面 runtime = `packages/web`（vite 构建）+ 各包 tsc 产物 + CLI bundle，部署方式见 `~/opt/scibench/zcode/bin/zcode.mjs`。

### 本机环境备忘

- `.npmrc` registry 指向 npmmirror（npmjs.org 直连不通）；GitHub 走 SSH 22 端口直连
- 桌面端身份已与官方 ZCode 隔离：productName `SciBench`，独立 userData 目录
- Linux 桌面集成：`~/.local/share/applications/scibench.desktop` + hicolor 图标 + Dock 固定（注意：Electron 忽略 `--class` 开关，dev 态窗口 WM_CLASS 仍为 `zcode dev`，与 `.desktop` 的 `StartupWMClass=SciBench` 不匹配——窗口分组未完全对齐，待解）

## 与上游的关系

- 分叉基点：`29628c9`（ZCode v3.14.3，Apache-2.0）
- 上游远程保留为 `upstream`（`git fetch upstream` 可同步官方更新）
- 改动集中在：`packages/ui/src/ResearchWorkbench.tsx`（工作台全部 UI）、`packages/ui/src/research/`（命令启动器/会话投影 hook）、`apps/zcode-cli/packages/research-station-plugin/`（插件）、`packages/desktop/build/`（图标）、i18n 两侧 locale
- 升级上游时注意：`ResearchWorkbench` 挂载点（`AnimatedSidePanePanel`）、插件注册（`official-plugin-definitions.ts` / `plugin-marketplaces.ts`）是侵入点，合并冲突优先保功能再对齐上游样式

## 许可

Apache-2.0（继承上游）。第三方声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 与 [NOTICE.md](NOTICE.md)。
