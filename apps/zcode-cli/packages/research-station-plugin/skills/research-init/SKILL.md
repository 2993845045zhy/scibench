---
name: research-init
description: Scaffold a new research project with standard directory conventions, research AGENTS.md template, and git evidence workflow. Use when the user starts a new research topic, says 开题/新课题/建项目/研究立项, or asks to set up a project for papers, experiments, or thesis work.
allowed-tools: Read Write Edit Bash
---

# Research Project Scaffolding（科研项目脚手架）

为新科研项目建立统一骨架。目标：任何课题从第一天起就有统一的目录、证据习惯和
agent 可读的项目说明，让后续所有会话（以及 paper-pipeline / exp-log 技能）直接可用。

## 执行步骤

1. **确认项目基本盘**（缺哪问哪，不猜）：
   - 课题名 + 一句话研究问题
   - 预期产出（论文 / 竞赛 / 专利 / 课程报告）
   - 是否有真机/仿真/数据集等实验载体

2. **建目录**（在用户指定的项目根目录下）：

```
<project>/
  AGENTS.md            # 研究项目说明（模板见下）
  docs/                # 文献 PDF、调研笔记、方案设计
  experiments/         # 每次实验一个子目录，自描述
  figures/             # 论文/报告图（每图一目录：图+生成脚本+数据）
  data/                # 原始数据（大文件加 .gitignore + 记录指纹）
  scripts/             # 分析与作图脚本
  paper/               # 稿件源文件（tex/docx/md）与构建脚本
```

3. **写 AGENTS.md**（项目级，必写）：

```markdown
# <项目名>

## 研究问题
<一句话>

## 当前阶段
<选题 / 文献 / 方案 / 实验 / 写作 / 投稿>

## 硬件与环境
<设备、传感器、仿真环境、Python/ROS 版本等>

## 安全与边界
<速度限幅、禁动条件、不可覆盖的参数>

## 证据规则
- 实验一律走 experiments/ 自描述目录（见 exp-log 技能）
- 结论必须有数据支撑；判负结果同样留档
- 一次只改一个变量；改前后同场景对比

## 术语表
<项目专属术语与口径>
```

4. **Git 初始化**：`git init`（若未初始化），首个 commit 包含全部骨架；
   `.gitignore` 排除 `data/*.npz`、`__pycache__`、`build/` 等大文件与产物。

## 约束

- 不自动放入任何 API key、账号信息
- 不虚构研究现状；文献调研交给 paper-pipeline 或 science MCP
- 目录结构可按项目微调，但 AGENTS.md 的六个小节保留
