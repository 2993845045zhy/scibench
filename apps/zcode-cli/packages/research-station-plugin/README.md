# research-station

SciBench 科研工作台的内置扩展层（ZCode fork 自带，默认启用）。

## 组成

- **skills/**
  - `research-init` — 新科研项目脚手架：目录约定 + AGENTS.md 研究模板 + Git 证据习惯
  - `exp-log` — 实验证据记录：参数快照 / 数据指纹 / 指标 / 判负留档，统一进 commit
  - `paper-pipeline` — 论文产线：文献 → 方法 → 图表 → 中英文稿 → 评审 → 投稿
- **commands/**（六条链路命令 + 入口，全部无人值守优先）
  - `/research` — 工作台入口：盘点当前项目研究状态并给下一步建议
  - `/lit-review <主题>` — 文献链：综述 + 引文热度 + 创新性核查 → docs/lit/
  - `/reproduce <pdf>` — 复现链：五步闭环复现 + verdict + 代码点评 + 证据落卡
  - `/verify [实验目录…]` — 验证链：显著性检验 + 自旋门决策 + 代码体检，写回实验卡
  - `/peer-review [稿件]` — 评审链：模拟评审 + 完整性一致性 + 回应表 → paper/reviews/
  - `/submit [venue]` — 投稿链：标题摘要提炼 + venue 匹配 + 打包 + cover letter
  - `/paper-flow <主题|继续>` — 全链路无人值守：文献→计划→写作→验证→评审→打包，
    断点续跑（paper/flow-state.md）
- **.mcp.json** — `science` MCP server（clawsgo-science-mcp，24 工具：
  文献检索/综述/评审/沙箱复现/显著性检验/投稿匹配…）
  - 依赖 venv：`/home/robot/opt/research-venv/bin/python`（mcp 钉 1.x）
  - 安装方式见仓库根 `docs-science/WORKSTATION.md`（不含密钥；LLM 增强可选配 DeepSeek）

## 设计原则

- 通用层只装"跨项目通用"的能力；项目专属知识放各项目的 `.zcode/` 与 `AGENTS.md`
- 证据优先：宁可留判负记录，不留无数据的结论
- 与官方 ZCode 插件（document-skills、zcode-guide 等）共存，不重复其功能
