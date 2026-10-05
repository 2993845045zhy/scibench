---
name: paper-pipeline
description: End-to-end academic paper workflow — literature review, method section drafting, publication-grade figures, Chinese-English translation, simulated peer review, and submission packaging. Use when the user mentions 论文/综述/写稿/改稿/投稿/审稿意见/figures/文献调研, or starts writing any research deliverable (tech report, thesis chapter, competition report).
allowed-tools: Read Write Edit Bash WebSearch WebFetch
---

# Paper Pipeline（论文产线）

从文献到投稿的全流程支持。本技能负责流程编排与质量规则；
工具能力优先用已装的技能与 science MCP（见"工具分工"）。

## 工具分工

- **science MCP**（`mcp__science__*`，若可用）：文献检索（OpenAlex/arXiv/PubMed）、
  literature_review、peer_review、venue_suggest、paper_polish、compare_metrics、
  check_novelty、citation_landscape
- **citation-management 技能**：精确 BibTeX、DOI 核验
- **scientific-writing 技能**：稿件起草与一致性检查（含证据溯源要求）
- **peer-review / scholar-evaluation 技能**：评审模拟与结构化评估
- **pdf/docx/pptx 技能**：产物构建

science MCP 未连接时：文献改用 WebSearch/WebFetch，其余步骤照常，并在产出中
注明"文献覆盖未经数据库核验"。

## 阶段与产出

1. **文献** → `docs/lit/`：综述笔记按主题分文件；每篇记
   问题/方法/指标/结论四行 + BibTeX；区分"读过的"和"只看摘要的"
2. **方法** → `paper/method.md`：公式推导可核验（符号表 + 逐式假设）；
   与代码同名变量对齐
3. **图** → `figures/<fig-name>/`：**每张图一个目录**，含
   图成品 + 生成脚本 + 输入数据 + README 一行（口径与参数）。
   matplotlib 基线：字体嵌入、300dpi、色盲安全配色、单栏 3.5in 双栏 7in
4. **稿** → `paper/`：先中文定稿再翻译；英文稿术语表先行；
   每个事实性陈述可溯源到实验目录或文献条目
5. **评** → `paper/reviews/`：模拟评审逐条给 major/minor，
   回应表（意见 → 改动 → 证据）落档
6. **投** → `paper/submission/`：venue 建议含匹配理由与截止日期核对，
   打包清单（正文/图/补充材料/cover letter/statement）

## 硬规则

- **不虚构任何数据、引用、评审意见**；引用必须真实存在且核验过
  （citation-management 或 DOI 直查）；查不到的引用直接向用户报告
- 图表改动后必须重跑生成脚本，不手改成品图
- 翻译不改变技术口径；术语在全文一致（一次项目一份术语表）
- 投稿信息（截止日期、格式要求）以官网实时信息为准，不凭记忆
