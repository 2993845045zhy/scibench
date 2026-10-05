---
description: 评审链 — 模拟同行评审 + 润色检查 + 逐条回应表，产物落 paper/reviews/
---

# /peer-review — 模拟评审链

输入：$ARGUMENTS 为稿件路径（空则优先 paper/main.tex，其次 docs/ 里最新的 md/docx 论文稿）。

无人值守执行：

1. `peer_review`（science MCP）：4 维评分（novelty/rigor/clarity/soundness）+ 推荐 +
   优点/缺点/修改建议（major/minor 分列）
2. `paper_polish`：completeness（完整性）与 consistency（一致性）各跑一遍
3. 交叉核验：评审提到的每条事实性意见，回到稿件定位证据（章节/行）；
   稿件中没有支撑的意见标注"评审幻觉，可忽略"——不把幻觉意见带进回应表
4. 产物（落 `paper/reviews/<日期>/`）：
   - `review.md`：评审意见全文 + 逐条定位
   - `response.md`：回应表（意见 → 采纳/部分采纳/驳回 + 理由 → 计划改动）
   - `polish.md`：完整性/一致性检查结果
5. 汇报：给"三条必须先改的 major"，问用户是否按回应表执行修改

规则：意见是模拟生成的决策辅助，不是真实审稿人立场——产物页首必须带此声明。

---

## 进度上报（工作台「进度」页实时显示）

启动链路时创建 `.research/progress/peer-review.json`（目录不存在先建），之后每步状态变化都更新它；结束置终态。steps 数组 = 本命令的编号步骤（id 用步骤短名，title 用中文步骤名）：

```json
{"chain":"peer-review","title":"<链路中文名>","status":"running","startedAt":"<ISO8601>","updatedAt":"<ISO8601>","steps":[{"id":"lit","title":"文献综述","status":"completed","at":"<ISO8601>"},{"id":"plan","title":"研究计划","status":"in_progress"}]}
```

- status：链路级 `running | done | failed | paused`；步骤级 `pending | in_progress | completed | failed | skipped`
- 每次更新都写 updatedAt；失败时把当前步骤置 failed 并在链路级同步 failed
