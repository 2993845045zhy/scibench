import { create } from "zustand";

// 学习面板的子会话注册表：workspace 键 → 辅助子会话 id。
// 生命周期约定：面板打开期间（含 tab 切换、面板折叠）保持，应用重启回到
// 欢迎态；被丢弃的子会话仍留在会话历史中，新提问会创建新的子会话。
// 后续若要跨重启恢复，可参照 SelectionSideChatPaneTab 把 childSessionId
// 挪进 tab 状态（paneLayoutStore 持久化），本 store 届时退役。
interface LearningPaneState {
  childSessionIds: Record<string, string>;
  setChildSession: (workspaceKey: string, childSessionId: string) => void;
  clearChildSession: (workspaceKey: string) => void;
}

export const useLearningPaneStore = create<LearningPaneState>((set) => ({
  childSessionIds: {},
  setChildSession: (workspaceKey, childSessionId) =>
    set((state) => ({
      childSessionIds: { ...state.childSessionIds, [workspaceKey]: childSessionId },
    })),
  clearChildSession: (workspaceKey) =>
    set((state) => {
      if (!(workspaceKey in state.childSessionIds)) return state;
      const childSessionIds = { ...state.childSessionIds };
      delete childSessionIds[workspaceKey];
      return { childSessionIds };
    }),
}));
