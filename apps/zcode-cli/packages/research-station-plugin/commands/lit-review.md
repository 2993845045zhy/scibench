---
description: 文献链 — 主题综述 + 引文热度 + 创新性核查，一键无人值守，产物落 docs/lit/
---

# /lit-review — 文献综述链

输入：$ARGUMENTS 为主题（空则从项目 AGENTS.md 研究问题推导，仍不确定就问一次）。

无人值守执行（工具缺失时降级 WebSearch 并在产物中注明）：

1. `literature_review`（science MCP）：主题 → 代表文献/聚类/缺口/综述结构
2. `citation_landscape`：对 2~3 篇核心文献（或主题）做引文热度/年度分布/高被引分析
3. `check_novelty`：若项目已有方法描述（AGENTS.md / docs/），抽关键词核查与近期工作的重叠与差异点
4. `science_search` 补 2~3 篇近 12 个月预印本（arXiv），标记"只看摘要"

产物（全部落 `docs/lit/<slug>/`，slug 为主题短名）：
- `review.md`：综述笔记（每篇：问题/方法/指标/结论四行 + BibTeX；区分"读过的"和"只看摘要的"）
- `landscape.md`：热度分析 + 缺口清单（缺口按"与我们方法的对照"写）
- `novelty.md`：重叠与候选差异点

规则：引用必须真实（核验 DOI/标题）；查不到的直接标注不存在；
结尾给"这三篇最值得精读"并说明理由。完成后把缺口清单要点汇报给用户。

---

## 进度上报（工作台「进度」页实时显示）

启动链路时创建 `.research/progress/lit-review.json`（目录不存在先建），之后每步状态变化都更新它；结束置终态。steps 数组 = 本命令的编号步骤（id 用步骤短名，title 用中文步骤名）：

```json
{"chain":"lit-review","title":"<链路中文名>","status":"running","startedAt":"<ISO8601>","updatedAt":"<ISO8601>","steps":[{"id":"lit","title":"文献综述","status":"completed","at":"<ISO8601>"},{"id":"plan","title":"研究计划","status":"in_progress"}]}
```

- status：链路级 `running | done | failed | paused`；步骤级 `pending | in_progress | completed | failed | skipped`
- 每次更新都写 updatedAt；失败时把当前步骤置 failed 并在链路级同步 failed
