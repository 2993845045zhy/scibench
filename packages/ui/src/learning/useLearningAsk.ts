// 学习面板的提问通道。
// 复用 selection side chat 的子会话机制：首次提问用 createSelectionSideSession
// 以 firstInput 创建子会话（父 = 当前活跃会话，父会话收件箱不受影响），
// 之后的问题直发该子会话（sendText + 乐观回显）。发送路径与
// useResearchCommandLauncher 同构（v4 lease + 共享投影 store）。
import { useCallback, useRef, useState } from "react";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import {
  acquireWorkspaceConnection,
  type WorkspaceConnectionAgentService,
} from "@/v4/workspaceConnectionRegistry.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useLearningPaneStore } from "@/store/learningPaneStore.js";
import { logger } from "@/logger.js";

export interface LearningAskError {
  code: string;
  message?: string;
}

export function useLearningAsk(
  params: {
    workspacePath: string;
    workspaceIdentity?: string | null;
    remoteSessionId?: string | null;
    /** 当前 workspace 激活会话，作为子会话的父；null = 尚无可用父会话。 */
    parentTaskId: string | null;
  },
): {
  /** 发送提问文本（含 / 前缀命令）。成功返回目标 sessionId。 */
  ask: (
    text: string,
  ) => Promise<{ ok: true; sessionId: string } | { ok: false; error: LearningAskError }>;
  /** 丢弃当前子会话，回到欢迎态；下次提问创建新子会话。 */
  reset: () => void;
  childSessionId: string | null;
  pending: boolean;
  error: LearningAskError | null;
  clearError: () => void;
} {
  const { workspacePath, workspaceIdentity, remoteSessionId, parentTaskId } = params;
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LearningAskError | null>(null);
  const pendingRef = useRef(false);
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    remoteSessionId ?? null,
    workspaceIdentity ?? null,
  );
  const platform = usePlatform();
  const childSessionId =
    useLearningPaneStore((state) => state.childSessionIds[workspaceKey]) ?? null;

  const clearError = useCallback(() => setError(null), []);

  const reset = useCallback(() => {
    useLearningPaneStore.getState().clearChildSession(workspaceKey);
    setError(null);
  }, [workspaceKey]);

  const ask = useCallback(
    async (
      text: string,
    ): Promise<{ ok: true; sessionId: string } | { ok: false; error: LearningAskError }> => {
      const trimmed = text.trim();
      if (!trimmed) {
        return { ok: false, error: { code: "empty_text" } };
      }
      if (pendingRef.current) {
        return { ok: false, error: { code: "command_in_flight" } };
      }
      if (!resolution.rpcReady) {
        return { ok: false, error: { code: "rpc_not_ready" } };
      }
      const existingChild =
        useLearningPaneStore.getState().childSessionIds[workspaceKey] ?? null;
      if (!existingChild && !parentTaskId) {
        return { ok: false, error: { code: "no_parent_session" } };
      }
      pendingRef.current = true;
      setPending(true);
      setError(null);

      const agentService: WorkspaceConnectionAgentService = resolution.services.zcodeAgentService;
      const lease = acquireWorkspaceConnection(
        {
          workspacePath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          ...(resolution.remoteSessionId ? { remoteSessionId: resolution.remoteSessionId } : {}),
        },
        agentService,
        resolution.remoteSessionId ? undefined : platform.createLocalMediaPreviewUrl,
      );

      const fail = (code: string, message?: string) => {
        const nextError: LearningAskError = { code, ...(message ? { message } : {}) };
        setError(nextError);
        return { ok: false as const, error: nextError };
      };

      try {
        if (existingChild) {
          // 子会话已存在：与 SessionPane sendText 同一条命令路，乐观回显同款。
          const sessionLease = lease.layer.acquire(existingChild);
          let envelope;
          try {
            envelope = createCommandEnvelope({
              type: "sendText",
              payload: { text: trimmed },
              sessionId: existingChild,
            });
            sessionLease.store.markCommandPending({
              commandId: envelope.commandId,
              type: envelope.type,
              issuedAt: envelope.issuedAt,
            });
          } catch (pendingError) {
            sessionLease.release();
            logger.warn("[learning-ask] markCommandPending 失败，降级直发", {
              error: pendingError instanceof Error ? pendingError.message : String(pendingError),
            });
            envelope = createCommandEnvelope({
              type: "sendText",
              payload: { text: trimmed },
              sessionId: existingChild,
            });
          }
          const ack = await lease.transport.sendCommand(envelope);
          if (ack.status === "accepted" || ack.status === "duplicate") {
            try {
              sessionLease.store.expectAcceptedInputProjection(envelope.commandId);
            } catch {
              // 守望注册失败不阻塞：服务端 echo 仍会正常投影。
            }
            sessionLease.release();
            return { ok: true, sessionId: existingChild };
          }
          try {
            sessionLease.store.settleCommand(envelope.commandId);
          } catch {
            // optimistic 行清理失败由 store watchdog 收尾。
          }
          sessionLease.release();
          logger.warn("[learning-ask] sendText 被拒", {
            status: ack.status,
            reasonCode: ack.reasonCode ?? null,
          });
          return fail(ack.reasonCode ?? ack.status, ack.message);
        }

        // 首次提问：创建 selection side 子会话（父会话由 envelope.sessionId 指定）。
        const createAck = await lease.transport.sendCommand(
          createCommandEnvelope({
            type: "createSelectionSideSession",
            payload: { firstInput: { text: trimmed } },
            sessionId: parentTaskId,
          }),
        );
        if (
          (createAck.status !== "accepted" && createAck.status !== "duplicate") ||
          createAck.result?.type !== "createSelectionSideSession"
        ) {
          logger.warn("[learning-ask] createSelectionSideSession 被拒", {
            status: createAck.status,
            reasonCode: createAck.reasonCode ?? null,
          });
          return fail(createAck.reasonCode ?? createAck.status, createAck.message);
        }
        const nextChildSessionId = createAck.result.sessionId;
        useLearningPaneStore.getState().setChildSession(workspaceKey, nextChildSessionId);
        return { ok: true, sessionId: nextChildSessionId };
      } catch (thrown) {
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        logger.warn("[learning-ask] 发送异常", { message });
        return fail("exception", message);
      } finally {
        lease.release();
        pendingRef.current = false;
        setPending(false);
      }
    },
    [
      parentTaskId,
      platform,
      resolution.rpcReady,
      resolution.remoteSessionId,
      resolution.services.zcodeAgentService,
      workspaceIdentity,
      workspaceKey,
      workspacePath,
    ],
  );

  return { ask, reset, childSessionId, pending, error, clearError };
}
