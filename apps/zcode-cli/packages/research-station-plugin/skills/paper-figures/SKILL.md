---
name: paper-figures
description: Publication-grade scientific figures — IEEE/Science/Nature 期刊级 matplotlib 出图规范：矢量 PDF + 300dpi PNG 双格式、色盲安全配色、栏宽尺寸、误差带/显著性标注、多子图版式；产物自动接入工作台图表版本历史（fig_vN + versions.json）。Use when the user mentions 画图/出图/论文图/figure/曲线图/对比图/数据可视化/示意图数据版, or a paper/report needs figures from experiment data.
allowed-tools: Read Write Edit Bash
---

# Paper Figures（论文级出图）

每张图都是一个**可复现包**：图（版本化）+ 生成脚本 + 数据来源。工作台「图表」栏
自动发现并按版本归并，不要手动管理版本。

## 硬性规范（每张图必须满足）

1. **解释器**：`~/opt/research-venv/bin/python`（有 matplotlib 3.11 + scienceplots + numpy）
2. **风格**：scienceplots 期刊模板，IEEE 系（会议/学报）用 `['ieee']`，Nature/Science 系用
   `['science', 'nature']`（可用名：ieee / science / nature / std-colors）；**必须先 `import scienceplots`
   再 `plt.style.use`**（import 时才注册样式，这是最常踩的坑）；不可用时按文末降级 rcParams
3. **尺寸**：单栏图宽 **3.5 in**，双栏 **7.16 in**；高度按内容 2.2~3.0 in。禁止 8×6 默认尺寸
4. **配色**：色盲安全（Okabe-Ito，见模板 PALETTE）；线型 + 记号双编码
   （实线○/虚线□/点划线△），黑白打印仍可分辨
5. **格式**：每次同时存 **PDF（矢量，投稿用）+ PNG（600dpi，预览/工作台用）**
6. **字体**：`pdf.fonttype=42`（TrueType 嵌入，期刊要求；注意只有 pdf/ps/svg 有 fonttype，png 没有）；数学用 mathtext `$...$`
7. **轴**：物理量带单位 `Time (s)` / `Success rate (%)`；去顶右脊线；图例 `frameon=False`
8. **误差**：重复实验必须画误差——`errorbar`（点少）或 `fill_between` 带 α=0.2（曲线）；
   n 次随机种子/运行在图注或 caption 写明 n

## 落盘约定（工作台契约，必须遵守）

```
paper/figures/                      # 首选目录（figures/、docs/figures/ 也可）
├── fig_<name>.py                   # 生成脚本（数据从 experiments/ 或 npz 读，不硬编码数字）
├── fig_<name>.pdf                  # 投稿矢量版
├── fig_<name>.png                  # 预览位图（600dpi）
├── fig_<name>_v2.png / .pdf        # 修改后的新版本（不覆盖旧版！）
└── versions.json                   # 版本索引（工作台版本条读它显示备注）
```

- **首次**出图存 `fig_<name>.png/.pdf`；**修改**出图一律存 `_v<N+1>`，
  并向 versions.json 的 `versions` 数组追加一行
- versions.json 格式：`{"versions":[{"file":"fig_x.png","note":"改图例字号","at":"2026-10-06T14:30"}]}`
- 生成脚本必须可独立重跑（`python fig_<name>.py` 直接出同样的图）——审稿返修靠它

## 模板（复制起步）

```python
#!/usr/bin/env python
"""fig_<name>.py — <一句话说明这张图>。数据来源: experiments/<card>/data/."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

PALETTE = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9"]  # Okabe-Ito 色盲安全
MARKERS = ["o", "s", "^", "D", "v"]

import scienceplots  # noqa: F401 — 必须 import 才会注册 ieee/science 样式
plt.style.use(["ieee"])  # 可用样式: ieee / science / nature / std-colors
plt.rcParams.update({"pdf.fonttype": 42})

fig, ax = plt.subplots(figsize=(3.5, 2.6))          # 单栏
# fig, axes = plt.subplots(1, 2, figsize=(7.16, 2.6))  # 双栏双子图

x = np.linspace(0, 10, 50)
mean, std = np.exp(-x / 5), 0.05 * np.exp(-x / 5)
ax.plot(x, mean, color=PALETTE[0], marker=MARKERS[0], markevery=5,
        linewidth=1.2, markersize=3.5, label="Proposed")
ax.fill_between(x, mean - std, mean + std, color=PALETTE[0], alpha=0.2, linewidth=0)
ax.plot(x, np.exp(-x / 3), color=PALETTE[1], linestyle="--", marker=MARKERS[1],
        markevery=5, linewidth=1.2, markersize=3.5, label="Baseline")

ax.set_xlabel("Time (s)")
ax.set_ylabel("Tracking error (m)")
ax.legend(frameon=False)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

fig.savefig("paper/figures/fig_<name>.pdf", bbox_inches="tight")
fig.savefig("paper/figures/fig_<name>.png", dpi=600, bbox_inches="tight")
print("saved fig_<name>")
```

## 常用图型的关键点

- **多方法对比曲线**：统一 x 轴（episode/时间/阈值），fill_between 误差带，双编码
- **柱状对比**：bar + 各柱 errorbar（capsize=3）；差异显著标 `*`/`**` 并在图注说明检验
- **消融**：横向 bar，按提升排序，参考线画 baseline
- **散点相关**：加 identity 虚线 + R² 文本；密度大时 hexbin 或 α=0.3
- **轨迹/机械臂**：3D 用 `projection="3d"` + `box_aspect`；2D 轨迹画目标点十字标
- **热力图**：`imshow` + colorbar 带 label；注明 colormap（相关矩阵用 diverging `RdBu_r`，中心 0）
- **多子图**：`(a)(b)(c)` 面板字母放左上角外侧 `ax.text(-0.15, 1.05, "(a)", transform=ax.transAxes)`

## 流程（用户要图时按此走）

1. 找数据：experiments/ 证据卡 meta.md + data/（npz/csv）；没有就先问，**不编造数据**
2. 想清楚图要支撑文中哪个结论——caption 先行（一句话能说清才动笔）
3. 写 `fig_<name>.py` → 跑 → 自查（字号在 100% 缩放下可读？黑白可辨？单位齐？）
4. 双格式落盘 + 首版登记 versions.json
5. 回复用户：图路径 + caption 草稿 + 下一步建议（如"建议补 n=5 误差带"）

改图（工作台圈注反馈来的）：读 versions.json 取当前最大版本 N → 改脚本 →
存 `_v<N+1>` → versions.json 追加 note（note 写用户改图要点）→ 回复新版本号。

## scienceplots 缺失时降级

```python
plt.rcParams.update({
    "font.family": "serif", "font.size": 8, "axes.labelsize": 8,
    "legend.fontsize": 7, "xtick.labelsize": 7, "ytick.labelsize": 7,
    "axes.linewidth": 0.5, "lines.linewidth": 1.2, "figure.dpi": 120,
    "savefig.dpi": 600, "pdf.fonttype": 42, "axes.spines.top": False,
    "axes.spines.right": False, "legend.frameon": False,
})
```

## 边界

- 架构图/流程示意图**不用** matplotlib 也不用 AI 生图（文字会画错）：
  首选 TikZ（LaTeX 正文内）或 draw.io / Mermaid（导出 PDF），需要时协助写 TikZ/Mermaid 源码
- 交互式探索图不进 paper/figures/（放 /tmp，避免污染版本历史）
