/* oxlint-disable eslint(max-lines) -- 科研工作台 UI 按仓库约定收口在单文件（见 README 改动集中说明）；学习面板已拆到 src/learning/，本文件不再增长。 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  ClipboardCopyIcon,
  ClipboardListIcon,
  CodeIcon,
  EraserIcon,
  EyeIcon,
  FileIcon,
  FileTextIcon,
  FlaskConicalIcon,
  FolderIcon,
  HistoryIcon,
  ImageIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  ListIcon,
  LoaderIcon,
  MessageSquareIcon,
  PackageIcon,
  PlayIcon,
  RefreshCwIcon,
  RocketIcon,
  SendIcon,
  TriangleAlertIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable.js";
import { CodeViewer, findCodeViewerLineElement } from "@/components/ui/code-viewer.js";
import { Progress } from "@/components/ui/progress.js";
import {
  SettingsResourceGroupHeader,
  SettingsResourceList,
} from "@/settings/SettingsResourceGroup.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.js";
import { Spinner } from "@/components/ui/spinner.js";
import { PreviewPane } from "@/PreviewPane.js";
import { FileDisplayIcon, resolveFileDisplayDescriptor } from "@/lib/fileDisplay.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { resolveTheme } from "@/useTheme.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import {
  useResearchCommandLauncher,
  type UseResearchCommandLauncherResult,
} from "@/research/useResearchCommandLauncher.js";
import { useActiveTaskPlan } from "@/research/useActiveTaskPlan.js";
import { cn } from "@/components/lib/utils.js";
import type { IDisposable } from "@zcode/rpc";
import type { FileEntry } from "@zcode/shared";
import type { PdfViewerLabels, PdfViewerSource } from "@/components/ui/pdf-viewer.js";

// react-pdf 体积大，沿用 PreviewPane 的懒加载策略：首次用到才进 bundle。
const PdfViewer = lazy(() =>
  import("@/components/ui/pdf-viewer.js").then((module) => ({
    default: module.PdfViewer,
  })),
);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const TEX_SOURCE_LIMIT_BYTES = 256 * 1024;
const META_LIMIT_BYTES = 16 * 1024;
const FIGURE_SCAN_DEPTH = 2;
const PDF_FULL_READ_MAX_BYTES = 8 * 1024 * 1024;
const OVERLAY_PDF_MAX_BYTES = 16 * 1024 * 1024;
const SYNCTEX_MAX_BYTES = 4 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT_BYTES = 64 * 1024;

/** 文件树可打开的代码类扩展名 → CodeViewer 语言 id；不在表内=不反应。 */
const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  java: "java",
  rs: "rust",
  go: "go",
  rb: "ruby",
  php: "php",
  md: "markdown",
  markdown: "markdown",
  txt: "log",
  swift: "swift",
  kt: "kotlin",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  toml: "toml",
  ini: "ini",
  xml: "xml",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  r: "r",
  matlab: "matlab",
  cmake: "cmake",
  dockerfile: "dockerfile",
};

type ResearchSection =
  | "overview"
  | "progress"
  | "latex"
  | "figures"
  | "experiments"
  | "bench"
  | "code"
  | "literature"
  | "deliverables";

const SECTIONS: Array<{
  id: ResearchSection;
  icon: typeof FileTextIcon;
  labelId: string;
}> = [
  { id: "overview", icon: LayoutDashboardIcon, labelId: "research.overview.tab" },
  { id: "progress", icon: WorkflowIcon, labelId: "research.progress.tab" },
  { id: "latex", icon: FileTextIcon, labelId: "research.latex.tab" },
  { id: "figures", icon: ImageIcon, labelId: "research.figures.tab" },
  { id: "experiments", icon: ListIcon, labelId: "research.experiments.tab" },
  { id: "bench", icon: ActivityIcon, labelId: "research.bench.tab" },
  { id: "code", icon: CodeIcon, labelId: "research.code.tab" },
  { id: "literature", icon: BookOpenIcon, labelId: "research.literature.tab" },
  { id: "deliverables", icon: PackageIcon, labelId: "research.deliverables.tab" },
];

/** tests/ 下视为台架的脚本前缀；结果文档约定 docs/<stem>_result.md。 */
const BENCH_FILE_PATTERN = /^(bench_|cmp_)/;

/** 链路命令进度状态文件目录（/paper-flow 等链路执行中实时更新）。 */
const PROGRESS_DIR = ".research/progress";

/** 操作台动作卡定义：链路命令 → 按钮直发，用户不再手打命令。 */
interface ChainActionDef {
  id: string;
  command: string;
  icon: typeof FileTextIcon;
  titleId: string;
  descId: string;
  /** 需要用户补一个参数（主题/路径/关键字）；optional = 可留空。 */
  arg?: { placeholderId: string; required?: boolean };
}

const CHAIN_ACTIONS: ChainActionDef[] = [
  {
    id: "paper-flow",
    command: "/paper-flow",
    icon: WorkflowIcon,
    titleId: "research.actions.paperFlow",
    descId: "research.actions.paperFlowDesc",
    arg: { placeholderId: "research.actions.paperFlowArg" },
  },
  {
    id: "lit-review",
    command: "/lit-review",
    icon: BookOpenIcon,
    titleId: "research.actions.litReview",
    descId: "research.actions.litReviewDesc",
    arg: { placeholderId: "research.actions.litReviewArg" },
  },
  {
    id: "reproduce",
    command: "/reproduce",
    icon: FileTextIcon,
    titleId: "research.actions.reproduce",
    descId: "research.actions.reproduceDesc",
    arg: { placeholderId: "research.actions.reproduceArg", required: true },
  },
  {
    id: "verify",
    command: "/verify",
    icon: ListChecksIcon,
    titleId: "research.actions.verify",
    descId: "research.actions.verifyDesc",
  },
  {
    id: "peer-review",
    command: "/peer-review",
    icon: MessageSquareIcon,
    titleId: "research.actions.peerReview",
    descId: "research.actions.peerReviewDesc",
  },
  {
    id: "submit",
    command: "/submit",
    icon: SendIcon,
    titleId: "research.actions.submit",
    descId: "research.actions.submitDesc",
  },
  {
    id: "bench-all",
    command: "/bench-all",
    icon: ActivityIcon,
    titleId: "research.actions.benchAll",
    descId: "research.actions.benchAllDesc",
    arg: { placeholderId: "research.actions.benchAllArg" },
  },
  {
    id: "report",
    command: "/report",
    icon: ClipboardListIcon,
    titleId: "research.actions.report",
    descId: "research.actions.reportDesc",
  },
];

/** 图表文件名中的版本后缀：policy_v2 / policy.v3 / policy-v2 → 版本 2/3/2。 */
const FIGURE_VERSION_PATTERN = /^(.+?)[._-]?v(\d{1,3})$/i;

function joinPath(base: string, rel: string): string {
  const cleanRel = rel.replace(/^\/+/, "");
  return `${base.replace(/\/+$/, "")}/${cleanRel}`;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

interface WatcherServiceLike {
  watch(params: { path: string; recursive?: boolean }): Promise<{ id: string }>;
  unwatch(params: { id: string }): Promise<void>;
  onDynamicChange(id: string): (listener: (event: unknown) => void) => IDisposable;
}

/**
 * 目录变更监听：agent 在对话侧改文件（编译出 PDF、写 meta.md、重生成图）时，
 * 工作台对应子页自动刷新，用户零操作。watch 失败静默降级为手动刷新。
 */
function useDirChangeWatcher(
  dirPath: string,
  watcher: WatcherServiceLike | undefined,
  onChange: () => void,
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!watcher) return undefined;
    let cancelled = false;
    let watcherId: string | null = null;
    const disposables: IDisposable[] = [];
    let timer: number | null = null;

    watcher
      .watch({ path: dirPath })
      .then(({ id }) => {
        if (cancelled) {
          void watcher.unwatch({ id });
          return;
        }
        watcherId = id;
        // 编译/重生成会连续写多个文件：600ms 防抖合并为一轮刷新。
        const sub = watcher.onDynamicChange(id)(() => {
          if (timer !== null) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            timer = null;
            onChangeRef.current();
          }, 600);
        });
        disposables.push(sub);
      })
      .catch(() => {
        // 监视失败不影响只读展示，用户仍可手动刷新。
      });

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      for (const disposable of disposables) disposable.dispose();
      if (watcherId) void watcher.unwatch({ id: watcherId });
    };
  }, [watcher, dirPath]);
}

function pickDefaultTex(files: readonly string[]): string | null {
  if (files.length === 0) return null;
  if (files.includes("paper/main.tex")) return "paper/main.tex";
  return files.find((file) => file.startsWith("paper/")) ?? files[0]!;
}

/** 读整份文件字节（带分块与上限），供 PDF/SyncTeX 预载。 */
async function readWholeFile(
  fileService: FileServiceLike,
  path: string,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const fileStat = await fileService.stat({ path });
  if (typeof fileStat.size !== "number" || fileStat.size > maxBytes) return null;
  let offset = 0;
  const chunks: Uint8Array[] = [];
  while (offset < fileStat.size) {
    const chunk = await fileService.readFileRange({
      path,
      offset,
      length: Math.min(512 * 1024, fileStat.size - offset),
    });
    if (chunk.length === 0) break;
    chunks.push(chunk);
    offset += chunk.length;
  }
  const whole = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    whole.set(chunk, cursor);
    cursor += chunk.length;
  }
  return whole;
}

// ── SyncTeX（子集解析：行 ↔ 页/纵位置） ──

interface SynctexRecord {
  page: number;
  lines: number[];
  y: number;
  h: number;
}

