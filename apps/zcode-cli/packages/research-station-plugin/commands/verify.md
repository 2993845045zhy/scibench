---
description: 验证链 — 实验指标统计检验（显著性）+ 自旋门决策（PROCEED/REFINE/PIVOT）+ 代码静态体检，结论写回实验卡
---

# /verify — 结果验证链

输入：$ARGUMENTS 可指定 experiments/ 下的任务目录（多个用空格分隔；空则取最近两条同主题记录做 A/B）。

无人值守执行：

1. `compare_metrics`（science MCP）：读各目录 meta.md / 指标序列，做对比表 +
   Welch t / Mann-Whitney U 显著性检验（基线取第一个任务）
2. `research_verdict`：综合效应量、显著性、方向一致性给 PROCEED / REFINE / PIVOT
3. 代码体检：若实验涉及脚本（tests/ 或 scripts/），对改动文件做静态检查
   （硬编码/随机种子/数据泄漏风险），结论附可信度
4. 写回：在最新一张实验卡的 meta.md 末尾追加一节：

   ```
   ## 验证（<日期>，/verify）
   - 统计检验：<方法> p=<值>，效应=<值>，判定显著/不显著
   - 自旋门：PROCEED/REFINE/PIVOT + 一句理由
   - 代码体检：<通过/风险点>
   ```

5. commit：指标与 verdict 进 commit message

规则：样本量不足以检验时如实说"n 不足，仅描述统计"，不硬算；
两条记录变量不唯一时降级为"结论不可信（多变量）"并在卡片标注。
