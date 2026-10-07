// 学习面板：科研工作站的"随问随答"通道。
// 提问走 selection side chat 子会话（见 useLearningAsk），回答在面板内流的
// 独立会话里进行，主对话不受影响；快捷条把用户级 learn/why/review 三个
// skill 变成一键动作，无需记忆命令。学习卡统计读 ~/learning/cards 的
// frontmatter（与 ~/.zcode/skills 里的 review skill 共用同一份卡库）。
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpenIcon,
  GraduationCapIcon,
  HelpCircleIcon,
  LoaderIcon,
  RotateCcwIcon,
  SendIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { SessionPane } from "@/v4/SessionPane.js";
import { V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useWorkspaceHomePath } from "@/hooks/useWorkspaceHomePath.js";
import { useLearningAsk, type LearningAskError } from "@/learning/useLearningAsk.js";
import { logger } from "@/logger.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import { cn } from "@/components/lib/utils.js";

const CARD_HEAD_LIMIT_BYTES = 2048;

interface LearningCardStats {
  total: number;
  due: number;
}

/**
 * 读 ~/learning/cards/*.md 的 frontmatter 统计卡片与今日到期数。
 * 目录不存在或读取失败一律降级为 {total: 0, due: 0}，不阻塞面板。
 */
function useLearningCardStats(
  params: {
    workspacePath: string;
    workspaceIdentity?: string | null;
    remoteSessionId?: string | null;
    refreshKey: number;
  },
): LearningCardStats | null {
  const { fileService } = useWorkspaceServices(
    params.workspacePath,
    params.remoteSessionId,
    params.workspaceIdentity,
  );
  const homePath = useWorkspaceHomePath(params);
  const [stats, setStats] = useState<LearningCardStats | null>(null);

  useEffect(() => {
    let disposed = false;
    if (!fileService || !homePath) {
      return () => {
        disposed = true;
      };
    }
    const cardsDir = `${homePath}/learning/cards`;
    void (async () => {
      const next: LearningCardStats = { total: 0, due: 0 };
      try {
        const entries = await fileService.readdir({ path: cardsDir });
        const cards = entries.filter((entry) => entry.path.endsWith(".md"));
        const today = new Date().toISOString().slice(0, 10);
        next.total = cards.length;
        await Promise.all(
          cards.map(async (card) => {
            try {
              const frontmatter = await fileService.readTextFile({
                path: card.path,
                length: CARD_HEAD_LIMIT_BYTES,
              });
              const head = frontmatter.content;
              const markerAt = head.indexOf("due:");
              if (markerAt !== -1) {
                let cursor = markerAt + 4;
                while (cursor < head.length) {
                  const ch = head[cursor];
                  if (ch !== " " && ch !== '"' && ch !== "'") break;
                  cursor += 1;
                }
                const dueDate = head.slice(cursor, cursor + 10);
                if (dueDate.length === 10 && !Number.isNaN(Date.parse(dueDate)) && dueDate <= today) {
                  next.due += 1;
                }
              }
            } catch {
              // 单卡读取失败不影响统计其余卡片。
            }
          }),
        );
      } catch (error) {
        logger.warn("[learning-cards] 读取学习卡目录失败", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      if (!disposed) {
        setStats(next);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [fileService, homePath, params.refreshKey]);

  return stats;
}

function learningAskErrorMessage(error: LearningAskError, formatMessage: (id: string) => string) {
  switch (error.code) {
    case "rpc_not_ready":
      return formatMessage("learning.error.rpc");
    case "command_in_flight":
      return formatMessage("learning.error.busy");
    case "no_parent_session":
      return formatMessage("learning.error.noParent");
    default:
      return formatMessage("learning.error.rejected");
  }
}

export const LearningPane = memo(function LearningPane({
  focused,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  activeTaskId,
  onOpenBrowserUrl,
  onOpenCodeViewer,
  onOpenFileLink,
}: {
  focused: boolean;
  workspacePath: string;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
  activeTaskId: string | null;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
}) {
  const { intl } = useZCodeIntl();
  const [draft, setDraft] = useState("");
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const { ask, reset, childSessionId, pending, error, clearError } = useLearningAsk({
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    parentTaskId: activeTaskId,
  });
  const stats = useLearningCardStats({
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    refreshKey: statsRefreshKey,
  });

  // 面板重新可见时刷新统计（复习/存卡都可能改了 frontmatter）。
  useEffect(() => {
    if (focused) {
      setStatsRefreshKey((key) => key + 1);
    }
  }, [focused]);

  const submit = useCallback(
    async (mode: "learn" | "why" | "review") => {
      const term = draft.trim();
      if (mode !== "review" && !term) {
        return;
      }
      const text =
        mode === "learn"
          ? `/learn ${term}`
          : mode === "why"
            ? `/why ${term}`
            : "/review";
      const result = await ask(text);
      if (result.ok) {
        setDraft("");
      }
    },
    [ask, draft],
  );

  const handleUnavailable = useCallback(() => {
    // 子会话失效（被删/远端断开）：回到欢迎态，下次提问自动重建。
    reset();
  }, [reset]);

  const scope = useMemo<PaneWorkspaceScope>(
    () => ({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(remoteSessionId ? { remoteSessionId } : {}),
    }),
    [remoteSessionId, workspaceIdentity, workspacePath],
  );

  const disabledReason = pending ? "busy" : !activeTaskId ? "noParent" : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-subtle">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-3">
        {!childSessionId ? (
          <div className="flex items-start gap-2.5 px-1">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background text-foreground-subtle">
              <GraduationCapIcon className="size-4" strokeWidth={1.33} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-ui-base font-medium text-foreground">
                {intl.formatMessage({ id: "learning.title" })}
              </p>
              <p className="mt-0.5 text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "learning.subtitle" })}
              </p>
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) {
                clearError();
              }
            }}
            placeholder={intl.formatMessage({ id: "learning.placeholder" })}
            className="h-8 min-w-0 flex-1 text-ui-sm"
            disabled={disabledReason !== null}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit("learn");
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 gap-1.5 px-2.5 text-ui-sm"
            disabled={disabledReason !== null || !draft.trim()}
            onClick={() => void submit("learn")}
          >
            {pending ? (
              <LoaderIcon
                className="size-3.5 animate-spin motion-reduce:animate-none"
                strokeWidth={1.33}
                aria-hidden
              />
            ) : (
              <SendIcon className="size-3.5" strokeWidth={1.33} aria-hidden />
            )}
            {intl.formatMessage({ id: "learning.actions.explain" })}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 gap-1.5 px-2 text-ui-xs"
            disabled={disabledReason !== null || !draft.trim()}
            onClick={() => void submit("why")}
          >
            <HelpCircleIcon className="size-3.5" strokeWidth={1.33} aria-hidden />
            {intl.formatMessage({ id: "learning.actions.why" })}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 gap-1.5 px-2 text-ui-xs"
            disabled={disabledReason !== null}
            onClick={() => void submit("review")}
          >
            <BookOpenIcon className="size-3.5" strokeWidth={1.33} aria-hidden />
            {intl.formatMessage({ id: "learning.actions.review" })}
          </Button>
          {childSessionId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-7 gap-1.5 px-2 text-ui-xs"
              disabled={pending}
              onClick={handleUnavailable}
              title={intl.formatMessage({ id: "learning.actions.newRound" })}
            >
              <RotateCcwIcon className="size-3.5" strokeWidth={1.33} aria-hidden />
              {intl.formatMessage({ id: "learning.actions.newRound" })}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="px-1 text-ui-xs text-danger">
            {learningAskErrorMessage(error, (id) => intl.formatMessage({ id }))}
          </p>
        ) : null}
        {!childSessionId ? (
          <p
            className={cn(
              "px-1 text-ui-xs",
              disabledReason === "noParent" ? "text-warning" : "text-foreground-subtlest",
            )}
          >
            {disabledReason === "noParent"
              ? intl.formatMessage({ id: "learning.hint.noParent" })
              : stats
                ? stats.total > 0
                  ? intl.formatMessage(
                      { id: "learning.stats.summary" },
                      { total: stats.total, due: stats.due },
                    )
                : intl.formatMessage({ id: "learning.stats.empty" })
              : null}
          </p>
        ) : null}
      </div>
      {childSessionId ? (
        <div className="min-h-0 flex-1">
          <V4PaneConversationProvider scope={scope}>
            <SessionPane
              paneId="learning"
              sessionId={childSessionId}
              openTrigger="selection"
              selectionSideChat
              focused={focused}
              telemetryVisible={focused}
              workspacePath={workspacePath}
              workspaceIdentity={workspaceIdentity ?? undefined}
              remoteSessionId={remoteSessionId ?? undefined}
              onOpenBrowserUrl={onOpenBrowserUrl}
              onOpenCodeViewer={onOpenCodeViewer}
              onOpenFileLink={onOpenFileLink}
              onSelectionSideChatUnavailable={handleUnavailable}
            />
          </V4PaneConversationProvider>
        </div>
      ) : null}
    </div>
  );
});
