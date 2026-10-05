---
description: 组会/周报链 — 汇编实验卡+台架结果+git 进展+项目记忆，一键产出汇报文档
---

# /report — 组会汇报链

输入：$ARGUMENTS 可选天数窗口（默认 14 天，对齐双周组会节奏）。

无人值守执行：

1. **捞证据**：experiments/ 下窗口内的全部 meta.md（含 NEGATIVE——判负也是进展）
2. **捞台架**：docs/*_result.md 中窗口内有更新的台架，抽每张表的关键行（最优配置 + 相对基线差值）
3. **捞代码线**：git log --since=<窗口> 提炼（每条一句话，指标已在 commit message 里）
4. **捞记忆**：science MCP project_memory 读项目 timeline 与当前状态
5. **产出** `docs/reports/组会-<日期>.md`，结构：
   - 一句话总览（当前阶段 + 最重要一个数字变化）
   - 进展三条（每条：结论 + 数字 + 证据卡路径）
   - 判负与教训（同样列——这是导师最认的部分）
   - 下一步计划（从 PROCEED 卡的后续 + mpc_design 的阶段计划取）
   - 附录：本窗口全部实验卡/台架表清单
6. 若项目有 paper/：附论文进度一段（哪章在写、评审 major 是否清零）
7. 汇报给用户要点，问是否需要转成英文版或 PPT 大纲

规则：只引用证据卡和结果文档里真实存在的数字；没有数据的进展不写；
导师视角措辞（讲清"为什么判负也有价值"）。

---

## 进度上报（工作台「进度」页实时显示）

启动链路时创建 `.research/progress/report.json`（目录不存在先建），之后每步状态变化都更新它；结束置终态。steps 数组 = 本命令的编号步骤（id 用步骤短名，title 用中文步骤名）：

```json
{"chain":"report","title":"<链路中文名>","status":"running","startedAt":"<ISO8601>","updatedAt":"<ISO8601>","steps":[{"id":"lit","title":"文献综述","status":"completed","at":"<ISO8601>"},{"id":"plan","title":"研究计划","status":"in_progress"}]}
```

- status：链路级 `running | done | failed | paused`；步骤级 `pending | in_progress | completed | failed | skipped`
- 每次更新都写 updatedAt；失败时把当前步骤置 failed 并在链路级同步 failed
