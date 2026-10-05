---
description: 投稿链 — 标题摘要提炼 + 期刊/会议匹配 + 一键打包（正文/图/补充/cover letter）
---

# /submit — 投稿准备链

输入：$ARGUMENTS 为目标 venue（空则走推荐模式）。

无人值守执行：

1. `auto_title_abstract`（science MCP）：从当前稿件提炼标题/摘要/关键词候选各 2~3 版
2. `venue_suggest`：按稿件主题推荐 3~5 个目标（含匹配理由、级别、周期）；用户已指定
   venue 则跳过推荐，直接核对格式要求（用 WebSearch 查官网实时信息，不凭记忆）
3. `package_submission`：打包 zip（正文 PDF + 图源 + 补充材料 + checklist）
4. Cover letter：按 venue 与稿件贡献点起草（中文稿出中英双语版），落
   `paper/submission/<venue>-<日期>/`

汇报：三件产物路径 + "投稿前人工必查清单"（作者信息/单位/基金/格式页数/伦理声明）。
规则：投稿信息以官网为准；deadline 显示"截至查询时刻"，提醒用户自行复核。
打包完成 ≠ 可投，最终决定权在用户。
