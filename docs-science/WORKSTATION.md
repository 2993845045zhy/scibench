# SciBench — 科研工作台（ZCode fork）

以 [zai-org/ZCode](https://github.com/zai-org/ZCode)（Apache-2.0）为底座的个人科研工作台。
全部本地运行，不依赖云服务器；模型走既有 ZCode 订阅与自有 token。

## 这个 fork 改了什么（相对上游的全部差异）

上游更新时 `git merge upstream/main` 重放以下小差异即可，改动面刻意收敛：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `apps/zcode-cli/packages/core/src/context/sections/cli-prefix.ts` | Agent 身份：ZCode → SciBench 科研工作台（含证据优先的行为导向） |
| 2 | `apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts` | 注册内置插件 `research-station`（默认启用） |
| 3 | `packages/shared/src/plugin-marketplaces.ts` | 默认启用名单同步（与 #2 机械对照） |
| 4 | `apps/zcode-cli/packages/research-station-plugin/`（新增） | 科研扩展层本体：3 技能 + 1 命令 + science MCP 声明 |

## research-station 插件

- `skills/research-init` — 新科研项目脚手架（目录约定 + AGENTS.md 模板 + Git 习惯）
- `skills/exp-log` — 实验证据记录（自描述实验目录、指标进 commit、判负留档）
- `skills/paper-pipeline` — 论文产线（文献→方法→图→稿→评→投，工具分工见技能正文）
- `commands/research.md` — `/research` 工作台入口（项目状态盘点 + 下一步建议）
- `.mcp.json` — `science` MCP（clawsgo-science-mcp：OpenAlex/arXiv/PubMed 检索、
  literature_review、peer_review、venue_suggest、论文沙箱复现等 24 工具）

与用户级 `~/.zcode/skills/` 的 citation-management / peer-review / scholar-evaluation /
scientific-writing 配合使用，不重复。

## 工具链依赖

```bash
# science MCP（必需，装一次）— 用 venv，不用 conda（本机 conda 两个源均有问题：
# defaults 要 ToS、conda-forge 走代理报畸形 URL）
git clone git@github.com:h120750572/clawsgo-science-mcp.git ~/opt/clawsgo-science-mcp
python3 -m venv ~/opt/research-venv
~/opt/research-venv/bin/pip install -e "~/opt/clawsgo-science-mcp[reproduce]" 'mcp<2'
# 注意：mcp 必须钉 1.x（2.x 把 FastMCP 改名了，clawsgo 还没适配）
# 验证（应返回 serverInfo clawsgo-self）：
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0.1"}}}' | ~/opt/research-venv/bin/python -m clawsgo_self.server

# LaTeX（可选；缺失时 MCP 用 PyMuPDF 降级渲染 PDF）
sudo apt install texlive-xetex texlive-latex-extra
```

MCP 命令路径写死在 `research-station-plugin/.mcp.json`
（`/home/robot/opt/research-venv/bin/python`），换机器时同步改。

LLM 增强（可选）：clawsgo 的 OpenAI 兼容端点可配 DeepSeek，
配置文件 `.clawsgo-self/env`（BASE_URL / API_KEY / MODEL），**不要**把 key 提交进仓库。

## 构建与运行

```bash
# 环境：node 24.14.0（~/opt/node24）+ pnpm 10.33.2（corepack）
export PATH="$HOME/opt/node24/bin:$HOME/.local/bin:$PATH"
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"   # 国内网络需要

pnpm install
pnpm --filter @zcode/cli... build          # 构建 Agent CLI（含 TUI）
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help

# 完整发行包（TUI + Web + Agent，zcode --web 起 Web 界面）
pnpm build:zcode                          # 产物在 dist/zcode/
```

开发提示：`ZCODE_DATA_BASE_DIR=~/ .zcode-dev-home` 隔离开发数据目录，不污染正式配置。

## 设计边界

- 通用能力（文献/写作/证据规则）进本插件；项目专属知识进各项目 `.zcode/` 与 `AGENTS.md`
- 不在仓库内存任何 API key / 账号信息
- 上游月度更新时可整体 merge；冲突预期只在 #2/#3 两处小段
