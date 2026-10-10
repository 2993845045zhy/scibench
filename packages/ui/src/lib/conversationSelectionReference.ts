import { createUuid } from "@zcode/shared";

export const CONVERSATION_SELECTION_MAX_TEXT_LENGTH = 8_000;
const CONVERSATION_SELECTION_MAX_COUNT = 8;
const CONVERSATION_SELECTION_MAX_TOTAL_LENGTH = 16_000;

export type ConversationSelectionContentType = "user" | "assistant" | "reasoning" | "tool";

export interface ConversationSelectionText {
  text: string;
  path?: string;
}

export interface MessageSelectionReference extends ConversationSelectionText {
  id: string;
  sourceSessionId: string;
  sourceRowId: number;
  contentType: ConversationSelectionContentType;
}

export interface MarkdownSelectionReference extends ConversationSelectionText {
  id: string;
  contentType: "markdown";
  sourceKey: string;
  sourceTitle: string;
}

export type ConversationSelectionReference = MessageSelectionReference | MarkdownSelectionReference;

export interface MarkdownSelectionTarget {
  sessionId: string | null;
  workspaceKey: string;
}

export type ConversationSelectionDisplayReference =
  | ConversationSelectionText
  | ConversationSelectionReference;

interface ConversationSelectionAddEventDetail {
  targetSessionId: string | null;
  workspaceKey: string;
  reference: ConversationSelectionReference;
  result?: ConversationSelectionAppendResult;
}

export type ConversationSelectionLimitReason = "count" | "single" | "total";
type ConversationSelectionAppendResult =
  | {
      ok: true;
      references: readonly ConversationSelectionReference[];
      duplicate: boolean;
    }
  | { ok: false; reason: ConversationSelectionLimitReason };

const ADD_EVENT = "zcode:conversation-selection-add";
const USER_SELECT_BLOCK_PATTERN = /(?:\n\n)?# userselect:\n```userselect\n([\s\S]*?)\n```\s*$/;
const LEGACY_BLOCK_PATTERN =
  /(?:\n\n)?# Conversation selections:\n```zcode-conversation-selections\n([\s\S]*?)\n```\s*$/;
const referencesByScope = new Map<string, readonly ConversationSelectionReference[]>();
const limitReasonByScope = new Map<string, ConversationSelectionLimitReason>();

function referenceScopeKey(sessionId: string | null, workspaceKey: string): string {
  return `${workspaceKey}\0${sessionId ?? "__draft__"}`;
}

export function getConversationSelectionReferenceScope(
  sessionId: string | null,
  workspaceKey: string,
): readonly ConversationSelectionReference[] {
  return referencesByScope.get(referenceScopeKey(sessionId, workspaceKey)) ?? [];
}

export function setConversationSelectionReferenceScope(
  sessionId: string | null,
  workspaceKey: string,
  references: readonly ConversationSelectionReference[],
): void {
  const key = referenceScopeKey(sessionId, workspaceKey);
  if (references.length > 0) referencesByScope.set(key, references);
  else referencesByScope.delete(key);
  limitReasonByScope.delete(key);
}

export function getConversationSelectionReferenceLimitReason(
  sessionId: string | null,
  workspaceKey: string,
): ConversationSelectionLimitReason | null {
  return limitReasonByScope.get(referenceScopeKey(sessionId, workspaceKey)) ?? null;
}

export function clearConversationSelectionReferenceScope(
  sessionId: string,
  workspaceKey: string,
): void {
  referencesByScope.delete(referenceScopeKey(sessionId, workspaceKey));
  limitReasonByScope.delete(referenceScopeKey(sessionId, workspaceKey));
}

export function clearConversationSelectionReferenceLimitReason(
  sessionId: string | null,
  workspaceKey: string,
): void {
  limitReasonByScope.delete(referenceScopeKey(sessionId, workspaceKey));
}

export function createConversationSelectionReference(
  input: Omit<MessageSelectionReference, "id"> | Omit<MarkdownSelectionReference, "id">,
): ConversationSelectionReference {
  return { ...input, id: createUuid() };
}

function getConversationSelectionDedupeKey(reference: ConversationSelectionReference): string {
  if (reference.contentType === "markdown") {
    return ["markdown", reference.sourceKey, reference.text].join("\0");
  }
  return [
    reference.sourceSessionId,
    reference.sourceRowId,
    reference.contentType,
    reference.text,
  ].join("\0");
}

function appendConversationSelectionReference(
  current: readonly ConversationSelectionReference[],
  reference: ConversationSelectionReference,
): ConversationSelectionAppendResult {
  if (reference.text.length > CONVERSATION_SELECTION_MAX_TEXT_LENGTH) {
    return { ok: false, reason: "single" };
  }
  const key = getConversationSelectionDedupeKey(reference);
  if (current.some((item) => getConversationSelectionDedupeKey(item) === key)) {
    return { ok: true, references: current, duplicate: true };
  }
  if (current.length >= CONVERSATION_SELECTION_MAX_COUNT) {
    return { ok: false, reason: "count" };
  }
  const totalLength = current.reduce((sum, item) => sum + item.text.length, 0);
  if (totalLength + reference.text.length > CONVERSATION_SELECTION_MAX_TOTAL_LENGTH) {
    return { ok: false, reason: "total" };
  }
  return { ok: true, references: [...current, reference], duplicate: false };
}

