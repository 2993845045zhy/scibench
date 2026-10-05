---
description: 全量台架回归 — 依序跑全部测试台架，汇总回归判定，夜间/改参后一键体检
---

# /bench-all — 全台架回归链

输入：$ARGUMENTS 可选：台架子集关键字（空 = 全部 bench_/cmp_ 台架）。

无人值守执行（长任务，预计 10~60 分钟，期间可随时插话）：

1. **盘点**：列出 tests/ 下将运行的台架清单（bench_/cmp_ 前缀），报一行给用户后开工
2. **逐台运行**（~/anaconda3/envs/ros2ws/bin/python）：
   - 每个台架跑完把结果按原文档格式回写 docs/<stem>_result.md
   - 单个台架失败不中断：记录报错，继续下一个
   - 明显超时（>15 分钟无输出）跳过并标注
3. **回归判定**：对照上一版结果文档（git diff），逐台架标
   改善 / 持平 / 回归（数字对比写明）
4. **汇总**：experiments/ 落一张 `<今日>-bench-regression/meta.md` 证据卡：
   - 结论：ALL-GREEN / N-REGRESSION（回归的台架逐个列出差多少）
   - 变量：本次代码 HEAD（git rev-parse --short HEAD）
5. **汇报**：一段式总结（X 台架，Y 改善，Z 回归，回归的是哪几个、差多少、
   疑似关联的提交），等用户决定是否追查

规则：不粉饰回归数字；GPU/EGL 竞态敏感的台架（历史教训）串行跑；
跑完不改任何代码——回归定位是下一步的事，不擅自修。

---

## 进度上报（工作台「进度」页实时显示）

启动链路时创建 `.research/progress/bench-all.json`（目录不存在先建），之后每步状态变化都更新它；结束置终态。steps 数组 = 本命令的编号步骤（id 用步骤短名，title 用中文步骤名）：

```json
{"chain":"bench-all","title":"<链路中文名>","status":"running","startedAt":"<ISO8601>","updatedAt":"<ISO8601>","steps":[{"id":"lit","title":"文献综述","status":"completed","at":"<ISO8601>"},{"id":"plan","title":"研究计划","status":"in_progress"}]}
```

- status：链路级 `running | done | failed | paused`；步骤级 `pending | in_progress | completed | failed | skipped`
- 每次更新都写 updatedAt；失败时把当前步骤置 failed 并在链路级同步 failed
