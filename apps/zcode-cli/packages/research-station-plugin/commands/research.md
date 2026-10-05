---
description: 科研工作台入口 — 盘点当前项目研究状态并建议下一步
---

# /research — 工作台入口

对当前工作目录做一次研究状态盘点，输出一屏摘要 + 下一步建议。

执行：

1. 读项目 `AGENTS.md`（若无，先问是否要跑 research-init 建骨架）
2. 扫 `experiments/`（最近 5 条：日期、一句话结论、PROCEED/REFINE/PIVOT/NEGATIVE）
3. 扫 `paper/`、`figures/`、`docs/lit/` 的完成度（存在哪些、缺哪些）
4. 检查 git log 最近 5 条与未提交改动
5. 检查 science MCP 是否连接（`mcp__science_` 前缀工具是否可用），
   未连接时给出修复路径：`~/opt/research-venv` 是否存在、
   握手探针是否返回 serverInfo（命令见 docs-science/WORKSTATION.md）

输出格式（中文）：

```
## 项目状态：<项目名> · <阶段>
- 实验线：最近结论 …（N 条记录，M 条 NEGATIVE）
- 论文线：… 
- 未提交改动：…
- 工具链：science MCP ✓/✗
## 建议的下一步（按优先级，最多 3 条）
1. …
2. …
3. …
```

不要自动开始执行建议——先给用户看。
