---
name: exp-log
description: Record experiment evidence with parameter snapshots, data fingerprints, and metrics into self-describing experiment directories and commit messages. Use when the user mentions 实验记录/跑实验/记录结果/A/B 对比/复盘, after running benchmarks or real-machine tests, or when writing experiment conclusions.
allowed-tools: Read Write Edit Bash
---

# Experiment Evidence Logging（实验证据记录）

把"跑了一次实验"变成"留下一条可复盘的证据"。核心：每份记录自描述——
半年后只看这一个目录就能知道当时做了什么、结果如何、为什么。

## 记录格式

每次实验建 `experiments/YYYY-MM-DD-<slug>/`，包含：

```
meta.md        # 人读的记录（模板见下）
params.*       # 参数快照（yaml/json 原样导出，禁止手抄）
data/          # 原始数据：能搬进来的就**复制整份**（如 npz dump、csv），
               # 只有体积大到不合理（>50MB）才降级为指纹（文件名+大小+md5 前 8 位）
figs/          # 关键曲线/截图（每张配一行说明）
```

原始 dump 的标准位置：真机/仿真应用的落盘目录（如 ~/.ros2/pbvs_servo_dump_*.npz）
→ 记卡时复制最近的进 data/ 并注明来源路径与时间；应用侧自动清理不迁怒于卡内副本。

### meta.md 模板

```markdown
# <一句话目标，如：验证速度前馈对稳态 RMS 的影响>

- 日期 / 时长 / 场景（真机 or 仿真，场景编号）
- 变量：只列本次改变的参数（旧值 → 新值）
- 基线：对比的上一份实验目录路径
- 结果指标：每个指标一行（数值 + 单位 + 统计口径，如"末 3s RMS"）
- 结论：PROCEED / REFINE / PIVOT / NEGATIVE（判负也要写明差多少）
- 意外观察：任何计划外的现象，哪怕解释不了
```

## 规则

1. **指标写数值不写形容词**——"好了很多"不合格，"稳态 RMS 3.2mm → 1.8mm"合格。
2. **一次只改一个变量**；如果实际改了多个，在 meta.md 里如实列出并标注"结论降级"。
3. **判负留档**：失败、变差、无法复现，全部保留，标注 NEGATIVE。
4. **参数快照必须程序导出**（从配置文件/dump 里读），不手抄。
5. **commit message 带指标**：把结果指标成段写进 commit message，格式
   `一句话结论 + 关键指标行 + 实验目录路径`。
6. 数据被 .gitignore 排除时，meta.md 里必须留指纹（md5），保证可对得上。

## A/B 对比

- 两组必须同时长、同场景；对比结论附两份目录路径
- 变好/变差逐项列 Δ（如 +12% / −31%），不要只给综合判断
