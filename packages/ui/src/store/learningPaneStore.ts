import { create } from "zustand";

// 科研工作台「学习」栏目的会话状态：最近一次"讲解选中"创建的辅助子会话。
// 由 SessionPane 的讲解链路写入，科研工作台的学习栏目消费渲染；
// signal 每次讲解自增，驱动两级导航——useAppPanels 激活科研工作台 tab、
// ResearchWorkbench 切到学习栏目。应用重启回空态（子会话仍在会话历史中）。
interface LearningPaneState {
  workspaceKey: string | null;
  childSessionId: string | null;
  signal: number;
  explainInResearchPane: (workspaceKey: string, childSessionId: string) => void;
  clearChildSession: () => void;
}

export const useLearningPaneStore = create<LearningPaneState>((set) => ({
  workspaceKey: null,
  childSessionId: null,
  signal: 0,
  explainInResearchPane: (workspaceKey, childSessionId) =>
    set((state) => ({
      workspaceKey,
      childSessionId,
      signal: state.signal + 1,
    })),
  clearChildSession: () =>
    set((state) => (state.childSessionId ? { childSessionId: null } : state)),
}));