const SYNCTEX_RECORD_PATTERN = /^f((?:,\d+)+):([-\d.eE+]+):([-\d.eE+]+):([-\d.eE+]+):([-\d.eE+]+)/;
const SYNCTEX_PAGE_PATTERN = /^\{(\d+)/;

function parseSynctexRecords(text: string): SynctexRecord[] {
  const records: SynctexRecord[] = [];
  let page = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    const pageMatch = line.match(SYNCTEX_PAGE_PATTERN);
    if (pageMatch) {
      page = Number.parseInt(pageMatch[1]!, 10);
      continue;
    }
    if (!line.startsWith("f,")) continue;
    const match = line.match(SYNCTEX_RECORD_PATTERN);
    if (!match) continue;
    const lineNumbers = match[1]!
      .split(",")
      .slice(1)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));
    if (lineNumbers.length === 0) continue;
    records.push({
      page,
      lines: lineNumbers,
      y: Number.parseFloat(match[3]!),
      h: Number.parseFloat(match[5]!),
    });
  }
  return records;
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const streamCtor = (
    globalThis as unknown as {
      DecompressionStream?: new (format: "gzip") => ReadableWritablePair;
    }
  ).DecompressionStream;
  if (!streamCtor) {
    throw new Error("DecompressionStream unsupported");
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new streamCtor("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buffer);
}

/** 前向：源码行 → 最近记录（含该行，否则 ≤ 该行的最大行记录）。 */
function findForwardRecord(records: SynctexRecord[], line: number): SynctexRecord | null {
  let exact: SynctexRecord | null = null;
  let nearestBelow: SynctexRecord | null = null;
  let nearestBelowMaxLine = -1;
  for (const record of records) {
    if (record.lines.includes(line)) {
      exact = record;
      break;
    }
    let maxLine = -1;
    for (const value of record.lines) {
      if (value > maxLine) maxLine = value;
    }
    if (maxLine <= line && maxLine > nearestBelowMaxLine) {
      nearestBelowMaxLine = maxLine;
      nearestBelow = record;
    }
  }
  return exact ?? nearestBelow;
}

/** 反向：页 + 归一化纵坐标 → 最近记录。y 范围用该页记录的 min/max 近似。 */
function findInverseRecord(
  records: SynctexRecord[],
  page: number,
  yRatio: number,
): SynctexRecord | null {
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const record of records) {
    if (record.page !== page) continue;
    if (record.y < yMin) yMin = record.y;
    if (record.y + record.h > yMax) yMax = record.y + record.h;
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return null;
  const targetY = yMin + yRatio * (yMax - yMin);
  let best: SynctexRecord | null = null;
  let bestDistance = Infinity;
  for (const record of records) {
    if (record.page !== page) continue;
    const distance = Math.abs(record.y - targetY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = record;
    }
  }
  return best;
}

/**
 * 科研工作台（ClawsGO 形态：顶栏 + 左侧导航 + 文件树 + 大内容区；视觉沿用 ZCode）。
 * 右侧面板形态：与对话同屏共写；onBack 仅整页嵌入时提供。
 */
export function ResearchWorkbench({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  activeTaskId = null,
  onSelectTask,
  onBack,
}: {
  workspacePath: string;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
  /** 当前 workspace 激活会话；操作台按钮据此决定发到本会话还是新建会话。 */
  activeTaskId?: string | null;
  /** 草稿态新建会话后的导航回调（参数对齐 handleSelectTaskInChat）。 */
  onSelectTask?: (
    workspacePath: string,
    taskId: string,
    workspaceIdentity?: string,
    remoteSessionId?: string,
  ) => void;
  onBack?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const { fileService, fileWatcherService } = useWorkspaceServices(
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
  );
  const launcher = useResearchCommandLauncher({
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    activeTaskId,
    onSelectTask,
  });
  const activePlan = useActiveTaskPlan({
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
    activeTaskId,
  });
  const [section, setSection] = useState<ResearchSection>("overview");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 文件树点击 .tex → 切到 LaTeX 页并切换目标（由 LatexWorkbench 消费后清空）。
  const [pendingTexRel, setPendingTexRel] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ path: string; name: string } | null>(null);
  // 文件树点击代码文件 → 「代码」栏内用官方 PreviewPane 打开；点 × 关闭。
  const [previewSource, setPreviewSource] = useState<CodeViewerSource | null>(null);

  const copyPrompt = useCallback(async (prompt: string, doneLabel: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setToast(doneLabel);
      setError(null);
    } catch {
      setError(prompt);
    }
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-card-border bg-card px-4 py-2.5">
        {onBack ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-ui-sm"
              onClick={onBack}
            >
              <ArrowLeftIcon className="size-3.5" strokeWidth={1.33} />
              {intl.formatMessage({ id: "research.backToChat" })}
            </Button>
            <div className="h-4 w-px bg-border" aria-hidden />
          </>
        ) : null}
        <FlaskConicalIcon className="size-4 text-primary" strokeWidth={1.33} />
        <h1 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "research.title" })}
        </h1>
        <span
          className="ml-auto max-w-[40%] truncate text-ui-sm text-foreground-subtlest"
          title={workspacePath}
        >
          {workspacePath}
        </span>
      </header>
      {error ? (
        <div className="shrink-0 border-b border-card-border bg-destructive/10 px-4 py-2 text-ui-sm break-all text-destructive">
          {error}
        </div>
      ) : null}
      {toast ? (
        <div className="shrink-0 border-b border-card-border bg-primary/10 px-4 py-2 text-ui-sm text-primary">
          {toast}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-60 shrink-0 flex-col border-r border-card-border bg-sidebar/40">
          <nav className="flex flex-col gap-0.5 p-2">
            {SECTIONS.map(({ id, icon: SectionIcon, labelId }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-ui-sm transition-colors",
                  section === id
                    ? "bg-hover font-medium text-foreground"
                    : "text-foreground-subtle hover:bg-hover hover:text-foreground",
                )}
                aria-current={section === id ? "page" : undefined}
              >
                <SectionIcon
                  className={cn(
                    "size-4 shrink-0",
                    section === id ? "text-primary" : "text-foreground-subtlest",
                  )}
                  strokeWidth={1.33}
                />
                {intl.formatMessage({ id: labelId })}
              </button>
            ))}
          </nav>
          <div className="mx-2 border-t border-card-border" aria-hidden />
          <div className="px-3 pt-2 pb-1 text-ui-sm font-medium text-foreground-subtlest">
            {intl.formatMessage({ id: "research.files.title" })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            <FileTree
              workspacePath={workspacePath}
              fileService={fileService}
              watcher={fileWatcherService}
              onOpenFile={(path, name) => {
                const extension = fileExtension(name);
                if (extension === "tex") {
                  setPendingTexRel(path.slice(workspacePath.length + 1));
                  setSection("latex");
                  return;
                }
                // 仅在「代码」栏激活时，文件树的代码文件点击才打开查看；其余栏目不反应。
                if (section === "code" && CODE_LANGUAGE_BY_EXTENSION[extension]) {
                  setPreviewSource({
                    type: "file",
                    title: name,
                    path,
                    workspacePath,
                    workspaceIdentity: workspaceIdentity ?? undefined,
                    workspaceRemoteSessionId: remoteSessionId ?? undefined,
                  });
                }
              }}
            />
          </div>
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          {section === "overview" ? (
            <OverviewPane
              workspacePath={workspacePath}
              activeTaskId={activeTaskId}
              activePlan={activePlan}
              launcher={launcher}
              onNavigate={setSection}
              onToast={setToast}
              onError={setError}
            />
          ) : section === "progress" ? (
            <ProgressPane
              workspacePath={workspacePath}
              activeTaskId={activeTaskId}
              activePlan={activePlan}
              fileService={fileService}
              watcher={fileWatcherService}
              onError={setError}
              onOpenActions={() => setSection("overview")}
            />
          ) : section === "bench" ? (
            <BenchBoard
              workspacePath={workspacePath}
              fileService={fileService}
              watcher={fileWatcherService}
              onError={setError}
              copyPrompt={copyPrompt}
            />
          ) : section === "code" ? (
            <PreviewPane
              source={previewSource}
              onClose={() => setPreviewSource(null)}
              workspacePath={workspacePath}
            />
          ) : section === "latex" ? (
            <LatexWorkbench
              workspacePath={workspacePath}
              fileService={fileService}
              watcher={fileWatcherService}
              pendingTexRel={pendingTexRel}
              onPendingTexConsumed={() => setPendingTexRel(null)}
              onError={setError}
              copyPrompt={copyPrompt}
            />
          ) : section === "figures" ? (
            <FiguresGallery
              workspacePath={workspacePath}
              fileService={fileService}
              watcher={fileWatcherService}
              onError={setError}
              copyPrompt={copyPrompt}
            />
          ) : section === "experiments" ? (
            <ExperimentsList
              workspacePath={workspacePath}
              fileService={fileService}
              watcher={fileWatcherService}
              onError={setError}
            />
          ) : section === "literature" ? (
            <LiteratureLibrary
              workspacePath={workspacePath}
              fileService={fileService}
              watcher={fileWatcherService}
              onError={setError}
              copyPrompt={copyPrompt}
              onOpenViewer={(path, name) => setViewer({ path, name })}
            />
          ) : (
            <DeliverablesCenter
              workspacePath={workspacePath}
              fileService={fileService}
              watcher={fileWatcherService}
              onError={setError}
              copyPrompt={copyPrompt}
            />
          )}
        </div>
      </div>
      {viewer ? (
        <OverlayFileViewer
          path={viewer.path}
          name={viewer.name}
          fileService={fileService}
          onClose={() => setViewer(null)}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

// ── 总览页（操作台：链路命令按钮化 + 当前进度摘要 + 快捷入口） ──

function OverviewPane({
  workspacePath,
  activeTaskId,
  activePlan,
  launcher,
  onNavigate,
  onToast,
  onError,
}: {
  workspacePath: string;
  activeTaskId: string | null;
  activePlan: ReturnType<typeof useActiveTaskPlan>;
  launcher: UseResearchCommandLauncherResult;
  onNavigate: (section: ResearchSection) => void;
  onToast: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const { intl } = useZCodeIntl();
  const [args, setArgs] = useState<Record<string, string>>({});
  // 展开参数输入区的动作 id；无参动作点击即跑，不展开。
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const projectName = workspacePath.split("/").filter(Boolean).pop() ?? workspacePath;

  const runChain = useCallback(
    (action: ChainActionDef) => {
      const arg = args[action.id]?.trim() ?? "";
      if (action.arg?.required && !arg) {
        onError(intl.formatMessage({ id: "research.actions.argRequired" }));
        return;
      }
      const text = arg ? `${action.command} ${arg}` : action.command;
      void launcher.run(text).then((result) => {
        if (result.ok) {
          onError(null);
          setExpandedId(null);
          onToast(
            activeTaskId
              ? intl.formatMessage({ id: "research.actions.sentToSession" })
              : intl.formatMessage({ id: "research.actions.startedNewSession" }),
          );
        } else {
          onToast(null);
          onError(
            intl.formatMessage(
              { id: "research.actions.launchFailed" },
              { reason: result.error.code },
            ),
          );
        }
      });
    },
    [activeTaskId, args, intl, launcher, onError, onToast],
  );

  const handleActionClick = useCallback(
    (action: ChainActionDef) => {
      if (action.arg) {
        setExpandedId((current) => (current === action.id ? null : (action.id ?? null)));
      } else {
        runChain(action);
      }
    },
    [runChain],
  );

  const planItems = activePlan.plan?.items ?? [];
  const planCompleted = planItems.filter((item) => item.status === "completed").length;
  const planCurrent = planItems.find((item) => item.status === "inProgress") ?? null;

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-8 pt-5">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-ui-xl font-semibold text-foreground">{projectName}</h1>
        <p className="mt-1 text-ui-sm text-foreground-subtle">
          {intl.formatMessage(
            { id: "research.actions.hint" },
            {
              target: activeTaskId
                ? intl.formatMessage({ id: "research.actions.targetSession" })
                : intl.formatMessage({ id: "research.actions.targetNew" }),
            },
          )}
        </p>

        {/* 进行中的链路/步骤横幅（官方 KeepAwakeNotice 同款 bg-surface 圆角条）。 */}
        {planItems.length > 0 ? (
          <button
            type="button"
            className="mt-4 flex w-full min-h-11 items-center gap-3 overflow-hidden rounded-[10px] bg-surface px-3 py-2.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
            onClick={() => onNavigate("progress")}
          >
            <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
              <ArrowRightIcon className="size-4 text-foreground" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-ui-base font-medium leading-5 text-foreground">
                  {intl.formatMessage({ id: "research.progress.liveTitle" })}
                </span>
                <span
                  className={cn(
                    "text-ui-sm tabular-nums",
                    planCompleted >= planItems.length
                      ? "text-success"
                      : "text-foreground-subtle",
                  )}
                >
                  {planCompleted}/{planItems.length}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-ui-sm text-foreground-subtle">
                {planCurrent?.content ?? planItems[planItems.length - 1]!.content}
              </span>
            </span>
            <ChevronRightIcon
              className="size-4 shrink-0 text-foreground-subtlest"
              aria-hidden
            />
          </button>
        ) : null}

        {launcher.error ? (
          <div
            role="alert"
            className="mt-4 flex items-center gap-2 rounded-[10px] bg-surface px-3 py-3 text-ui-base leading-5 text-destructive"
          >
            <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
              <TriangleAlertIcon className="size-4" strokeWidth={1.33} />
            </span>
            <p className="min-w-0 flex-1">
              {intl.formatMessage(
                { id: "research.actions.launchFailed" },
                { reason: launcher.error.code },
              )}
            </p>
          </div>
        ) : null}

        <div className="mt-6">
          <SettingsResourceGroupHeader
            title={intl.formatMessage({ id: "research.actions.title" })}
            count={CHAIN_ACTIONS.length}
          />
          <SettingsResourceList
            items={CHAIN_ACTIONS}
            getKey={(action) => action.id}
            renderItem={(action) => (
              <ChainActionRow
                action={action}
                argValue={args[action.id] ?? ""}
                expanded={expandedId === action.id}
                pending={launcher.pending}
                onArgChange={(value) =>
                  setArgs((current) => ({ ...current, [action.id]: value }))
                }
                onToggle={() => handleActionClick(action)}
                onRun={() => runChain(action)}
              />
            )}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * 操作台行：官方设置资源行同构（size-9 图标块 + 标题/描述 + 右侧徽章）。
 * 无参动作整行点击即运行；带参动作点击展开行内参数区（Input + 运行按钮）。
 */
function ChainActionRow({
  action,
  argValue,
  expanded,
  pending,
  onArgChange,
  onToggle,
  onRun,
}: {
  action: ChainActionDef;
  argValue: string;
  expanded: boolean;
  pending: boolean;
  onArgChange: (value: string) => void;
  onToggle: () => void;
  onRun: () => void;
}) {
  const { intl } = useZCodeIntl();
  const title = intl.formatMessage({ id: action.titleId });
  const ActionIcon = action.icon;
  return (
    <div>
      <button
        type="button"
        aria-expanded={action.arg ? expanded : undefined}
        className="grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-input-border-focused"
        onClick={onToggle}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-foreground-subtle">
          <ActionIcon className="size-4" strokeWidth={1.33} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-ui-base font-medium text-foreground">{title}</span>
            <span className="inline-flex min-h-5 shrink-0 items-center rounded-md bg-background px-1.5 py-0.5 text-ui-sm text-foreground-subtle ring-1 ring-border">
              {action.command}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: action.descId })}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {action.arg ? (
            <ChevronDownIcon
              className={cn(
                "size-4 text-foreground-subtlest transition-transform",
                expanded && "rotate-180",
              )}
              strokeWidth={1.33}
              aria-hidden
            />
          ) : (
            <PlayIcon className="size-4 text-foreground-subtlest" strokeWidth={1.33} aria-hidden />
          )}
        </span>
      </button>
      {action.arg && expanded ? (
        <div className="flex items-center gap-2 px-4 pb-3 pl-16">
          <Input
            value={argValue}
            onChange={(event) => onArgChange(event.target.value)}
            placeholder={intl.formatMessage({ id: action.arg.placeholderId })}
            className="h-8 min-w-0 flex-1 text-ui-sm"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onRun();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 gap-1.5 px-2.5 text-ui-sm"
            disabled={pending || (Boolean(action.arg?.required) && !argValue.trim())}
            onClick={onRun}
          >
            {pending ? (
              <LoaderIcon
                className="size-3.5 animate-spin motion-reduce:animate-none"
                strokeWidth={1.33}
              />
            ) : (
              <PlayIcon className="size-3.5" strokeWidth={1.33} />
            )}
            {intl.formatMessage({ id: "research.actions.run" })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── 进度页（实时会话步骤 + 链路运行状态） ──

interface ChainRunStep {
  id: string;
  title: string;
  status: "pending" | "inProgress" | "completed" | "failed" | "skipped";
  at?: string;
}

interface ChainRun {
  chain: string;
  title: string;
  status: "running" | "done" | "failed" | "paused";
  startedAt?: string;
  updatedAt?: string;
  steps: ChainRunStep[];
  file: string;
}

function normalizeChainStepStatus(value: unknown): ChainRunStep["status"] {
  const text = typeof value === "string" ? value.replace(/[-\s]/g, "").toLowerCase() : "";
  if (text === "completed" || text === "done") return "completed";
  if (text === "inprogress" || text === "running") return "inProgress";
  if (text === "failed" || text === "error") return "failed";
  if (text === "skipped") return "skipped";
  return "pending";
}

function parseChainRunFile(content: string, file: string): ChainRun | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const chain = typeof record.chain === "string" ? record.chain : "";
  if (!chain) return null;
  const rawSteps = Array.isArray(record.steps) ? record.steps : [];
  const steps: ChainRunStep[] = rawSteps.flatMap((rawStep, index) => {
    if (typeof rawStep !== "object" || rawStep === null) return [];
    const step = rawStep as Record<string, unknown>;
    const title =
      typeof step.title === "string" && step.title.trim()
        ? step.title.trim()
        : typeof step.name === "string" && step.name.trim()
          ? step.name.trim()
          : `#${index + 1}`;
    return [
      {
        id: typeof step.id === "string" ? step.id : `step-${index}`,
        title,
        status: normalizeChainStepStatus(step.status),
        ...(typeof step.at === "string" ? { at: step.at } : {}),
      },
    ];
  });
  const statusText =
    typeof record.status === "string" ? record.status.replace(/[-\s]/g, "").toLowerCase() : "";
  const status: ChainRun["status"] =
    statusText === "done" || statusText === "completed"
      ? "done"
      : statusText === "failed"
        ? "failed"
        : statusText === "paused"
          ? "paused"
          : "running";
  return {
    chain,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : chain,
    status,
    ...(typeof record.startedAt === "string" ? { startedAt: record.startedAt } : {}),
    ...(typeof record.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}),
    steps,
    file,
  };
}

function formatProgressTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const CHAIN_RUN_STATUS_META: Record<
  ChainRun["status"],
  { labelId: string; icon: () => React.ReactNode; labelClassName: string }
> = {
  running: {
    labelId: "research.progress.chain.running",
    icon: () => (
      <LoaderIcon
        className="size-4 animate-spin text-foreground motion-reduce:animate-none"
        strokeWidth={1.33}
        aria-hidden
      />
    ),
    labelClassName: "text-foreground-subtle",
  },
  done: {
    labelId: "research.progress.chain.done",
    icon: () => (
      <CheckCircle2Icon className="size-4 text-success" strokeWidth={1.33} aria-hidden />
    ),
    labelClassName: "text-success",
  },
  failed: {
    labelId: "research.progress.chain.failed",
    icon: () => (
      <TriangleAlertIcon className="size-4 text-destructive" strokeWidth={1.33} aria-hidden />
    ),
    labelClassName: "text-destructive",
  },
  paused: {
    labelId: "research.progress.chain.paused",
    icon: () => (
      <CircleIcon className="size-4 text-foreground-subtlest" strokeWidth={1.33} aria-hidden />
    ),
    labelClassName: "text-foreground-subtle",
  },
};

/** 步骤行图标对齐官方 PlanStatusIcon：完成=success 勾、进行中=foreground 箭头、待办=subtlest 空心圆。 */
function StepStatusIcon({ status }: { status: ChainRunStep["status"] }) {
  if (status === "completed") {
    return <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />;
  }
  if (status === "inProgress") {
    return <ArrowRightIcon className="mt-0.5 size-3.5 shrink-0 text-foreground" aria-hidden />;
  }
  if (status === "failed") {
    return <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />;
  }
  return <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-foreground-subtlest" aria-hidden />;
}

function ProgressPane({
  workspacePath,
  activeTaskId,
  activePlan,
  fileService,
  watcher,
  onError,
  onOpenActions,
}: {
  workspacePath: string;
  activeTaskId: string | null;
  activePlan: ReturnType<typeof useActiveTaskPlan>;
  fileService: FileServiceLike;
  watcher: WatcherServiceLike | undefined;
  onError: (message: string | null) => void;
  onOpenActions: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [chainRuns, setChainRuns] = useState<ChainRun[]>([]);
  const [scanned, setScanned] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const scanRuns = useCallback(() => {
    let disposed = false;
    void (async () => {
      const runs: ChainRun[] = [];
      try {
        const entries = await fileService.readdir({
          path: joinPath(workspacePath, PROGRESS_DIR),
        });
        for (const entry of entries) {
          if (entry.type !== "file" || fileExtension(entry.name) !== "json") continue;
          try {
            const slice = await fileService.readTextFile({ path: entry.path, length: 256 * 1024 });
            if (slice.isBinary) continue;
            const run = parseChainRunFile(slice.content, entry.path);
            if (run) runs.push(run);
          } catch {
            // 单个状态文件损坏不阻断整体。
          }
        }
      } catch {
        // 目录不存在：还没有链路跑过。
      }
      if (!disposed) {
        setChainRuns(runs);
        setScanned(true);
      }
    })().catch((scanError: unknown) => {
      if (!disposed) {
        onError(scanError instanceof Error ? scanError.message : String(scanError));
      }
    });
    return () => {
      disposed = true;
    };
  }, [fileService, workspacePath, onError]);

  useEffect(() => {
    onError(null);
    return scanRuns();
  }, [onError, scanRuns, reloadKey]);

  useDirChangeWatcher(
    joinPath(workspacePath, PROGRESS_DIR),
    watcher,
    useCallback(() => setReloadKey((key) => key + 1), []),
  );

  // 链路状态文件按步骤更新可能连续重写；watcher 防抖之外再加低频轮询兜底。
  useEffect(() => {
    const timer = window.setInterval(() => setReloadKey((key) => key + 1), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const planItems = activePlan.plan?.items ?? [];
  const planCompleted = planItems.filter((item) => item.status === "completed").length;
  const sortedRuns = useMemo(
    () =>
      [...chainRuns].sort((a, b) =>
        (b.updatedAt ?? b.startedAt ?? "").localeCompare(a.updatedAt ?? a.startedAt ?? ""),
      ),
    [chainRuns],
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-8 pt-5">
      <div className="mx-auto w-full max-w-3xl">
        {/* 实时会话步骤（TodoWrite 投影）：官方状态面板行样式 + 设置页列表容器。 */}
        <SettingsResourceGroupHeader
          title={intl.formatMessage({ id: "research.progress.liveTitle" })}
          count={planItems.length}
          actions={
            planItems.length > 0 ? (
              <span
                className={cn(
                  "text-ui-sm tabular-nums",
                  planCompleted >= planItems.length ? "text-success" : "text-foreground-subtle",
                )}
              >
                {planCompleted}/{planItems.length}
              </span>
            ) : undefined
          }
        />
        {planItems.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            <Progress
              value={Math.round((planCompleted / planItems.length) * 100)}
              className="h-1"
            />
            <SettingsResourceList
              items={planItems}
              getKey={(item) => item.id}
              renderItem={(item) => (
                <div className="flex min-h-8 items-start gap-2.5 px-4 py-2.5 text-ui-base">
                  <StepStatusIcon status={item.status} />
                  <span
                    title={item.content}
                    className={cn(
                      "line-clamp-2 min-w-0 flex-1 break-words leading-5",
                      item.status === "completed"
                        ? "text-foreground-subtlest line-through"
                        : "text-foreground",
                    )}
                  >
                    {item.content}
                  </span>
                </div>
              )}
            />
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-center rounded-xl border border-dashed border-card-border bg-background px-4 py-6 text-center text-ui-base text-foreground-subtle">
            {activeTaskId
              ? intl.formatMessage({ id: "research.progress.liveEmptySession" })
              : intl.formatMessage({ id: "research.progress.liveEmptyNoSession" })}
          </div>
        )}

        {/* 链路运行状态（.research/progress/*.json） */}
        <div className="mt-6">
          <SettingsResourceGroupHeader
            title={intl.formatMessage({ id: "research.progress.chainTitle" })}
            count={sortedRuns.length}
          />
          {sortedRuns.length > 0 ? (
            <div className="mt-2 flex flex-col gap-3">
              {sortedRuns.map((run) => {
                const statusMeta = CHAIN_RUN_STATUS_META[run.status];
                const doneCount = run.steps.filter(
                  (step) => step.status === "completed" || step.status === "skipped",
                ).length;
                return (
                  <div key={run.file} className="overflow-hidden rounded-xl bg-surface">
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-foreground-subtle">
                        <WorkflowIcon className="size-4" strokeWidth={1.33} aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-ui-base font-medium text-foreground">
                          {run.title}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 flex items-center gap-1 text-ui-sm font-normal",
                            statusMeta.labelClassName,
                          )}
                        >
                          {statusMeta.icon()}
                          {intl.formatMessage({ id: statusMeta.labelId })}
                          <span className="text-foreground-subtlest">
                            ·
                            {intl.formatMessage(
                              { id: "research.progress.chainCount" },
                              { done: doneCount, total: run.steps.length },
                            )}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-ui-sm tabular-nums text-foreground-subtlest">
                        {formatProgressTime(run.updatedAt ?? run.startedAt)}
                      </span>
                    </div>
                    {run.steps.length > 0 ? (
                      <div>
                        {run.steps.map((step, index) => (
                          <div key={step.id}>
                            {index > 0 ? (
                              <div className="h-px bg-border/50" aria-hidden />
                            ) : null}
                            <div className="flex min-h-8 items-start gap-2.5 px-4 py-2.5 text-ui-base">
                              <StepStatusIcon status={step.status} />
                              <span
                                className={cn(
                                  "line-clamp-2 min-w-0 flex-1 break-words leading-5",
                                  step.status === "completed"
                                    ? "text-foreground-subtlest line-through"
                                    : "text-foreground",
                                )}
                              >
                                {step.title}
                              </span>
                              {step.at ? (
                                <span className="shrink-0 text-ui-sm tabular-nums text-foreground-subtlest">
                                  {formatProgressTime(step.at)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-center rounded-xl border border-dashed border-card-border bg-background px-4 py-6 text-center text-ui-base text-foreground-subtle">
              {scanned
                ? intl.formatMessage({ id: "research.progress.chainEmpty" })
                : intl.formatMessage({ id: "research.loading" })}
            </div>
          )}
        </div>
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-ui-sm"
            onClick={onOpenActions}
          >
            <RocketIcon className="size-3.5" strokeWidth={1.33} />
            {intl.formatMessage({ id: "research.progress.openActions" })}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── 文件树（左栏下方，IDE 式懒加载） ──

const TREE_IGNORED_DIRS = new Set([
  "node_modules",
  "__pycache__",
  "build",
  "install",
  "log",
  "dist",
  "out",
  "target",
]);

function FileTree({
  workspacePath,
  fileService,
  watcher,
  onOpenFile,
}: {
  workspacePath: string;
  fileService: FileServiceLike;
  watcher: WatcherServiceLike | undefined;
  onOpenFile: (path: string, name: string) => void;
}) {
  const [children, setChildren] = useState<Record<string, FileEntry[] | null>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);

  const loadDir = useCallback(
    async (dirPath: string) => {
      setChildren((current) => ({ ...current, [dirPath]: null }));
      try {
        const entries = await fileService.readdir({ path: dirPath });
        const visible = entries
          .filter(
            (entry) =>
              !entry.name.startsWith(".") &&
              !(entry.type === "directory" && TREE_IGNORED_DIRS.has(entry.name)),
          )
          .sort((left, right) => {
            if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
            return left.name.localeCompare(right.name);
          });
        setChildren((current) => ({ ...current, [dirPath]: visible }));
      } catch {
        setChildren((current) => ({ ...current, [dirPath]: [] }));
      }
    },
    [fileService],
  );

  useEffect(() => {
    setChildren({});
    setExpanded(new Set());
    void loadDir(workspacePath);
  }, [workspacePath, loadDir, reloadKey]);

  useDirChangeWatcher(
    workspacePath,
    watcher,
    useCallback(() => setReloadKey((key) => key + 1), []),
  );

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
        }
        return next;
      });
      void loadDir(dirPath);
    },
    [loadDir],
  );

  const renderEntries = (dirPath: string, depth: number): React.ReactNode => {
    const entries = children[dirPath];
    if (entries == null) {
      return (
        <div
          key={`${dirPath}:loading`}
          className="py-0.5 text-ui-sm text-foreground-subtlest"
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          …
        </div>
      );
    }
    return entries.map((entry) => {
      const isDir = entry.type === "directory";
      const isOpen = expanded.has(entry.path);
      const descriptor = resolveFileDisplayDescriptor(entry.path);
      return (
        <div key={entry.path}>
          <button
            type="button"
            className="flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border border-transparent py-1 pr-2 text-left text-ui-base text-foreground transition-colors hover:bg-surface-hover"
            style={{ paddingLeft: `calc(${depth} * 0.75rem + 0.5rem)` }}
            onClick={() => {
              if (isDir) {
                toggleDir(entry.path);
              } else {
                onOpenFile(entry.path, entry.name);
              }
            }}
            title={entry.path}
          >
            {isDir ? (
              <ChevronRightIcon
                className={cn(
                  "size-3 shrink-0 text-foreground-subtlest transition-transform",
                  isOpen && "rotate-90",
                )}
                strokeWidth={1.33}
              />
            ) : null}
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {descriptor.fileIconSrc ? (
                <FileDisplayIcon src={descriptor.fileIconSrc} size={16} className="shrink-0" />
              ) : isDir ? (
                <FolderIcon className="size-4 shrink-0 text-foreground-subtle" strokeWidth={1.33} />
              ) : (
                <FileIcon
                  className="size-4 shrink-0 text-foreground-subtlest"
                  strokeWidth={1.33}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            </span>
          </button>
          {isDir && isOpen ? renderEntries(entry.path, depth + 1) : null}
        </div>
      );
    });
  };

  return <div>{renderEntries(workspacePath, 0)}</div>;
}

// ── 文件预览浮层（文件树点击图片/PDF/文本） ──

function OverlayFileViewer({
  path,
  name,
  fileService,
  onClose,
  onError,
}: {
  path: string;
  name: string;
  fileService: FileServiceLike;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const { intl } = useZCodeIntl();
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    setImageDataUrl(null);
    setText(null);
    setPdfBytes(null);
    setFailed(false);
    const extension = fileExtension(name);
    void (async () => {
      try {
        if (IMAGE_EXTENSIONS.has(extension)) {
          const preview = await fileService.readMediaPreview({ path, maxBytes: 4 * 1024 * 1024 });
          if (!disposed) {
            setImageDataUrl(`data:${preview.mediaType};base64,${preview.dataBase64}`);
          }
        } else if (extension === "pdf") {
          const whole = await readWholeFile(fileService, path, OVERLAY_PDF_MAX_BYTES);
          if (!disposed) {
            if (whole) setPdfBytes(whole);
            else setFailed(true);
          }
        } else {
          const slice = await fileService.readTextFile({ path, length: TEXT_PREVIEW_LIMIT_BYTES });
          if (!disposed) setText(slice.content);
        }
      } catch {
        if (!disposed) setFailed(true);
      }
    })().catch((loadError: unknown) => {
      if (!disposed) onError(loadError instanceof Error ? loadError.message : String(loadError));
    });
    return () => {
      disposed = true;
    };
  }, [path, name, fileService, onError]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background/95 backdrop-blur-sm">
      <div className="flex shrink-0 items-center gap-2 border-b border-card-border bg-card px-3 py-2">
        <FileIcon className="size-3.5 text-foreground-subtle" />
        <span className="truncate text-ui-sm font-medium" title={path}>
          {name}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 w-6 p-0"
          onClick={onClose}
          aria-label={intl.formatMessage({ id: "research.viewer.close" })}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {imageDataUrl ? (
          <img src={imageDataUrl} alt={name} className="mx-auto max-h-full object-contain" />
        ) : pdfBytes ? (
          <Suspense
            fallback={
              <div className="p-3 text-ui-sm text-foreground-subtlest">
                {intl.formatMessage({ id: "research.pdf.loading" })}
              </div>
            }
          >
            <PdfViewer source={pdfBytes} className="h-full" />
          </Suspense>
        ) : text != null ? (
          <pre className="font-mono text-ui-sm leading-relaxed whitespace-pre-wrap">{text}</pre>
        ) : failed ? (
          <div className="p-3 text-ui-sm text-foreground-subtlest">
            {intl.formatMessage({ id: "research.viewer.unsupported" })}
          </div>
        ) : (
          <div className="p-3 text-ui-sm text-foreground-subtlest">
            {intl.formatMessage({ id: "research.loading" })}
          </div>
        )}
      </div>
    </div>
  );
}

interface FileServiceLike {
  readdir(params: { path: string; includeHidden?: boolean }): Promise<FileEntry[]>;
  stat(params: {
    path: string;
  }): Promise<{ type?: "file" | "directory"; size?: number; mtimeMs?: number }>;
  readTextFile(params: {
    path: string;
    offset?: number;
    length?: number;
  }): Promise<{
    content: string;
    truncated: boolean;
    isBinary: boolean;
    totalBytes: number;
  }>;
  readMediaPreview(params: {
    path: string;
    maxBytes?: number;
  }): Promise<{ mediaType: string; dataBase64: string }>;
  readFileRange(params: { path: string; offset: number; length: number }): Promise<Uint8Array>;
}

type CopyPromptFn = (prompt: string, doneLabel: string) => Promise<void>;

// ── LaTeX 工作台（源码/PDF 并排 + SyncTeX 双向跳转） ──

function LatexWorkbench({
  workspacePath,
  fileService,
  watcher,
  pendingTexRel,
  onPendingTexConsumed,
  onError,
  copyPrompt,
}: {
  workspacePath: string;
  fileService: FileServiceLike;
  watcher: WatcherServiceLike | undefined;
  pendingTexRel: string | null;
  onPendingTexConsumed: () => void;
  onError: (message: string | null) => void;
  copyPrompt: CopyPromptFn;
}) {
  const { intl } = useZCodeIntl();
  const [texFiles, setTexFiles] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const [texRelPath, setTexRelPath] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [sourceMissing, setSourceMissing] = useState(false);
  const [pdfSource, setPdfSource] = useState<PdfViewerSource | null>(null);
  const [pdfMissing, setPdfMissing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [synctexRecords, setSynctexRecords] = useState<SynctexRecord[] | null>(null);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [targetPage, setTargetPage] = useState<number | undefined>(undefined);
  const sourceScrollRef = useRef<HTMLDivElement | null>(null);
  // 字号/主题/换行/行号全部跟随设置里的代码预览配置（与官方 PreviewPane 同源）。
  const theme = useZCodeStore((state) => state.theme);
  const codePreviewSettings = useZCodeStore((state) => state.codePreviewSettings);
  const resolvedCodeTheme =
    resolveTheme(theme) === "dark" ? codePreviewSettings.darkTheme : codePreviewSettings.lightTheme;

  const texAbsPath = texRelPath ? joinPath(workspacePath, texRelPath) : null;
  const pdfAbsPath = texAbsPath ? texAbsPath.replace(/\.tex$/, ".pdf") : null;
  const texDir = texAbsPath ? texAbsPath.slice(0, texAbsPath.lastIndexOf("/")) : workspacePath;

  // 自动发现 .tex：paper/ 优先（含一层子目录），docs/ 次之，根目录兜底；paper 命中即止。
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const found: string[] = [];
      const roots: Array<{ rel: string; depth: number }> = [
        { rel: "paper", depth: 1 },
        { rel: "docs", depth: 1 },
        { rel: ".", depth: 0 },
      ];
      for (const { rel, depth } of roots) {
        const rootAbs = joinPath(workspacePath, rel);
        let entries: FileEntry[];
        try {
          entries = await fileService.readdir({ path: rootAbs });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (entry.type === "file" && fileExtension(entry.name) === "tex") {
            found.push(rel === "." ? entry.name : `${rel}/${entry.name}`);
          } else if (entry.type === "directory" && depth > 0) {
            let subEntries: FileEntry[];
            try {
              subEntries = await fileService.readdir({ path: entry.path });
            } catch {
              continue;
            }
            for (const subEntry of subEntries) {
              if (subEntry.type === "file" && fileExtension(subEntry.name) === "tex") {
                found.push(`${rel}/${entry.name}/${subEntry.name}`);
              }
            }
          }
        }
        if (found.length > 0 && rel === "paper") break;
      }
      if (disposed) return;
      setTexFiles(found);
      setDiscovered(true);
      setTexRelPath((current) => current ?? pickDefaultTex(found));
    })().catch(() => {
      if (!disposed) setDiscovered(true);
    });
    return () => {
      disposed = true;
    };
  }, [workspacePath, fileService]);

  // 文件树指路：切目标并并入下拉选项。
  useEffect(() => {
    if (!pendingTexRel) return;
    setTexFiles((current) =>
      current.includes(pendingTexRel) ? current : [...current, pendingTexRel],
    );
    setTexRelPath(pendingTexRel);
    onPendingTexConsumed();
  }, [pendingTexRel, onPendingTexConsumed]);

  // agent 在对话侧编译/改稿后，源码与 PDF 自动刷新。
  useDirChangeWatcher(texDir, watcher, useCallback(() => setReloadKey((key) => key + 1), []));

  useEffect(() => {
    if (!texAbsPath || !pdfAbsPath) return undefined;
    let disposed = false;
    onError(null);
    setSource(null);
    setSourceMissing(false);
    setPdfSource(null);
    setPdfMissing(false);
    setSynctexRecords(null);
    setActiveLine(null);

    void (async () => {
      try {
        const text = await fileService.readTextFile({
          path: texAbsPath,
          length: TEX_SOURCE_LIMIT_BYTES,
        });
        if (disposed) return;
        setSource(text.content);
      } catch {
        if (!disposed) setSourceMissing(true);
      }

      try {
        const fileStat = await fileService.stat({ path: pdfAbsPath });
        if (disposed) return;
        if (typeof fileStat.size !== "number") {
          setPdfMissing(true);
          return;
        }
        if (fileStat.size <= PDF_FULL_READ_MAX_BYTES) {
          const whole = await readWholeFile(fileService, pdfAbsPath, PDF_FULL_READ_MAX_BYTES);
          if (whole && !disposed) setPdfSource(whole);
        } else {
          setPdfSource({
            totalBytes: fileStat.size,
            requestRange: (offset, length) =>
              fileService.readFileRange({ path: pdfAbsPath, offset, length }),
          });
        }
      } catch {
        if (!disposed) setPdfMissing(true);
      }

      // SyncTeX：编译带 -synctex=1 时与 PDF 同目录出现 main.synctex.gz。
      try {
        const synctexBytes = await readWholeFile(
          fileService,
          `${pdfAbsPath}.synctex.gz`,
          SYNCTEX_MAX_BYTES,
        );
        if (!synctexBytes || disposed) return;
        const synctexText = await gunzip(synctexBytes);
        if (disposed) return;
        setSynctexRecords(parseSynctexRecords(synctexText));
      } catch {
        // 没有 synctex 文件：双向跳转静默关闭。
      }
    })().catch((loadError: unknown) => {
      if (!disposed) onError(loadError instanceof Error ? loadError.message : String(loadError));
    });

    return () => {
      disposed = true;
    };
  }, [fileService, texAbsPath, pdfAbsPath, reloadKey, onError]);

  const pdfLabels: Partial<PdfViewerLabels> = {
    loading: intl.formatMessage({ id: "research.pdf.loading" }),
    loadError: intl.formatMessage({ id: "research.pdf.error" }),
  };

  // 前向跳转：点源码行 → PDF 翻到对应页。
  const handleLineClick = useCallback(
    (line: number) => {
      setActiveLine(line);
      if (!synctexRecords) return;
      const record = findForwardRecord(synctexRecords, line);
      if (record) setTargetPage(record.page);
    },
    [synctexRecords],
  );

  // 反向跳转：点 PDF 页面 → 源码滚动并高亮对应行（CodeViewer 行元素查找）。
  const handlePdfPageClick = useCallback(
    (page: number, _xRatio: number, yRatio: number) => {
      if (!synctexRecords) return;
      const record = findInverseRecord(synctexRecords, page, yRatio);
      if (!record) return;
      const line = record.lines[0] ?? null;
      if (line == null) return;
      setActiveLine(line);
      const scrollRoot = sourceScrollRef.current;
      if (scrollRoot) {
        findCodeViewerLineElement(scrollRoot, line)?.scrollIntoView({ block: "center" });
      }
    },
    [synctexRecords],
  );

  if (discovered && texFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md text-center text-ui-sm leading-5 text-foreground-subtlest">
          {intl.formatMessage({ id: "research.latex.noFiles" })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
        <Select value={texRelPath ?? undefined} onValueChange={(value) => setTexRelPath(value)}>
          <SelectTrigger
            size="lg"
            className="w-72 text-ui-sm"
            aria-label={intl.formatMessage({ id: "research.latex.pathLabel" })}
          >
            <SelectValue placeholder={intl.formatMessage({ id: "research.loading" })} />
          </SelectTrigger>
          <SelectContent>
            {texFiles.map((file) => (
              <SelectItem key={file} value={file} className="text-ui-sm">
                {file}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 px-2.5 text-ui-sm"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" strokeWidth={1.33} />
          {intl.formatMessage({ id: "research.latex.reload" })}
        </Button>
        <Button
          size="sm"
          className="h-8 shrink-0 px-2.5 text-ui-sm"
          disabled={!texRelPath}
          onClick={() =>
            void copyPrompt(
              intl.formatMessage({ id: "research.latex.compilePrompt" }, { path: texRelPath ?? "" }),
              intl.formatMessage({ id: "research.promptCopied" }),
            )
          }
        >
          <ClipboardCopyIcon className="size-3.5" strokeWidth={1.33} />
          {intl.formatMessage({ id: "research.latex.compile" })}
        </Button>
        <span
          className="ml-auto text-ui-sm text-foreground-subtle"
          title={synctexRecords ? undefined : intl.formatMessage({ id: "research.synctex.missing" })}
        >
          {synctexRecords
            ? intl.formatMessage({ id: "research.synctex.ready" })
            : intl.formatMessage({ id: "research.synctex.missingShort" })}
        </span>
      </div>
      {/* 源码/PDF 用 ZCode Resizable 分栏：默认 4:6 偏向 PDF，源码可压到 20%。 */}
      <ResizablePanelGroup
        layoutId="research-latex-split"
        panelIds={["research-latex-source", "research-latex-pdf"]}
        className="min-h-0 flex-1 px-4 pb-4"
      >
        <ResizablePanel id="research-latex-source" minSize="20%" defaultSize="40%">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-card-border bg-card">
          <div className="border-b border-card-border px-3 py-1.5 text-ui-sm text-foreground-subtle">
            {texRelPath}
          </div>
          {/* 源码区：ZCode CodeViewer（latex 语法高亮 + 行号）；行点击经委托走 SyncTeX 正向跳转。 */}
          <div
            className="min-h-0 flex-1 overflow-hidden"
            onClick={(event) => {
              const lineElement = (event.target as HTMLElement).closest<HTMLElement>("[data-line]");
              const line = Number.parseInt(lineElement?.getAttribute("data-line") ?? "", 10);
              if (Number.isInteger(line) && line >= 1) {
                handleLineClick(line);
              }
            }}
          >
            {sourceMissing ? (
              <div className="p-3 text-ui-sm text-foreground-subtlest">
                {intl.formatMessage({ id: "research.latex.sourceMissing" })}
              </div>
            ) : source != null ? (
              <CodeViewer
                code={source}
                language="latex"
                enableSyntaxHighlighting
                theme={resolvedCodeTheme}
                showLineNumbers={codePreviewSettings.showLineNumbers}
                wrapLongLines={codePreviewSettings.wrapLongLines}
                fontSizePx={codePreviewSettings.fontSizePx}
                className="h-full"
                markedLines={activeLine != null ? [activeLine] : undefined}
                scrollContainerRef={sourceScrollRef}
              />
            ) : (
              <div className="flex items-center gap-2 p-3 text-ui-sm text-foreground-subtlest">
                <Spinner className="size-3.5" />
                {intl.formatMessage({ id: "research.loading" })}
              </div>
            )}
          </div>
        </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="research-latex-pdf" minSize="30%">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-card-border bg-card">
          <div className="flex items-center gap-2 border-b border-card-border px-3 py-1.5 text-ui-sm text-foreground-subtle">
            <span>
              {pdfAbsPath === texAbsPath ? `${texRelPath}.pdf` : pdfAbsPath?.split("/").pop()}
            </span>
            <span className="ml-auto">{intl.formatMessage({ id: "research.pdf.preview" })}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {pdfMissing ? (
              <div className="p-3 text-ui-sm text-foreground-subtlest">
                {intl.formatMessage({ id: "research.pdf.missing" })}
              </div>
            ) : pdfSource ? (
              <Suspense
                fallback={
                  <div className="p-3 text-ui-sm text-foreground-subtlest">
                    {intl.formatMessage({ id: "research.pdf.loading" })}
                  </div>
                }
              >
                <PdfViewer
                  source={pdfSource}
                  labels={pdfLabels}
                  className="h-full"
                  targetPage={targetPage}
                  onPageClick={handlePdfPageClick}
                />
              </Suspense>
            ) : (
              <div className="flex items-center gap-2 p-3 text-ui-sm text-foreground-subtlest">
                <Spinner className="size-3.5" />
                {intl.formatMessage({ id: "research.loading" })}
              </div>
            )}
          </div>
        </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// ── 图表库（图墙 + 图上圈注 + 版本历史翻版） ──

interface FigureItem {
  absPath: string;
  relPath: string;
  group: string;
}

/** 版本化图表：policy.png + policy_v2.png + policy_v3.png → 同一条目三个版本。 */
interface FigureVersion {
  absPath: string;
  relPath: string;
  v: number;
}

interface FigureEntry {
  id: string;
  group: string;
  base: string;
  versions: FigureVersion[];
}

interface AnnotationRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 解析图表文件名 → (去版本基名, 版本号)；无版本后缀视为 v1。 */
function parseFigureVersion(fileName: string): { base: string; v: number } {
  const dot = fileName.lastIndexOf(".");
  const stem = dot >= 0 ? fileName.slice(0, dot) : fileName;
  const match = stem.match(FIGURE_VERSION_PATTERN);
  if (match) {
    return { base: match[1]!, v: Number.parseInt(match[2]!, 10) };
  }
  return { base: stem, v: 1 };
}

/** 把扫描到的平面文件列表合并成带版本历史的条目。 */
function buildFigureEntries(items: FigureItem[]): FigureEntry[] {
  const entries = new Map<string, FigureEntry>();
  for (const item of items) {
    const fileName = item.relPath.split("/").pop()!;
    const { base, v } = parseFigureVersion(fileName);
    const id = `${item.group}/${base}`;
    const existing = entries.get(id);
    const version: FigureVersion = { absPath: item.absPath, relPath: item.relPath, v };
    if (existing) {
      existing.versions.push(version);
    } else {
      entries.set(id, { id, group: item.group, base, versions: [version] });
    }
  }
  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      versions: [...entry.versions].sort((a, b) => a.v - b.v),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function FiguresGallery({
  workspacePath,
  fileService,
  watcher,
  onError,
  copyPrompt,
}: {
  workspacePath: string;
  fileService: FileServiceLike;
  watcher: WatcherServiceLike | undefined;
  onError: (message: string | null) => void;
  copyPrompt: CopyPromptFn;
}) {
  const { intl } = useZCodeIntl();
  const [figures, setFigures] = useState<FigureItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [versionNotes, setVersionNotes] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<{
    entry: FigureEntry;
    versionIndex: number;
  } | null>(null);
  const [comment, setComment] = useState("");
  const [scanned, setScanned] = useState(false);
  const [watchedRoot, setWatchedRoot] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [annotations, setAnnotations] = useState<AnnotationRect[]>([]);
  const [draftRect, setDraftRect] = useState<AnnotationRect | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let disposed = false;
    onError(null);
    setFigures([]);
    setPreviews({});
    setVersionNotes({});
    setSelected(null);
    setScanned(false);

    // 图表包同目录的 versions.json（版本备注索引），存在则并入条目版本信息。
    const loadVersionNotes = async (dirAbs: string) => {
      try {
        const slice = await fileService.readTextFile({
          path: joinPath(dirAbs, "versions.json"),
          length: 64 * 1024,
        });
        if (slice.isBinary) return;
        const parsed: unknown = JSON.parse(slice.content);
        if (typeof parsed !== "object" || parsed === null) return;
        const versions = (parsed as Record<string, unknown>).versions;
        if (!Array.isArray(versions)) return;
        const notes: Record<string, string> = {};
        for (const item of versions) {
          if (typeof item !== "object" || item === null) continue;
          const record = item as Record<string, unknown>;
          const file = typeof record.file === "string" ? record.file : "";
          const note = typeof record.note === "string" ? record.note.trim() : "";
          if (file && note) notes[file] = note;
        }
        if (!disposed && Object.keys(notes).length > 0) {
          setVersionNotes((current) => ({ ...current, ...notes }));
        }
      } catch {
        // versions.json 缺失或损坏：版本信息退化为纯文件名。
      }
    };

    void (async () => {
      const roots = ["figures", "docs/figures", "paper/figures"];
      const found: FigureItem[] = [];
      for (const root of roots) {
        const rootAbs = joinPath(workspacePath, root);
        let rootEntries: FileEntry[];
        try {
          rootEntries = await fileService.readdir({ path: rootAbs });
        } catch {
          continue;
        }
        for (const entry of rootEntries) {
          if (entry.type === "file" && IMAGE_EXTENSIONS.has(fileExtension(entry.name))) {
            found.push({ absPath: entry.path, relPath: `${root}/${entry.name}`, group: root });
          } else if (entry.type === "directory") {
            if (root.split("/").length >= FIGURE_SCAN_DEPTH) continue;
            let subEntries: FileEntry[];
            try {
              subEntries = await fileService.readdir({ path: entry.path });
            } catch {
              continue;
            }
            for (const subEntry of subEntries) {
              if (subEntry.type === "file" && IMAGE_EXTENSIONS.has(fileExtension(subEntry.name))) {
                found.push({
                  absPath: subEntry.path,
                  relPath: `${root}/${entry.name}/${subEntry.name}`,
                  group: `${root}/${entry.name}`,
                });
              }
            }
          }
        }
        if (found.length > 0) {
          setWatchedRoot(root);
          break;
        }
      }

      // 标准目录没有图时自适应兜底：docs/ 下名字含 fig 的目录（paper_figs /
      // cmp_report_figs 等常见学术布局）逐个成组，不需要项目改目录。
      if (found.length === 0) {
        try {
          const docsEntries = await fileService.readdir({
            path: joinPath(workspacePath, "docs"),
          });
          for (const entry of docsEntries) {
            if (entry.type !== "directory" || !/fig/i.test(entry.name)) continue;
            let figEntries: FileEntry[];
            try {
              figEntries = await fileService.readdir({ path: entry.path });
            } catch {
              continue;
            }
            for (const figEntry of figEntries) {
              if (figEntry.type === "file" && IMAGE_EXTENSIONS.has(fileExtension(figEntry.name))) {
                found.push({
                  absPath: figEntry.path,
                  relPath: `docs/${entry.name}/${figEntry.name}`,
                  group: `docs/${entry.name}`,
                });
              }
            }
          }
          if (found.length > 0) setWatchedRoot("docs");
        } catch {
          // docs/ 不存在：保持空态。
        }
      }

      if (disposed) return;
      setFigures(found);
      setScanned(true);

      // 扫描到的组目录逐一尝试读 versions.json（缺失静默跳过）。
      const groupDirs = new Set(found.map((figure) => figure.absPath.split("/").slice(0, -1).join("/")));
      for (const dir of groupDirs) {
        await loadVersionNotes(dir);
      }

      // 缩略图按需生成：仅前 40 张，防大目录拖垮。
      for (const figure of found.slice(0, 40)) {
        try {
          const preview = await fileService.readMediaPreview({
            path: figure.absPath,
            maxBytes: 2 * 1024 * 1024,
          });
          if (disposed) return;
          setPreviews((current) => ({
            ...current,
            [figure.absPath]: `data:${preview.mediaType};base64,${preview.dataBase64}`,
          }));
        } catch {
          // 单张缩略图失败不阻断整体。
        }
      }
    })().catch((scanError: unknown) => {
      if (!disposed) onError(scanError instanceof Error ? scanError.message : String(scanError));
    });

    return () => {
      disposed = true;
    };
  }, [workspacePath, fileService, reloadKey, onError]);

  // agent 重生成图后自动重扫图墙。
  useDirChangeWatcher(
    watchedRoot ? joinPath(workspacePath, watchedRoot) : joinPath(workspacePath, "figures"),
    watcher,
    useCallback(() => setReloadKey((key) => key + 1), []),
  );

  const grouped = useMemo(() => {
    const entries = buildFigureEntries(figures);
    const groups = new Map<string, FigureEntry[]>();
    for (const entry of entries) {
      const list = groups.get(entry.group) ?? [];
      list.push(entry);
      groups.set(entry.group, list);
    }
    return [...groups.entries()];
  }, [figures]);

  const describeAnnotations = useCallback((rects: AnnotationRect[]): string => {
    if (rects.length === 0) return "";
    return rects
      .map(
        (rect, index) =>
          `区域${index + 1}：x ${rect.x.toFixed(0)}%~${(rect.x + rect.w).toFixed(0)}%、y ${rect.y.toFixed(0)}%~${(rect.y + rect.h).toFixed(0)}%`,
      )
      .join("；");
  }, []);

  const pointerPosToPercent = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    return {
      x: Math.min(100, Math.max(0, x)),
      y: Math.min(100, Math.max(0, y)),
    };
  }, []);

  // 当前查看的版本 + 反馈指令中的「下一版」文件名（版本历史约定：不覆盖，存 _vN+1）。
  const selectedVersion = selected ? selected.entry.versions[selected.versionIndex]! : null;
  const nextVersionName = useMemo(() => {
    if (!selected) return "";
    const latest = selected.entry.versions[selected.entry.versions.length - 1]!;
    const dir = latest.relPath.split("/").slice(0, -1).join("/");
    const extension = fileExtension(latest.relPath.split("/").pop() ?? "");
    const suffix = extension ? `.${extension}` : "";
    return dir ? `${dir}/${selected.entry.base}_v${latest.v + 1}${suffix}` : `${selected.entry.base}_v${latest.v + 1}${suffix}`;
  }, [selected]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "research.figures.count" }, { count: figures.length })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 px-2.5 text-ui-sm"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" strokeWidth={1.33} />
          {intl.formatMessage({ id: "research.figures.rescan" })}
        </Button>
      </div>
      {selected ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
          {selected.entry.versions.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {selected.entry.versions.map((version, index) => (
                <button
                  key={version.absPath}
                  type="button"
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-ui-base font-normal tabular-nums transition-colors",
                    index === selected.versionIndex
                      ? "bg-selected font-medium text-foreground"
                      : "bg-surface text-foreground-subtle hover:text-foreground",
                  )}
                  title={
                    versionNotes[version.relPath.split("/").pop() ?? ""] ??
                    version.relPath
                  }
                  onClick={() => setSelected({ entry: selected.entry, versionIndex: index })}
                >
                  v{version.v}
                  {index === selected.entry.versions.length - 1
                    ? intl.formatMessage({ id: "research.figures.latestTag" })
                    : ""}
                </button>
              ))}
              {versionNotes[
                selected.entry.versions[selected.versionIndex]!.relPath.split("/").pop() ?? ""
              ] ? (
                <span className="ml-1 truncate text-ui-base font-normal leading-5 text-foreground-subtlest">
                  {versionNotes[
                    selected.entry.versions[selected.versionIndex]!.relPath.split("/").pop() ?? ""
                  ]}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-card-border bg-card">
            <div
              className="relative inline-block cursor-crosshair"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const pos = pointerPosToPercent(event);
                dragStartRef.current = pos;
                setDraftRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
              }}
              onPointerMove={(event) => {
                const start = dragStartRef.current;
                if (!start) return;
                const pos = pointerPosToPercent(event);
                setDraftRect({
                  x: Math.min(start.x, pos.x),
                  y: Math.min(start.y, pos.y),
                  w: Math.abs(pos.x - start.x),
                  h: Math.abs(pos.y - start.y),
                });
              }}
              onPointerUp={() => {
                const start = dragStartRef.current;
                dragStartRef.current = null;
                if (start && draftRect && draftRect.w >= 2 && draftRect.h >= 2) {
                  setAnnotations((current) => [...current, draftRect]);
                }
                setDraftRect(null);
              }}
            >
              {previews[selected.entry.versions[selected.versionIndex]!.absPath] ? (
                <img
                  src={previews[selected.entry.versions[selected.versionIndex]!.absPath]}
                  alt={selected.entry.versions[selected.versionIndex]!.relPath}
                  className="block max-h-[60vh] select-none object-contain"
                  draggable={false}
                />
              ) : (
                <div className="p-3 text-ui-sm text-foreground-subtlest">
                  {selected.entry.versions[selected.versionIndex]!.relPath}
                </div>
              )}
              {annotations.map((rect, index) => (
                <div
                  key={`${rect.x}-${rect.y}-${index}`}
                  className="absolute cursor-pointer border-2 border-destructive bg-destructive/10"
                  style={{
                    left: `${rect.x}%`,
                    top: `${rect.y}%`,
                    width: `${rect.w}%`,
                    height: `${rect.h}%`,
                  }}
                  title={intl.formatMessage({ id: "research.figures.removeAnnotation" })}
                  onClick={(event) => {
                    event.stopPropagation();
                    setAnnotations((current) => current.filter((_, i) => i !== index));
                  }}
                >
                  <span className="absolute -top-2 -left-2 flex size-4 items-center justify-center rounded-full bg-destructive text-ui-sm font-medium text-white">
                    {index + 1}
                  </span>
                </div>
              ))}
              {draftRect ? (
                <div
                  className="absolute border-2 border-dashed border-destructive/70"
                  style={{
                    left: `${draftRect.x}%`,
                    top: `${draftRect.y}%`,
                    width: `${draftRect.w}%`,
                    height: `${draftRect.h}%`,
                  }}
                />
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={intl.formatMessage({ id: "research.figures.commentPlaceholder" })}
              className="h-8 text-ui-sm"
            />
            {annotations.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 text-ui-sm"
                onClick={() => setAnnotations([])}
              >
                <EraserIcon className="size-3.5" strokeWidth={1.33} />
                {intl.formatMessage({ id: "research.figures.clearAnnotations" })}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 text-ui-sm"
              onClick={() =>
                void copyPrompt(
                  intl.formatMessage(
                    { id: "research.figures.historyPrompt" },
                    { path: selectedVersion?.relPath ?? "" },
                  ),
                  intl.formatMessage({ id: "research.promptCopied" }),
                )
              }
            >
              <HistoryIcon className="size-3.5" strokeWidth={1.33} />
              {intl.formatMessage({ id: "research.figures.history" })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 text-ui-sm"
              onClick={() => {
                setSelected(null);
                setAnnotations([]);
                setComment("");
              }}
            >
              {intl.formatMessage({ id: "research.figures.back" })}
            </Button>
            <Button
              size="sm"
              className="h-8 shrink-0 text-ui-sm"
              disabled={!comment.trim()}
              onClick={() => {
                const annotationText = describeAnnotations(annotations);
                const promptValues = {
                  path: selectedVersion?.relPath ?? "",
                  nextVersion: nextVersionName,
                  comment: comment.trim(),
                };
                const prompt = annotationText
                  ? intl.formatMessage(
                      { id: "research.figures.feedbackPromptWithRegions" },
                      { ...promptValues, regions: annotationText },
                    )
                  : intl.formatMessage(
                      { id: "research.figures.feedbackPrompt" },
                      promptValues,
                    );
                void copyPrompt(prompt, intl.formatMessage({ id: "research.promptCopied" }));
              }}
            >
              <ClipboardCopyIcon className="size-3.5" strokeWidth={1.33} />
              {intl.formatMessage({ id: "research.figures.sendFeedback" })}
            </Button>
          </div>
          <div className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "research.figures.annotateHint" })}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          {grouped.map(([group, items]) => (
            <Collapsible key={group} defaultOpen className="mb-5">
              <CollapsibleTrigger className="group/collapsible mb-2 flex w-full items-center gap-1.5 text-ui-base font-medium text-foreground-subtle">
                <ChevronDownIcon
                  className="size-3.5 shrink-0 transition-transform group-data-[state=closed]/collapsible:-rotate-90"
                  strokeWidth={1.33}
                />
                <span className="truncate">{group}/</span>
                <span className="shrink-0 text-ui-sm text-foreground-subtlest">{items.length}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid grid-cols-3 gap-3 xl:grid-cols-4 2xl:grid-cols-5">
                {items.map((entry) => {
                  const latest = entry.versions[entry.versions.length - 1]!;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="flex flex-col overflow-hidden rounded-xl border border-card-border bg-background text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
                      onClick={() =>
                        setSelected({ entry, versionIndex: entry.versions.length - 1 })
                      }
                    >
                      <div className="flex h-36 items-center justify-center bg-muted/20">
                        {previews[latest.absPath] ? (
                          <img
                            src={previews[latest.absPath]}
                            alt={latest.relPath}
                            className="max-h-36 max-w-full object-contain"
                          />
                        ) : (
                          <ImageIcon className="size-6 text-foreground-subtlest" strokeWidth={1.33} />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-left text-ui-base">
                        <span className="min-w-0 flex-1 truncate font-normal leading-5 text-foreground-subtle">
                          {entry.base}
                        </span>
                        {entry.versions.length > 1 ? (
                          <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md bg-surface px-1.5 py-0.5 font-normal tabular-nums text-foreground-subtle">
                            {intl.formatMessage(
                              { id: "research.figures.versionCount" },
                              { count: entry.versions.length },
                            )}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
          {scanned && figures.length === 0 ? (
            <div className="p-3 text-ui-sm text-foreground-subtlest">
              {intl.formatMessage({ id: "research.figures.empty" })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── 实验记录 ──

interface ExperimentCard {
  dirName: string;
  title: string;
  verdict: string | null;
  snippet: string;
}

const VERDICT_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PROCEED: "default",
  REFINE: "secondary",
  PIVOT: "outline",
  NEGATIVE: "destructive",
};

function ExperimentsList({
  workspacePath,
  fileService,
  watcher,
  onError,
}: {
  workspacePath: string;
  fileService: FileServiceLike;
  watcher: WatcherServiceLike | undefined;
  onError: (message: string | null) => void;
}) {
  const { intl } = useZCodeIntl();
  const [cards, setCards] = useState<ExperimentCard[]>([]);
  const [scanned, setScanned] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // agent 写新 meta.md 后实验卡片自动出现。
  useDirChangeWatcher(
    joinPath(workspacePath, "experiments"),
    watcher,
    useCallback(() => setReloadKey((key) => key + 1), []),
  );

  useEffect(() => {
    let disposed = false;
    onError(null);
    setCards([]);
    setScanned(false);

    void (async () => {
      let entries: FileEntry[];
      try {
        entries = await fileService.readdir({ path: joinPath(workspacePath, "experiments") });
      } catch {
        if (!disposed) setScanned(true);
        return;
      }
      const directories = entries
        .filter((entry) => entry.type === "directory")
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left));
      const loaded: ExperimentCard[] = [];
      for (const dirName of directories.slice(0, 100)) {
        const metaAbs = joinPath(workspacePath, `experiments/${dirName}/meta.md`);
        try {
          const text = await fileService.readTextFile({ path: metaAbs, length: META_LIMIT_BYTES });
          if (disposed) return;
          const lines = text.content.split("\n");
          const title = (lines.find((line) => line.startsWith("# ")) ?? `# ${dirName}`)
            .slice(2)
            .trim();
          const verdictLine = lines.find((line) => /PROCEED|REFINE|PIVOT|NEGATIVE/.test(line));
          const verdict = verdictLine
            ? (verdictLine.match(/PROCEED|REFINE|PIVOT|NEGATIVE/)?.[0] ?? null)
            : null;
          const snippet = lines
            .filter((line) => line.trim() && !line.startsWith("#"))
            .slice(0, 3)
            .join(" · ");
          loaded.push({ dirName, title, verdict, snippet });
        } catch {
          if (disposed) return;
          loaded.push({ dirName, title: dirName, verdict: null, snippet: "" });
        }
      }
      if (disposed) return;
      setCards(loaded);
      setScanned(true);
    })().catch((scanError: unknown) => {
      if (!disposed) onError(scanError instanceof Error ? scanError.message : String(scanError));
    });

    return () => {
      disposed = true;
    };
  }, [workspacePath, fileService, reloadKey, onError]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "research.experiments.count" }, { count: cards.length })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 px-2.5 text-ui-sm"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" strokeWidth={1.33} />
          {intl.formatMessage({ id: "research.experiments.rescan" })}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
        <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-3 lg:grid-cols-2">
          {cards.map((card) => (
            <div key={card.dirName} className="rounded-[10px] border border-card-border bg-card px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="truncate text-ui-base font-medium" title={card.title}>
                  {card.title}
                </span>
                {card.verdict ? (
                  <Badge
                    variant={VERDICT_BADGE_VARIANT[card.verdict] ?? "outline"}
                    className="ml-auto"
                  >
                    {card.verdict}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-1 text-ui-sm text-foreground-subtle">{card.dirName}</div>
              {card.snippet ? (
                <div className="mt-1.5 line-clamp-2 text-ui-sm text-foreground-subtlest">
                  {card.snippet}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {scanned && cards.length === 0 ? (
          <div className="p-3 text-ui-sm text-foreground-subtlest">
            {intl.formatMessage({ id: "research.experiments.empty" })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── 文献库（读 docs/lit/ 约定目录） ──

interface LitPaper {
  slug: string;
  title: string;
  year: string | null;
  authors: string | null;
  sourceFile: string;
  /** ref = 文献条目（BibTeX/编号列表）；pdf = 本地 PDF 文件（docs/papers 兜底）。 */
  kind: "ref" | "pdf";
}

interface LitGroup {
  slug: string;
  papers: LitPaper[];
}

/** 从 BibTeX 正文段逐行抽字段：不构造动态正则，字段名固定匹配。 */
function parseBibtexEntryFields(body: string): {
  title: string | null;
  year: string | null;
  authors: string | null;
} {
  let title: string | null = null;
  let year: string | null = null;
  let authors: string | null = null;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim().replace(/,+$/, "");
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .toLowerCase();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^[{"]/, "")
      .replace(/[}"]$/, "")
      .trim();
    if (!value) continue;
    if (key === "title" && title === null) {
      title = value;
    } else if (key === "year" && year === null) {
      year = value;
    } else if (key === "author" && authors === null) {
      authors = value;
    }
  }
  return { title, year, authors };
}

const BIBTEX_ENTRY_PATTERN = /@(article|inproceedings|book|incollection|misc|techreport)\s*\{([^,]+),([\s\S]*?)\n\}/g;
const NUMBERED_REF_PATTERN = /^\s*\[(\d+)\]\s*(.+)$/;
const YEAR_PATTERN = /\b((?:19|20)\d{2})\b/;

function parseBibtexEntries(content: string, slug: string, sourceFile: string): LitPaper[] {
  const papers: LitPaper[] = [];
  for (const match of content.matchAll(BIBTEX_ENTRY_PATTERN)) {
    const fields = parseBibtexEntryFields(match[3] ?? "");
    papers.push({
      slug,
      title: fields.title ?? match[2]!,
      year: fields.year,
      authors: fields.authors,
      sourceFile,
      kind: "ref",
    });
  }
  // 纯文本编号参考文献（[N] 标题. venue, 年份.）：逐条收录，年份就地提取，不编造其余字段。
  for (const rawLine of content.split("\n")) {
    const match = rawLine.match(NUMBERED_REF_PATTERN);
    if (!match) continue;
    const body = match[2]!.trim();
    if (!body) continue;
    const yearMatch = body.match(YEAR_PATTERN);
    papers.push({
      slug,
      title: body,
      year: yearMatch ? yearMatch[1]! : null,
      authors: null,
      sourceFile,
      kind: "ref",
    });
  }
  return papers;
}

function LiteratureLibrary({
  workspacePath,
  fileService,
  watcher,
  onError,
  copyPrompt,
  onOpenViewer,
}: {
  workspacePath: string;
  fileService: FileServiceLike;
  watcher: WatcherServiceLike | undefined;
  onError: (message: string | null) => void;
  copyPrompt: CopyPromptFn;
  onOpenViewer: (path: string, name: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const [groups, setGroups] = useState<LitGroup[]>([]);
  const [scanned, setScanned] = useState(false);
  const [selectedPaper, setSelectedPaper] = useState<LitPaper | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);

  // 选中本地 PDF 条目时在详情区直接内嵌预览（复用共享 PdfViewer，与 LaTeX 页同源）。
  useEffect(() => {
    let disposed = false;
    setPdfBytes(null);
    if (!selectedPaper || selectedPaper.kind !== "pdf") return undefined;
    void (async () => {
      try {
        const whole = await readWholeFile(
          fileService,
          selectedPaper.sourceFile,
          OVERLAY_PDF_MAX_BYTES,
        );
        if (!disposed && whole) setPdfBytes(whole);
      } catch {
        // 内嵌预览失败：详情区保留「查看 PDF」浮层兜底。
      }
    })();
    return () => {
      disposed = true;
    };
  }, [selectedPaper, fileService]);

  useDirChangeWatcher(
    joinPath(workspacePath, "docs/lit"),
    watcher,
    useCallback(() => setReloadKey((key) => key + 1), []),
  );

  useEffect(() => {
    let disposed = false;
    onError(null);
    setGroups([]);
    setSelectedPaper(null);
    setScanned(false);

    void (async () => {
      let litEntries: FileEntry[];
      try {
        litEntries = await fileService.readdir({ path: joinPath(workspacePath, "docs/lit") });
      } catch {
        if (!disposed) setScanned(true);
        return;
      }
      const loaded: LitGroup[] = [];
      for (const entry of litEntries.filter((item) => item.type === "directory")) {
        let files: FileEntry[];
        try {
          files = await fileService.readdir({ path: entry.path });
        } catch {
          continue;
        }
        const papers: LitPaper[] = [];
        for (const file of files.filter(
          (item) => item.type === "file" && fileExtension(item.name) === "md",
        )) {
          try {
            const text = await fileService.readTextFile({ path: file.path, length: 512 * 1024 });
            if (disposed) return;
            papers.push(...parseBibtexEntries(text.content, entry.name, file.path));
          } catch {
            // 单文件解析失败跳过。
          }
        }
        if (papers.length > 0) loaded.push({ slug: entry.name, papers });
      }
      // docs/papers/ 的本地 PDF 常驻成组（与 lit 条目并列，不只在 lit 为空时兜底）。
      try {
        const pdfEntries = await fileService.readdir({
          path: joinPath(workspacePath, "docs/papers"),
        });
        const pdfPapers: LitPaper[] = [];
        for (const entry of pdfEntries) {
          if (entry.type !== "file" || fileExtension(entry.name) !== "pdf") continue;
          pdfPapers.push({
            slug: intl.formatMessage({ id: "research.literature.localPdfs" }),
            title: entry.name.replace(/\.pdf$/, ""),
            year: null,
            authors: null,
            sourceFile: entry.path,
            kind: "pdf",
          });
        }
        if (pdfPapers.length > 0) {
          loaded.push({ slug: pdfPapers[0]!.slug, papers: pdfPapers });
        }
      } catch {
        // docs/papers/ 不存在：跳过该组。
      }
      if (disposed) return;
      setGroups(loaded);
      setScanned(true);
    })().catch((scanError: unknown) => {
      if (!disposed) onError(scanError instanceof Error ? scanError.message : String(scanError));
    });

    return () => {
      disposed = true;
    };
  }, [workspacePath, fileService, reloadKey, onError]);

  const totalPapers = useMemo(
    () => groups.reduce((sum, group) => sum + group.papers.length, 0),
    [groups],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "research.literature.count" }, { count: totalPapers })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 px-2.5 text-ui-sm"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" strokeWidth={1.33} />
          {intl.formatMessage({ id: "research.literature.rescan" })}
        </Button>
        <Button
          size="sm"
          className="h-8 px-2.5 text-ui-sm"
          onClick={() =>
            void copyPrompt(
              intl.formatMessage({ id: "research.literature.continuePrompt" }),
              intl.formatMessage({ id: "research.promptCopied" }),
            )
          }
        >
          <ClipboardCopyIcon className="size-3.5" strokeWidth={1.33} />
          {intl.formatMessage({ id: "research.literature.continue" })}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4">
        <div className="min-h-0 w-1/2 overflow-auto">
          {groups.map((group) => (
            <div key={group.slug} className="mb-4">
              <div className="mb-1.5 text-ui-sm font-medium text-foreground-subtle">
                {group.slug}/ · {group.papers.length}
              </div>
              {group.papers.map((paper) => (
                <button
                  key={`${paper.sourceFile}:${paper.title}`}
                  type="button"
                  className={cn(
                    "mb-1 block w-full rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-card-border hover:bg-hover",
                    selectedPaper === paper && "border-card-border bg-hover",
                  )}
                  onClick={() => setSelectedPaper(paper)}
                >
                  <div className="truncate text-ui-base" title={paper.title}>
                    {paper.title}
                  </div>
                  <div className="truncate text-ui-sm text-foreground-subtle">
                    {[paper.authors, paper.year].filter(Boolean).join(" · ") || paper.slug}
                  </div>
                </button>
              ))}
            </div>
          ))}
          {scanned && totalPapers === 0 ? (
            <div className="p-3 text-ui-sm text-foreground-subtlest">
              {intl.formatMessage({ id: "research.literature.empty" })}
            </div>
          ) : null}
        </div>
        <div className="flex min-h-0 w-1/2 flex-col overflow-hidden rounded-[10px] border border-card-border bg-card px-3 py-3">
          {selectedPaper ? (
            <>
              <div className="shrink-0">
                <div className="truncate text-ui-base font-medium" title={selectedPaper.title}>
                  {selectedPaper.title}
                </div>
                <div className="mt-1 truncate text-ui-sm text-foreground-subtle">
                  {[selectedPaper.authors, selectedPaper.year].filter(Boolean).join(" · ") ||
                    selectedPaper.slug}
                </div>
                <div className="mt-1 truncate text-ui-sm text-foreground-subtlest">
                  {selectedPaper.sourceFile}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                {selectedPaper.kind === "pdf" ? (
                  <>
                    <Button
                      size="sm"
                      className="h-7 text-ui-sm"
                      onClick={() =>
                        onOpenViewer(
                          selectedPaper.sourceFile,
                          selectedPaper.sourceFile.split("/").pop() ?? "paper.pdf",
                        )
                      }
                    >
                      <BookOpenIcon className="size-3.5" />
                      {intl.formatMessage({ id: "research.literature.viewPdf" })}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-ui-sm"
                      onClick={() =>
                        void copyPrompt(
                          intl.formatMessage(
                            { id: "research.literature.readPrompt" },
                            { path: selectedPaper.sourceFile },
                          ),
                          intl.formatMessage({ id: "research.promptCopied" }),
                        )
                      }
                    >
                      <ClipboardCopyIcon className="size-3.5" strokeWidth={1.33} />
                      {intl.formatMessage({ id: "research.literature.read" })}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      className="h-7 text-ui-sm"
                      onClick={() =>
                        onOpenViewer(
                          selectedPaper.sourceFile,
                          selectedPaper.sourceFile.split("/").pop() ?? "notes.md",
                        )
                      }
                    >
                      <BookOpenIcon className="size-3.5" />
                      {intl.formatMessage({ id: "research.literature.viewSource" })}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-ui-sm"
                      onClick={() =>
                        void copyPrompt(
                          intl.formatMessage(
                            { id: "research.literature.findFulltextPrompt" },
                            { title: selectedPaper.title },
                          ),
                          intl.formatMessage({ id: "research.promptCopied" }),
                        )
                      }
                    >
                      <ClipboardCopyIcon className="size-3.5" strokeWidth={1.33} />
                      {intl.formatMessage({ id: "research.literature.findFulltext" })}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-ui-sm"
                      onClick={() =>
                        void copyPrompt(
                          intl.formatMessage(
                            { id: "research.literature.verifyPrompt" },
                            { title: selectedPaper.title },
                          ),
                          intl.formatMessage({ id: "research.promptCopied" }),
                        )
                      }
                    >
                      <ClipboardCopyIcon className="size-3.5" strokeWidth={1.33} />
                      {intl.formatMessage({ id: "research.literature.verify" })}
                    </Button>
                  </>
                )}
                </div>
              </div>
              {selectedPaper.kind === "pdf" ? (
                <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-card-border">
                  {pdfBytes ? (
                    <Suspense
                      fallback={
                        <div className="p-3 text-ui-sm text-foreground-subtlest">
                          {intl.formatMessage({ id: "research.pdf.loading" })}
                        </div>
                      }
                    >
                      <PdfViewer source={pdfBytes} className="h-full" />
                    </Suspense>
                  ) : (
                    <div className="flex items-center gap-2 p-3 text-ui-sm text-foreground-subtlest">
                      <Spinner className="size-3.5" />
                      {intl.formatMessage({ id: "research.pdf.loading" })}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "research.literature.selectHint" })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 交付物中心（投稿包 / 评审记录 / 文献调研 / 实验证据 + 成品预览） ──

interface DeliverableRow {
  label: string;
  detail: string;
  path: string;
  kind: "file" | "directory";
}

/** markdown-lite：表格沿用台架渲染语义，另支持列表/粗体/行内代码（交付文档预览用）。 */
function renderInlineMarkdown(text: string): React.ReactNode {
  // split + 捕获组：每个匹配在结果里贡献 [纯文本, 粗体捕获?, 行内代码捕获?] 三段。
  const parts = text.split(/\*\*([^*]+)\*\*|`([^`]+)`/g);
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    const plain = parts[i];
    const bold = parts[i + 1];
    const code = parts[i + 2];
    if (plain) nodes.push(plain);
    if (bold) {
      nodes.push(
        <strong key={`b-${i}`} className="font-medium text-foreground">
          {bold}
        </strong>,
      );
    }
    if (code) {
      nodes.push(
        <code key={`c-${i}`} className="rounded bg-hover px-1 py-0.5 font-mono text-ui-sm">
          {code}
        </code>,
      );
    }
  }
  return nodes;
}

function renderMarkdownDocument(content: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const lines = content.split("\n");
  let index = 0;
  let key = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        tableLines.push(lines[index]!.trim());
        index += 1;
      }
      const rows = tableLines
        .map((rowLine) =>
          rowLine
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim()),
        )
        .filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === ""));
      if (rows.length > 0) {
        nodes.push(
          <div key={key++} className="my-3 overflow-x-auto rounded-lg border border-card-border">
            <table className="w-full border-collapse text-ui-sm">
              <thead>
                <tr className="bg-hover/40">
                  {rows[0]!.map((cell, cellIndex) => (
                    <th
                      key={cellIndex}
                      className="border-b border-card-border px-2.5 py-1.5 text-left font-medium text-foreground-subtle"
                    >
                      {renderInlineMarkdown(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((cells, rowIndex) => (
                  <tr key={rowIndex} className="odd:bg-hover/15">
                    {cells.map((cell, cellIndex) => (
                      <td key={cellIndex} className="border-b border-card-border/60 px-2.5 py-1.5">
                        {renderInlineMarkdown(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      nodes.push(
        <div
          key={key++}
          className={cn(
            "mt-4 mb-1 font-medium text-foreground",
            headingMatch[1]!.length <= 2 ? "text-ui-base" : "text-ui-sm",
          )}
        >
          {renderInlineMarkdown(headingMatch[2]!)}
        </div>,
      );
      index += 1;
      continue;
    }
    const listMatch = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const items: string[] = [];
      const ordered = /\d+\./.test(listMatch[1]!);
      while (index < lines.length) {
        const itemMatch = lines[index]!.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
        if (!itemMatch) break;
        items.push(itemMatch[2]!);
        index += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      nodes.push(
        <ListTag
          key={key++}
          className={cn(
            "my-1.5 pl-5 text-ui-sm leading-relaxed text-foreground-subtle",
            ordered ? "list-decimal" : "list-disc",
          )}
        >
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="my-0.5">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ListTag>,
      );
      continue;
    }
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() !== "" &&
      !lines[index]!.trim().startsWith("|") &&
      !lines[index]!.match(/^#{1,6}\s+/) &&
      !lines[index]!.match(/^\s*([-*+]|\d+\.)\s+/)
    ) {
      paragraphLines.push(lines[index]!);
      index += 1;
    }
    nodes.push(
      <p key={key++} className="my-1.5 text-ui-sm leading-relaxed text-foreground-subtle">
        {renderInlineMarkdown(paragraphLines.join(" "))}
      </p>,
    );
  }
  return nodes;
}

interface DeliverablePreviewState {
  path: string;
  name: string;
}

function DeliverablesCenter({
  workspacePath,
  fileService,
  watcher,
  onError,
  copyPrompt,
}: {
  workspacePath: string;
  fileService: FileServiceLike;
  watcher: WatcherServiceLike | undefined;
  onError: (message: string | null) => void;
  copyPrompt: CopyPromptFn;
}) {
  const { intl } = useZCodeIntl();
  const [rows, setRows] = useState<DeliverableRow[]>([]);
  const [scanned, setScanned] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedDir, setExpandedDir] = useState<string | null>(null);
  const [dirChildren, setDirChildren] = useState<DeliverableRow[]>([]);
  const [preview, setPreview] = useState<DeliverablePreviewState | null>(null);

  useDirChangeWatcher(
    joinPath(workspacePath, "paper"),
    watcher,
    useCallback(() => setReloadKey((key) => key + 1), []),
  );

  useEffect(() => {
    let disposed = false;
    onError(null);
    setRows([]);
    setScanned(false);

    void (async () => {
      const loaded: DeliverableRow[] = [];
      const scanFiles = async (dirRel: string, label: string) => {
        let entries: FileEntry[];
        try {
          entries = await fileService.readdir({ path: joinPath(workspacePath, dirRel) });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.type !== "file") continue;
          loaded.push({
            label,
            detail: `${dirRel}/${entry.name}`,
            path: entry.path,
            kind: "file",
          });
        }
      };

      // 投稿包
      await scanFiles(
        "paper/submission",
        intl.formatMessage({ id: "research.deliverables.submission" }),
      );
      // 评审记录目录
      try {
        const reviews = await fileService.readdir({
          path: joinPath(workspacePath, "paper/reviews"),
        });
        for (const entry of reviews.filter((item) => item.type === "directory")) {
          loaded.push({
            label: intl.formatMessage({ id: "research.deliverables.reviews" }),
            detail: `paper/reviews/${entry.name}/`,
            path: entry.path,
            kind: "directory",
          });
        }
      } catch {
        // 无评审记录。
      }
      // 文献调研目录
      try {
        const lit = await fileService.readdir({ path: joinPath(workspacePath, "docs/lit") });
        for (const entry of lit.filter((item) => item.type === "directory")) {
          loaded.push({
            label: intl.formatMessage({ id: "research.deliverables.lit" }),
            detail: `docs/lit/${entry.name}/`,
            path: entry.path,
            kind: "directory",
          });
        }
      } catch {
        // 无文献调研。
      }
      // 论文主产物（paper/ 顶层 pdf）
      try {
        const paperEntries = await fileService.readdir({
          path: joinPath(workspacePath, "paper"),
        });
        for (const entry of paperEntries) {
          if (entry.type === "file" && fileExtension(entry.name) === "pdf") {
            loaded.push({
              label: intl.formatMessage({ id: "research.deliverables.paper" }),
              detail: `paper/${entry.name}`,
              path: entry.path,
              kind: "file",
            });
          }
        }
      } catch {
        // 无 paper/ 目录。
      }
      // 实验证据（计数行）
      try {
        const experiments = await fileService.readdir({
          path: joinPath(workspacePath, "experiments"),
        });
        const count = experiments.filter((item) => item.type === "directory").length;
        if (count > 0) {
          loaded.push({
            label: intl.formatMessage({ id: "research.deliverables.experiments" }),
            detail: intl.formatMessage(
              { id: "research.deliverables.experimentsCount" },
              { count },
            ),
            path: joinPath(workspacePath, "experiments"),
            kind: "directory",
          });
        }
      } catch {
        // 无实验目录。
      }

      if (disposed) return;
      setRows(loaded);
      setScanned(true);
    })().catch((scanError: unknown) => {
      if (!disposed) onError(scanError instanceof Error ? scanError.message : String(scanError));
    });

    return () => {
      disposed = true;
    };
  }, [workspacePath, fileService, reloadKey, onError, intl]);

  // 目录行展开：拉一层子文件（目录不再下钻）。
  useEffect(() => {
    if (!expandedDir) {
      setDirChildren([]);
      return undefined;
    }
    let disposed = false;
    void (async () => {
      try {
        const entries = await fileService.readdir({ path: expandedDir });
        if (disposed) return;
        const children = entries
          .filter((entry) => entry.type === "file")
          .map((entry) => ({
            label: "",
            detail: entry.path.split("/").slice(-2).join("/"),
            path: entry.path,
            kind: "file" as const,
          }));
        setDirChildren(children);
      } catch {
        if (!disposed) setDirChildren([]);
      }
    })().catch(() => {
      if (!disposed) setDirChildren([]);
    });
    return () => {
      disposed = true;
    };
  }, [expandedDir, fileService]);

  const renderRow = (row: DeliverableRow, inGroup = false) => {
    const isExpandedDir = row.kind === "directory" && expandedDir === row.path;
    return (
      <div key={row.path}>
        <div className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
          <button
            type="button"
            className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-input-border-focused"
            onClick={() => {
              if (row.kind === "directory") {
                setExpandedDir(isExpandedDir ? null : row.path);
                setPreview(null);
              } else {
                setPreview({ path: row.path, name: row.detail.split("/").pop() ?? row.detail });
              }
            }}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-foreground-subtle">
              {row.kind === "directory" ? (
                isExpandedDir ? (
                  <ChevronDownIcon className="size-4" strokeWidth={1.33} aria-hidden />
                ) : (
                  <ChevronRightIcon className="size-4" strokeWidth={1.33} aria-hidden />
                )
              ) : (
                <FileDisplayIcon
                  src={resolveFileDisplayDescriptor(row.path).fileIconSrc}
                  size={16}
                />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-ui-base font-medium text-foreground">
                {row.detail.split("/").pop() ?? row.detail}
              </span>
              {!inGroup ? (
                <span className="mt-0.5 block truncate text-ui-sm text-foreground-subtle">
                  {row.label || row.detail}
                </span>
              ) : (
                <span className="mt-0.5 block truncate text-ui-sm text-foreground-subtle">
                  {row.detail.split("/").slice(0, -1).join("/") || row.detail}
                </span>
              )}
            </span>
          </button>
          <span className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground-subtlest opacity-0 transition-opacity group-hover:opacity-100"
              aria-label={intl.formatMessage({ id: "research.deliverables.pathCopiedHint" })}
              onClick={() =>
                void copyPrompt(
                  row.path,
                  intl.formatMessage({ id: "research.deliverables.pathCopied" }),
                )
              }
            >
              <ClipboardCopyIcon className="size-3.5" strokeWidth={1.33} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-foreground-subtlest opacity-0 transition-opacity group-hover:opacity-100"
              aria-label={intl.formatMessage({ id: "research.deliverables.preview" })}
              onClick={() => {
                if (row.kind === "file") {
                  setPreview({ path: row.path, name: row.detail.split("/").pop() ?? row.detail });
                }
              }}
            >
              <EyeIcon className="size-3.5" strokeWidth={1.33} />
            </Button>
          </span>
        </div>
        {isExpandedDir
          ? dirChildren.map((child) => (
              <div key={child.path}>
                <div className="h-px bg-border/50" aria-hidden />
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-4 py-2 pl-12 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-input-border-focused"
                  onClick={() =>
                    setPreview({
                      path: child.path,
                      name: child.detail.split("/").pop() ?? child.detail,
                    })
                  }
                >
                  <FileDisplayIcon
                    src={resolveFileDisplayDescriptor(child.path).fileIconSrc}
                    size={14}
                    className="shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtle">
                    {child.detail.split("/").pop() ?? child.detail}
                  </span>
                  <EyeIcon
                    className="size-3.5 shrink-0 text-foreground-subtlest"
                    strokeWidth={1.33}
                  />
                </button>
              </div>
            ))
          : null}
      </div>
    );
  };

  // 按 label 分组（保持扫描顺序），组内条目进官方资源列表。
  const groupedRows = useMemo(() => {
    const groups: Array<{ label: string; items: DeliverableRow[] }> = [];
    for (const row of rows) {
      const last = groups[groups.length - 1];
      if (last && last.label === row.label) {
        last.items.push(row);
      } else {
        groups.push({ label: row.label, items: [row] });
      }
    }
    return groups;
  }, [rows]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-6 pt-5">
        <h1 className="text-ui-xl font-semibold text-foreground">
          {intl.formatMessage({ id: "research.deliverables.tab" })}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-ui-sm"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RefreshCwIcon className="size-3.5" strokeWidth={1.33} />
            {intl.formatMessage({ id: "research.deliverables.rescan" })}
          </Button>
          <Button size="sm" className="h-8 px-2.5 text-ui-sm" onClick={() =>
            void copyPrompt(
              intl.formatMessage({ id: "research.deliverables.runSubmitPrompt" }),
              intl.formatMessage({ id: "research.promptCopied" }),
            )
          }>
            <ClipboardCopyIcon className="size-3.5" strokeWidth={1.33} />
            {intl.formatMessage({ id: "research.deliverables.runSubmit" })}
          </Button>
        </div>
      </div>
      {preview ? (
        <DeliverablePreview
          path={preview.path}
          name={preview.name}
          fileService={fileService}
          onClose={() => setPreview(null)}
          onError={onError}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-6 pb-8 pt-4">
          <div className="mx-auto w-full max-w-3xl">
            {groupedRows.map((group) => (
              <div key={group.label} className="mt-5 first:mt-0">
                <SettingsResourceGroupHeader
                  title={group.label}
                  count={group.items.length}
                />
                <div className="mt-2">
                  <SettingsResourceList
                    items={group.items}
                    getKey={(item) => item.path}
                    renderItem={(item) => renderRow(item, true)}
                  />
                </div>
              </div>
            ))}
            {scanned && rows.length === 0 ? (
              <div className="flex items-center justify-center rounded-xl border border-dashed border-card-border bg-background px-4 py-6 text-center text-ui-base text-foreground-subtle">
                {intl.formatMessage({ id: "research.deliverables.empty" })}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** 交付物预览浮层：PDF / 图片 / markdown 文档 / 文本 / zip 占位，全内嵌。 */
function DeliverablePreview({
  path,
  name,
  fileService,
  onClose,
  onError,
}: {
  path: string;
  name: string;
  fileService: FileServiceLike;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const { intl } = useZCodeIntl();
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [zipInfo, setZipInfo] = useState<{ size: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    setImageDataUrl(null);
    setPdfBytes(null);
    setMarkdown(null);
    setText(null);
    setZipInfo(null);
    setFailed(false);
    const extension = fileExtension(name);
    void (async () => {
      try {
        if (IMAGE_EXTENSIONS.has(extension)) {
          const media = await fileService.readMediaPreview({ path, maxBytes: 8 * 1024 * 1024 });
          if (!disposed) {
            setImageDataUrl(`data:${media.mediaType};base64,${media.dataBase64}`);
          }
        } else if (extension === "pdf") {
          const whole = await readWholeFile(fileService, path, OVERLAY_PDF_MAX_BYTES);
          if (!disposed) {
            if (whole) setPdfBytes(whole);
            else setFailed(true);
          }
        } else if (extension === "md") {
          const slice = await fileService.readTextFile({ path, length: TEXT_PREVIEW_LIMIT_BYTES });
          if (!disposed) {
            if (slice.isBinary) setFailed(true);
            else setMarkdown(slice.content);
          }
        } else if (extension === "zip") {
          const stat = await fileService.stat({ path });
          if (!disposed) {
            if (typeof stat.size === "number") setZipInfo({ size: stat.size });
            else setFailed(true);
          }
        } else {
          const slice = await fileService.readTextFile({ path, length: TEXT_PREVIEW_LIMIT_BYTES });
          if (!disposed) {
            if (slice.isBinary) setFailed(true);
            else setText(slice.content);
          }
        }
      } catch {
        if (!disposed) setFailed(true);
      }
    })().catch((loadError: unknown) => {
      if (!disposed) onError(loadError instanceof Error ? loadError.message : String(loadError));
    });
    return () => {
      disposed = true;
    };
  }, [path, name, fileService, onError]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-card-border bg-card px-3 py-2">
        <EyeIcon className="size-3.5 shrink-0 text-foreground-subtle" strokeWidth={1.33} />
        <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-foreground" title={path}>
          {name}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={onClose}
          aria-label={intl.formatMessage({ id: "research.viewer.close" })}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {imageDataUrl ? (
          <img src={imageDataUrl} alt={name} className="mx-auto max-h-full object-contain" />
        ) : pdfBytes ? (
          <Suspense
            fallback={
              <div className="p-3 text-ui-sm text-foreground-subtlest">
                {intl.formatMessage({ id: "research.pdf.loading" })}
              </div>
            }
          >
            <PdfViewer source={pdfBytes} className="h-full" />
          </Suspense>
        ) : markdown != null ? (
          <div className="mx-auto max-w-3xl">{renderMarkdownDocument(markdown)}</div>
        ) : text != null ? (
          <pre className="font-mono text-ui-sm leading-relaxed whitespace-pre-wrap">{text}</pre>
        ) : zipInfo ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-card-border bg-background px-4 py-8 text-center text-ui-base text-foreground-subtle">
            <PackageIcon className="size-8 text-foreground-subtlest" strokeWidth={1.33} />
            <div>
              {intl.formatMessage(
                { id: "research.deliverables.zipInfo" },
                { size: (zipInfo.size / (1024 * 1024)).toFixed(1) },
              )}
            </div>
          </div>
        ) : failed ? (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-card-border bg-background px-4 py-6 text-center text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "research.viewer.unsupported" })}
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-card-border bg-background px-4 py-6 text-center text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "research.loading" })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 台架看板（tests/ 台架盘点 + 结果文档数据表可视化） ──

interface BenchItem {
  name: string;
  absPath: string;
  relPath: string;
  summary: string | null;
  resultRelPath: string | null;
  resultMtimeMs: number | null;
}

/** 结果文档迷你渲染：标题 / 段落 / markdown 数据表（首行表头，跳过分隔行）。 */
function renderBenchResult(content: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const lines = content.split("\n");
  let index = 0;
  let key = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        tableLines.push(lines[index]!.trim());
        index += 1;
      }
      const rows = tableLines
        .map((rowLine) =>
          rowLine
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim()),
        )
        .filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === ""));
      if (rows.length > 0) {
        nodes.push(
          <div key={key++} className="my-3 overflow-x-auto rounded-lg border border-card-border">
            <table className="w-full border-collapse text-ui-sm">
              <thead>
                <tr className="bg-hover/40">
                  {rows[0]!.map((cell, cellIndex) => (
                    <th
                      key={cellIndex}
                      className="border-b border-card-border px-2.5 py-1.5 text-left font-medium text-foreground-subtle"
                    >
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((cells, rowIndex) => (
                  <tr key={rowIndex} className="odd:bg-hover/15">
                    {cells.map((cell, cellIndex) => (
                      <td key={cellIndex} className="border-b border-card-border/60 px-2.5 py-1.5">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }
    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      nodes.push(
        <div
          key={key++}
          className={cn(
            "mt-4 mb-1 font-medium text-foreground",
            headingMatch[1]!.length <= 2 ? "text-ui-base" : "text-ui-sm",
          )}
        >
          {headingMatch[2]}
        </div>,
      );
      index += 1;
      continue;
    }
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() !== "" &&
      !lines[index]!.trim().startsWith("|") &&
      !lines[index]!.match(/^#{1,4}\s+/)
    ) {
      paragraphLines.push(lines[index]!);
      index += 1;
    }
    nodes.push(
      <p key={key++} className="my-1.5 text-ui-sm leading-relaxed text-foreground-subtle">
        {paragraphLines.join(" ")}
      </p>,
    );
  }
  return nodes;
}

function BenchBoard({
  workspacePath,
  fileService,
  watcher,
  onError,
  copyPrompt,
}: {
  workspacePath: string;
  fileService: FileServiceLike;
  watcher: WatcherServiceLike | undefined;
  onError: (message: string | null) => void;
  copyPrompt: CopyPromptFn;
}) {
  const { intl } = useZCodeIntl();
  const [benches, setBenches] = useState<BenchItem[]>([]);
  const [scanned, setScanned] = useState(false);
  const [selected, setSelected] = useState<BenchItem | null>(null);
  const [resultContent, setResultContent] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useDirChangeWatcher(
    joinPath(workspacePath, "tests"),
    watcher,
    useCallback(() => setReloadKey((key) => key + 1), []),
  );
  useDirChangeWatcher(
    joinPath(workspacePath, "docs"),
    watcher,
    useCallback(() => setReloadKey((key) => key + 1), []),
  );

  useEffect(() => {
    let disposed = false;
    onError(null);
    setBenches([]);
    setSelected(null);
    setResultContent(null);
    setScanned(false);

    void (async () => {
      let entries: FileEntry[];
      try {
        entries = await fileService.readdir({ path: joinPath(workspacePath, "tests") });
      } catch {
        if (!disposed) setScanned(true);
        return;
      }
      const loaded: BenchItem[] = [];
      for (const entry of entries) {
        if (entry.type !== "file" || !BENCH_FILE_PATTERN.test(entry.name)) continue;
        const stem = entry.name.replace(/\.py$/, "");
        const resultRelPath = `docs/${stem}_result.md`;
        let summary: string | null = null;
        try {
          const head = await fileService.readTextFile({ path: entry.path, length: 4096 });
          if (disposed) return;
          const docMatch = head.content.match(/"""([\s\S]*?)"""/);
          if (docMatch) {
            summary =
              docMatch[1]!
                .split("\n")
                .map((line) => line.trim())
                .find((line) => line.length > 0) ?? null;
          }
        } catch {
          // 读不到说明就不显示。
        }
        let resultMtimeMs: number | null = null;
        let resultExists = false;
        try {
          const stat = await fileService.stat({ path: joinPath(workspacePath, resultRelPath) });
          if (!disposed) {
            resultExists = stat.type === "file";
            resultMtimeMs = stat.mtimeMs ?? null;
          }
        } catch {
          // 无结果文档。
        }
        loaded.push({
          name: entry.name,
          absPath: entry.path,
          relPath: `tests/${entry.name}`,
          summary,
          resultRelPath: resultExists ? resultRelPath : null,
          resultMtimeMs: resultExists ? resultMtimeMs : null,
        });
      }
      loaded.sort((left, right) => {
        if ((left.resultMtimeMs ?? 0) !== (right.resultMtimeMs ?? 0)) {
          return (right.resultMtimeMs ?? 0) - (left.resultMtimeMs ?? 0);
        }
        return left.name.localeCompare(right.name);
      });
      if (disposed) return;
      setBenches(loaded);
      setScanned(true);
    })().catch((scanError: unknown) => {
      if (!disposed) onError(scanError instanceof Error ? scanError.message : String(scanError));
    });

    return () => {
      disposed = true;
    };
  }, [workspacePath, fileService, reloadKey, onError]);

  // 选中台架后加载其结果文档。
  useEffect(() => {
    let disposed = false;
    setResultContent(null);
    if (!selected?.resultRelPath) return undefined;
    void (async () => {
      try {
        const text = await fileService.readTextFile({
          path: joinPath(workspacePath, selected.resultRelPath!),
          length: 512 * 1024,
        });
        if (!disposed) setResultContent(text.content);
      } catch {
        if (!disposed) setResultContent(null);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [selected, workspacePath, fileService]);

  const runPromptFor = (bench: BenchItem) =>
    intl.formatMessage({ id: "research.bench.runPrompt" }, { path: bench.relPath });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
        <span className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "research.bench.count" }, { count: benches.length })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 px-2.5 text-ui-sm"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" strokeWidth={1.33} />
          {intl.formatMessage({ id: "research.bench.rescan" })}
        </Button>
      </div>
      {selected ? (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ActivityIcon className="size-4 shrink-0 text-primary" strokeWidth={1.33} />
            <span className="truncate text-ui-base font-medium" title={selected.relPath}>
              {selected.name}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 shrink-0 text-ui-sm"
              onClick={() => setSelected(null)}
            >
              {intl.formatMessage({ id: "research.figures.back" })}
            </Button>
            <Button
              size="sm"
              className="h-7 shrink-0 text-ui-sm"
              onClick={() =>
                void copyPrompt(
                  runPromptFor(selected),
                  intl.formatMessage({ id: "research.promptCopied" }),
                )
              }
            >
              <PlayIcon className="size-3.5" strokeWidth={1.33} />
              {intl.formatMessage({ id: "research.bench.run" })}
            </Button>
          </div>
          {selected.summary ? (
            <div className="mt-1 truncate text-ui-sm text-foreground-subtlest" title={selected.summary}>
              {selected.summary}
            </div>
          ) : null}
          <div className="mt-2 min-h-0 flex-1 overflow-auto rounded-[10px] border border-card-border bg-card px-3.5 py-3">
            {selected.resultRelPath == null ? (
              <div className="p-3 text-ui-sm text-foreground-subtlest">
                {intl.formatMessage({ id: "research.bench.noResult" })}
              </div>
            ) : resultContent != null ? (
              renderBenchResult(resultContent)
            ) : (
              <div className="flex items-center gap-2 p-3 text-ui-sm text-foreground-subtlest">
                <Spinner className="size-3.5" />
                {intl.formatMessage({ id: "research.loading" })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          <div className="mx-auto w-full max-w-3xl">
            {benches.map((bench) => (
              <button
                key={bench.absPath}
                type="button"
                className="mb-2 flex w-full items-start gap-3 rounded-[10px] border border-card-border bg-card px-3 py-3 text-left transition-colors hover:border-primary/50"
                onClick={() => setSelected(bench)}
              >
                <ActivityIcon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    bench.resultRelPath ? "text-primary" : "text-foreground-subtlest",
                  )}
                  strokeWidth={1.33}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-ui-base font-medium">{bench.name}</span>
                    {bench.resultMtimeMs ? (
                      <span className="ml-auto shrink-0 text-ui-sm text-foreground-subtlest">
                        {intl.formatMessage(
                          { id: "research.bench.resultAt" },
                          { time: new Date(bench.resultMtimeMs).toLocaleString() },
                        )}
                      </span>
                    ) : null}
                  </div>
                  {bench.summary ? (
                    <div className="mt-0.5 line-clamp-2 text-ui-sm text-foreground-subtle">
                      {bench.summary}
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
            {scanned && benches.length === 0 ? (
              <div className="p-3 text-ui-sm text-foreground-subtlest">
                {intl.formatMessage({ id: "research.bench.empty" })}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
