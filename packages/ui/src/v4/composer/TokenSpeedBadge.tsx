// 输入框工具栏的 Token 输出速度徽标（tok/s）。
// 数据与开发者工具面板同源（readSessionDebug 会话调试快照），轮询节拍也与
// 该面板一致（1s）。不要按 phase 收缩轮询窗口：round 在 model_request_completed
// 才落账，简单问答的完成时刻几乎与 phase 翻转重合，收缩窗口会稳定丢掉最后一轮。
import { memo } from "react";
import { useSessionDebug } from "@/hooks/useSessionDebug.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export const TokenSpeedBadge = memo(function TokenSpeedBadge({
  workspacePath,
  workspaceIdentity,
  sessionId,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string | null;
}) {
  const { intl, locale } = useZCodeIntl();
  const { rounds } = useSessionDebug({
    workspacePath,
    workspaceIdentity,
    taskId: sessionId,
    enabled: Boolean(sessionId),
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