export function buildPromptWithConversationSelections(
  visibleContent: string,
  references: readonly ConversationSelectionDisplayReference[],
): string {
  if (references.length === 0) return visibleContent;
  // 文件选段曾只发正文，导致模型与历史丢失文件来源；只保留路径，不发送内部身份字段。
  const block = [
    "# userselect:",
    "```userselect",
    JSON.stringify(references.map(({ text, path }) => (path?.trim() ? { path, text } : { text }))),
    "```",
  ].join("\n");
  return visibleContent ? `${visibleContent}\n\n${block}` : block;
}

export function parsePromptConversationSelections(text: string): {
  visibleContent: string;
  references: readonly ConversationSelectionDisplayReference[];
} {
  const userSelectMatch = text.match(USER_SELECT_BLOCK_PATTERN);
  if (userSelectMatch) {
    return parseConversationSelectionBlock(text, userSelectMatch, (value) => {
      if (!isConversationSelectionText(value)) return null;
      // 与发送合同一致，历史保留文件路径，普通对话继续只恢复正文。
      return value.path ? { path: value.path, text: value.text } : { text: value.text };
    });
  }
  const legacyMatch = text.match(LEGACY_BLOCK_PATTERN);
  if (!legacyMatch) return { visibleContent: text, references: [] };
  return parseConversationSelectionBlock(text, legacyMatch, (value) =>
    isConversationSelectionReference(value) ? value : null,
  );
}

function parseConversationSelectionBlock<T extends ConversationSelectionDisplayReference>(
  text: string,
  match: RegExpMatchArray,
  parseItem: (value: unknown) => T | null,
): { visibleContent: string; references: readonly T[] } {
  try {
    const parsed = JSON.parse(match[1] ?? "[]");
    if (!Array.isArray(parsed)) throw new Error("selection block is not an array");
    const references: T[] = [];
    for (const value of parsed) {
      const reference = parseItem(value);
      if (!reference) throw new Error("invalid selection reference");
      references.push(reference);
    }
    return {
      visibleContent: text.slice(0, match.index).trimEnd(),
      references,
    };
  } catch {
    return { visibleContent: text, references: [] };
  }
}

export function dispatchConversationSelectionAdd(
  detail: Omit<ConversationSelectionAddEventDetail, "result">,
): ConversationSelectionAppendResult {
  const current = getConversationSelectionReferenceScope(
    detail.targetSessionId,
    detail.workspaceKey,
  );
  const result = appendConversationSelectionReference(current, detail.reference);
  if (result.ok) {
    setConversationSelectionReferenceScope(
      detail.targetSessionId,
      detail.workspaceKey,
      result.references,
    );
  } else {
    limitReasonByScope.set(
      referenceScopeKey(detail.targetSessionId, detail.workspaceKey),
      result.reason,
    );
  }
  window.dispatchEvent(new CustomEvent(ADD_EVENT, { detail: { ...detail, result } }));
  return result;
}

export function isConversationSelectionAddEvent(
  event: Event,
): event is CustomEvent<ConversationSelectionAddEventDetail> {
  return event.type === ADD_EVENT && event instanceof CustomEvent;
}

export function getConversationSelectionAddEventName(): string {
  return ADD_EVENT;
}

function isConversationSelectionText(value: unknown): value is ConversationSelectionText {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ConversationSelectionText>;
  return (
    typeof candidate.text === "string" &&
    (!("path" in value) ||
      (typeof candidate.path === "string" && candidate.path.trim().length > 0)) &&
    Object.keys(value).every((key) => key === "text" || key === "path")
  );
}

export function isConversationSelectionReference(
  value: unknown,
): value is ConversationSelectionReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConversationSelectionReference>;
  if (candidate.contentType === "markdown") {
    return (
      typeof candidate.id === "string" &&
      typeof candidate.text === "string" &&
      typeof candidate.sourceKey === "string" &&
      typeof candidate.sourceTitle === "string"
    );
  }
  return (
    typeof candidate.id === "string" &&
    "sourceSessionId" in candidate &&
    typeof candidate.sourceSessionId === "string" &&
    "sourceRowId" in candidate &&
    typeof candidate.sourceRowId === "number" &&
    typeof candidate.text === "string" &&
    ["user", "assistant", "reasoning", "tool"].includes(candidate.contentType ?? "")
  );
}

/** "讲解选中"首条消息的选区文本上限：太长的选区讲解失焦，提醒选关键句更有效。 */
const LEARNING_SELECTION_PROMPT_TEXT_LIMIT = 1200;

/**
 * 学习"讲解选中"的首条消息文案：讲解规范内嵌在提问里（不依赖 skill 是否
 * 被触发），保证回答短、通俗、贴用户水平；用户追问时再逐步深入。
 */
export function buildLearningSelectionPrompt(text: string): string {
  const trimmed =
    text.length > LEARNING_SELECTION_PROMPT_TEXT_LIMIT
      ? `${text.slice(0, LEARNING_SELECTION_PROMPT_TEXT_LIMIT)}…`
      : text;
  return [
    "请讲解下面选中的内容，严格遵守：",
    "1) 第一句话（30 字以内）说清它是什么；",
    "2) 再用 2~4 句大白话讲它的工作原理——我是生物医学工程大二学生，懂 Python/PyTorch，在学 ROS 2 和机械臂；不堆术语，必须打比方；",
    "3) 最后一句说它什么时候用得上；",
    "4) 全文不超过 150 字，不要标题、不要列表、不要展开细节，我想深入时会追问。",
    "",
    "内容：",
    trimmed,
  ].join("\n");
}
