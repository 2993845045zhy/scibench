---
description: 复现链 — 论文 PDF 五步闭环复现（解析→方案→代码→沙箱运行→比对交付），异步轮询到出结果
---

# /reproduce — 论文复现链

输入：$ARGUMENTS 为论文 PDF 路径（空则在工作区找最近加入的 PDF，找不到就问一次）。

无人值守执行：

1. `reproduce_paper`（science MCP）提交复现任务（框架 pytorch，记下 task_id）
2. `reproduce_status` 每 60~90 秒轮询一次，直到终态；期间不打扰用户，
   用户插入其它问题照常回答
3. 终态后自动：
   - `research_verdict`：按结果给 PROCEED / REFINE / PIVOT 建议
   - `review_code`：复现代码静态点评（种子/硬编码/风险 + 可信度分）
   - `get_deliverables`：清点交付物（源码/数据/报告/图）
4. 结果并入项目：若项目有 paper/，用 `inject_results` 把复现指标写入实验章节草稿；
   同时按 exp-log 规范在 `experiments/<今日>-repro-<slug>/meta.md` 落一条证据卡
   （结论按 verdict，NEGATIVE 也留档）

汇报格式：复现结果 vs 论文声称（逐指标对照表）+ 差异原因分析 + verdict + 交付物路径。
数据不达标时如实写差距，不粉饰。
