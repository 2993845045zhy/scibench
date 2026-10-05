# research-station

SciBench 科研工作台的内置扩展层（ZCode fork 自带，默认启用）。

## 组成

- **skills/**
  - `research-init` — 新科研项目脚手架：目录约定 + AGENTS.md 研究模板 + Git 证据习惯
  - `exp-log` — 实验证据记录：参数快照 / 数据指纹 / 指标 / 判负留档，统一进 commit
  - `paper-pipeline` — 论文产线：文献 → 方法 → 图表 → 中英文稿 → 评审 → 投稿包
- **commands/**
  - `/research` — 工作台入口：盘点当前项目研究状态并给下一步建议
- **.mcp.json** — `science` MCP server（clawsgo-science-mcp，文献检索/综述/评审/沙箱复现）
  - 依赖 venv：`/home/robot/opt/research-venv/bin/python`（mcp 钉 1.x）
  - 安装方式见仓库根 `docs-science/WORKSTATION.md`（不含密钥；LLM 增强可选配 DeepSeek）

## 设计原则

- 通用层只装"跨项目通用"的能力；项目专属知识放各项目的 `.zcode/` 与 `AGENTS.md`
- 证据优先：宁可留判负记录，不留无数据的结论
- 与官方 ZCode 插件（document-skills、zcode-guide 等）共存，不重复其功能
