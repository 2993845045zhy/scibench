// 输入框工具栏的 Token 输出速度徽标（tok/s）。
// 数据与开发者工具面板同源（readSessionDebug 会话调试快照），但仅在回答
// 进行中（running/prewarming）每秒轮询；回答结束后停止轮询并保留最后一次
// 的速度显示，下一轮开始自动恢复实时刷新。快照采集本身在 host 侧常开，
// 这里只控制 renderer 的轮询节奏。
import { memo } from "react";
import type { SessionPhase } from "@zcode/shared/zcode-protocol-v4";
import { useSessionDebug } from "@/hooks/useSessionDebug.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export const TokenSpeedBadge = memo(function TokenSpeedBadge({
  workspacePath,
  workspaceIdentity,
  sessionId,
  phase,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string | null;
  phase: SessionPhase | null;
}) {
  const { intl, locale } = useZCodeIntl();
  const live = phase === "running" || phase === "prewarming";
  const { rounds } = useSessionDebug({
    workspacePath,
    workspaceIdentity,
    taskId: sessionId,
    enabled: Boolean(sessionId) && live,
  });
  if (!sessionId || rounds.length === 0) return null;
  let latest = rounds[0]!;
  for (const round of rounds) {
    if (round.requestIndex > latest.requestIndex) latest = round;
  }
  if (latest.tokensPerSecond === null) return null;
  const speed = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    latest.tokensPerSecond,
  );
  return (
    <span
      data-testid="composer-token-speed"
      title={intl.formatMessage({ id: "chat.toolbar.tokenSpeed.title" })}
      className="whitespace-nowrap px-1 font-mono text-ui-xs tabular-nums text-foreground-subtle"
    >
      {speed} tok/s
    </span>
  );
});
