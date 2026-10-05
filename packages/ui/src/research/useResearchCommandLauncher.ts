// 科研工作台操作台的命令启动器。
// 目标：把链路命令（/lit-review、/paper-flow 等）从「用户手打」变成「按钮点发」。
// 路径完全复用 v4 官方机制（与 useSavedWorkflowLauncher 同构）：
// - 有活跃会话 → lease.transport 直发 sendText，并用共享投影 store 做 optimistic
//   pending + accepted 投影守望（与 SessionPane dispatchSubmissionCommand 同语义）；
// - 草稿态（无活跃会话）→ createSession { workspaceId, firstInput:{text} }，
//   accepted 后经 onSelectTask 导航到新会话，让用户看到链路开工。
// 失败（rejected / transport error）不静默：结构化 error 回给操作台行内提示。
import { useCallback, useRef, useState } from "react";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import {
  acquireWorkspaceConnection,
  type WorkspaceConnectionAgentService,
} from "@/v4/workspaceConnectionRegistry.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { logger } from "@/logger.js";

export interface ResearchCommandTarget {
  workspacePath: string;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
  /** 当前 workspace 激活会话；null = 草稿态。 */
  activeTaskId: string | null;
}

export interface ResearchCommandLaunchError {
  code: string;
  message?: string;
}

interface UseResearchCommandLauncherParams extends ResearchCommandTarget {
  /** createSession 成功后的导航回调（参数对齐 handleSelectTaskInChat）。 */
  onSelectTask?: (
    workspacePath: string,
    taskId: string,
    workspaceIdentity?: string,
    remoteSessionId?: string,
  ) => void;
}

export interface UseResearchCommandLauncherResult {
  /** 发送链路命令文本（含 / 前缀）。成功返回目标 sessionId。 */
  run: (text: string) => Promise<{ ok: true; sessionId: string } | { ok: false; error: ResearchCommandLaunchError }>;
  pending: boolean;
  error: ResearchCommandLaunchError | null;
  clearError: () => void;
}

export function useResearchCommandLauncher(
  params: UseResearchCommandLauncherParams,
): UseResearchCommandLauncherResult {
  const { workspacePath, workspaceIdentity, remoteSessionId, activeTaskId, onSelectTask } = params;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ResearchCommandLaunchError | null>(null);
  const pendingRef = useRef(false);
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    remoteSessionId ?? null,
    workspaceIdentity ?? null,
  );
  const platform = usePlatform();

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async (
      text: string,
    ): Promise<{ ok: true; sessionId: string } | { ok: false; error: ResearchCommandLaunchError }> => {
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
        const nextError: ResearchCommandLaunchError = { code, ...(message ? { message } : {}) };
        setError(nextError);
        return { ok: false as const, error: nextError };
      };

      try {
        if (activeTaskId) {
          // 活跃会话：与 SessionPane sendText 同一条 v4 命令路。
          // sessionLease.store 即 SessionPane 正在用的共享投影 store（refCount 单订阅），
          // markCommandPending 提供 optimistic 输入行；accepted 后的投影守望防 echo 丢失。
          const sessionLease = lease.layer.acquire(activeTaskId);
          let envelope;
          try {
            envelope = createCommandEnvelope({
              type: "sendText",
              payload: { text: trimmed },
              sessionId: activeTaskId,
            });
            sessionLease.store.markCommandPending({
              commandId: envelope.commandId,
              type: envelope.type,
              issuedAt: envelope.issuedAt,
            });
          } catch (pendingError) {
            sessionLease.release();
            logger.warn("[research-launcher] markCommandPending 失败，降级直发", {
              error: pendingError instanceof Error ? pendingError.message : String(pendingError),
            });
            envelope = createCommandEnvelope({
              type: "sendText",
              payload: { text: trimmed },
              sessionId: activeTaskId,
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
            return { ok: true, sessionId: activeTaskId };
          }
          try {
            sessionLease.store.settleCommand(envelope.commandId);
          } catch {
            // optimistic 行清理失败由 store watchdog 收尾。
          }
          sessionLease.release();
          logger.warn("[research-launcher] sendText 被拒", {
            status: ack.status,
            reasonCode: ack.reasonCode ?? null,
          });
          return fail(ack.reasonCode ?? ack.status, ack.message);
        }

        // 草稿态：新建会话并首发（firstInput 模式/模型缺省继承 workspace 默认）。
        const workspaceId = workspaceIdentity?.trim() || workspacePath;
        const createAck = await lease.transport.sendCommand(
          createCommandEnvelope({
            type: "createSession",
            payload: { workspaceId, firstInput: { text: trimmed } },
            sessionId: null,
          }),
        );
        if (createAck.status !== "accepted" || createAck.result?.type !== "createSession") {
          logger.warn("[research-launcher] createSession 被拒", {
            workspaceId,
            status: createAck.status,
            reasonCode: createAck.reasonCode ?? null,
          });
          return fail(createAck.reasonCode ?? createAck.status, createAck.message);
        }
        const sessionId = createAck.result.sessionId;
        onSelectTask?.(
          workspacePath,
          sessionId,
          workspaceIdentity ?? undefined,
          remoteSessionId ?? undefined,
        );
        return { ok: true, sessionId };
      } catch (thrown) {
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        logger.warn("[research-launcher] 发送异常", { message });
        return fail("exception", message);
      } finally {
        lease.release();
        pendingRef.current = false;
        setPending(false);
      }
    },
    [
      activeTaskId,
      onSelectTask,
      platform,
      remoteSessionId,
      resolution.rpcReady,
      resolution.remoteSessionId,
      resolution.services.zcodeAgentService,
      workspaceIdentity,
      workspacePath,
    ],
  );

  return { run, pending, error, clearError };
}
