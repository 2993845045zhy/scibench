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

---

## 进度上报（工作台「进度」页实时显示）

启动链路时创建 `.research/progress/reproduce.json`（目录不存在先建），之后每步状态变化都更新它；结束置终态。steps 数组 = 本命令的编号步骤（id 用步骤短名，title 用中文步骤名）：

```json
{"chain":"reproduce","title":"<链路中文名>","status":"running","startedAt":"<ISO8601>","updatedAt":"<ISO8601>","steps":[{"id":"lit","title":"文献综述","status":"completed","at":"<ISO8601>"},{"id":"plan","title":"研究计划","status":"in_progress"}]}
```

- status：链路级 `running | done | failed | paused`；步骤级 `pending | in_progress | completed | failed | skipped`
- 每次更新都写 updatedAt；失败时把当前步骤置 failed 并在链路级同步 failed
