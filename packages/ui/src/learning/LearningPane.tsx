// 科研工作台「学习」栏目：承载"讲解选中"的辅助子会话。
// 提问链路复用 selection side chat 机制（子会话回答，主对话不受影响），
// 但渲染位置在科研工作台内部，不新开副屏 tab。
import { memo, useCallback, useMemo } from "react";
import { GraduationCapIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { SessionPane } from "@/v4/SessionPane.js";
import { V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useLearningPaneStore } from "@/store/learningPaneStore.js";

export const LearningPane = memo(function LearningPane({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
}: {
  workspacePath: string;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
}) {
  const { intl } = useZCodeIntl();
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const childSessionId = useLearningPaneStore((state) =>
    state.workspaceKey === workspaceKey ? state.childSessionId : null,
  );
  const clearChildSession = useLearningPaneStore((state) => state.clearChildSession);
  const handleUnavailable = useCallback(() => {
    clearChildSession();
  }, [clearChildSession]);
  const scope = useMemo<PaneWorkspaceScope>(
    () => ({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(remoteSessionId ? { remoteSessionId } : {}),
    }),
    [remoteSessionId, workspaceIdentity, workspacePath],
  );

  if (!childSessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="flex size-10 items-center justify-center rounded-xl bg-background text-foreground-subtle">
          <GraduationCapIcon className="size-5" strokeWidth={1.33} aria-hidden />
        </span>
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "learning.emptyHint" })}
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end px-3 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-ui-xs"
          onClick={handleUnavailable}
        >
          <RotateCcwIcon className="size-3.5" strokeWidth={1.33} aria-hidden />
          {intl.formatMessage({ id: "learning.newRound" })}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <V4PaneConversationProvider scope={scope}>
          <SessionPane
            paneId="research-learning"
            sessionId={childSessionId}
            openTrigger="selection"
            selectionSideChat
            focused
            telemetryVisible
            workspacePath={workspacePath}
            workspaceIdentity={workspaceIdentity ?? undefined}
            remoteSessionId={remoteSessionId ?? undefined}
            onSelectionSideChatUnavailable={handleUnavailable}
          />
        </V4PaneConversationProvider>
      </div>
    </div>
  );
});
