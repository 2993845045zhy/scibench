---
description: 全链路无人值守 — 文献→计划→写作→验证→评审→投稿包，一条命令跑完整个科研产线
---

# /paper-flow — 科研产线全链路（无人值守）

输入：$ARGUMENTS 为研究主题或"继续"（继续 = 从 docs/lit/ 与 AGENTS.md 现状接力）。

这是六条链路的串联总闸。执行原则：**只在不可逆或花钱的节点停下问用户，
其余全部自主推进**；每完成一站，在 `paper/flow-state.md` 记录进度（断点续跑用）。

流程（每站完成即汇报一行，然后继续下一站）：

1. **文献**：执行 /lit-review 逻辑 → docs/lit/<slug>/
2. **计划**：`research_plan` 产研究计划书（RQ/假设/方法/基线/指标/里程碑）→
   docs/plan.md；与用户确认一次计划（唯一必停点①：方向错了后面全白干）
3. **写作**：按计划分章写稿（write_section：problem→method→experiments→results→
   conclusion），实验数据从 experiments/ 的 meta.md 取——没有数据的段落标注
   [待实验]，不编造；中文定稿后询问是否英译（必停点②）
4. **验证**：对稿中引用的每张实验卡执行 /verify 逻辑（显著性 + 自旋门），
   不显著的结论在稿中降级措辞
5. **评审**：执行 /peer-review 逻辑，major 意见自动修改并复检一轮
6. **打包**：执行 /submit 逻辑（推荐模式）

产物汇总：`paper/flow-report.md`（六站状态 + 产物清单 + 遗留 TODO）。
中断恢复：重跑 /paper-flow 继续 自动从 flow-state.md 断点接力。
时长提示：全链路含多次 LLM/MCP 调用，预计 30~90 分钟，期间可随时插话。
