// 活跃会话的实时步骤（TodoWrite → v4 plan 投影）订阅，供工作台进度仪表盘。
// 连接与订阅完全复用官方共享层：acquireWorkspaceConnection 与 SessionPane 同 key
// refCount 共享一条 transport + SessionDataLayer；layer.acquire(taskId) 与聊天 pane
// 共享同一投影 store（多 pane = 多视图）。释放也走各自 release，不拆别人的订阅。
import { useEffect, useMemo, useState } from "react";
import type { PlanState } from "@zcode/shared/zcode-protocol-v4";
import { acquireWorkspaceConnection } from "@/v4/workspaceConnectionRegistry.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { usePlatform } from "@/hooks/usePlatform.js";

export interface ActiveTaskPlanResult {
  /** 当前会话 todo 投影；null = 无会话或尚无步骤。 */
  plan: PlanState | null;
  /** 投影连接状态：closed/closed 复用 CLOSED_STATE 语义。 */
  connected: boolean;
}

export function useActiveTaskPlan(params: {
  workspacePath: string;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
  activeTaskId: string | null;
}): ActiveTaskPlanResult {
  const { workspacePath, workspaceIdentity, remoteSessionId, activeTaskId } = params;
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    remoteSessionId ?? null,
    workspaceIdentity ?? null,
  );
  const platform = usePlatform();

  // 与 ReadyV4PaneConversationProvider 相同的 memo 建连 + cleanup 释放模式。
  const connectionLease = useMemo(() => {
    if (!resolution.rpcReady) return null;
    return acquireWorkspaceConnection(
      {
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(resolution.remoteSessionId ? { remoteSessionId: resolution.remoteSessionId } : {}),
      },
      resolution.services.zcodeAgentService,
      resolution.remoteSessionId ? undefined : platform.createLocalMediaPreviewUrl,
    );
  }, [
    platform,
    resolution.rpcReady,
    resolution.remoteSessionId,
    resolution.services.zcodeAgentService,
    workspaceIdentity,
    workspacePath,
  ]);
  useEffect(() => () => connectionLease?.release(), [connectionLease]);

  const [sessionLease, setSessionLease] = useState<SessionLease | null>(null);
  useEffect(() => {
    if (!connectionLease || !activeTaskId) {
      setSessionLease(null);
      return undefined;
    }
    try {
      const lease = connectionLease.layer.acquire(activeTaskId);
      setSessionLease(lease);
      return () => {
        lease.release();
        setSessionLease(null);
      };
    } catch {
      // 会话可能在切换瞬间被删：acquire 抛错按无会话处理。
      setSessionLease(null);
      return undefined;
    }
  }, [connectionLease, activeTaskId]);

  const state = useConversationProjection(sessionLease);
  return {
    plan: state.snapshot?.plan ?? null,
    connected: state.status !== "closed",
  };
}
