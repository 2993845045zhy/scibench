import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardCopyIcon,
  EraserIcon,
  FileIcon,
  FileTextIcon,
  FlaskConicalIcon,
  FolderIcon,
  HistoryIcon,
  ImageIcon,
  ListIcon,
  PackageIcon,
  RefreshCwIcon,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.js";
import { Spinner } from "@/components/ui/spinner.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
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

type ResearchSection = "latex" | "figures" | "experiments" | "literature" | "deliverables";

const SECTIONS: Array<{
  id: ResearchSection;
  icon: typeof FileTextIcon;
  labelId: string;
}> = [
  { id: "latex", icon: FileTextIcon, labelId: "research.latex.tab" },
  { id: "figures", icon: ImageIcon, labelId: "research.figures.tab" },
  { id: "experiments", icon: ListIcon, labelId: "research.experiments.tab" },
  { id: "literature", icon: BookOpenIcon, labelId: "research.literature.tab" },
  { id: "deliverables", icon: PackageIcon, labelId: "research.deliverables.tab" },
];

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
  onBack,
}: {
  workspacePath: string;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
  onBack?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const { fileService, fileWatcherService } = useWorkspaceServices(
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
  );
  const [section, setSection] = useState<ResearchSection>("latex");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 文件树点击 .tex → 切到 LaTeX 页并切换目标（由 LatexWorkbench 消费后清空）。
  const [pendingTexRel, setPendingTexRel] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ path: string; name: string } | null>(null);

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
              className="h-7 gap-1.5 px-2 text-ui-xs"
              onClick={onBack}
            >
              <ArrowLeftIcon className="size-3.5" strokeWidth={1.33} />
              {intl.formatMessage({ id: "research.backToChat" })}
            </Button>
            <div className="h-4 w-px bg-card-border" aria-hidden />
          </>
        ) : null}
        <FlaskConicalIcon className="size-4 text-primary" strokeWidth={1.33} />
        <h1 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "research.title" })}
        </h1>
        <span
          className="ml-auto max-w-[40%] truncate text-ui-xs text-foreground-subtlest"
          title={workspacePath}
        >
          {workspacePath}
        </span>
      </header>
      {error ? (
        <div className="shrink-0 border-b border-card-border bg-destructive/10 px-4 py-2 text-ui-xs break-all text-destructive">
          {error}
        </div>
      ) : null}
      {toast ? (
        <div className="shrink-0 border-b border-card-border bg-primary/10 px-4 py-2 text-ui-xs text-primary">
          {toast}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-52 shrink-0 flex-col border-r border-card-border bg-sidebar/40">
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
          <div className="px-3 pt-2 pb-1 text-ui-xs font-medium text-foreground-subtlest">
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
                setViewer({ path, name });
              }}
            />
          </div>
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          {section === "latex" ? (
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
          className="py-0.5 text-ui-xs text-foreground-subtlest"
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          …
        </div>
      );
    }
    return entries.map((entry) => {
      const isDir = entry.type === "directory";
      const isOpen = expanded.has(entry.path);
      const extension = fileExtension(entry.name);
      const Icon = isDir
        ? FolderIcon
        : extension === "tex"
          ? FileTextIcon
          : IMAGE_EXTENSIONS.has(extension)
            ? ImageIcon
            : FileIcon;
      return (
        <div key={entry.path}>
          <button
            type="button"
            className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-ui-xs text-foreground-subtle hover:bg-hover hover:text-foreground"
            style={{ paddingLeft: 4 + depth * 12 }}
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
              isOpen ? (
                <ChevronDownIcon className="size-3 shrink-0 text-foreground-subtle" />
              ) : (
                <ChevronRightIcon className="size-3 shrink-0 text-foreground-subtle" />
              )
            ) : (
              <span className="w-3 shrink-0" aria-hidden />
            )}
            <Icon
              className={cn("size-3 shrink-0", isDir ? "text-primary/70" : "text-foreground-subtlest")}
            strokeWidth={1.33}
            />
            <span className="truncate">{entry.name}</span>
          </button>
          {isDir && isOpen ? renderEntries(entry.path, depth + 1) : null}
        </div>
      );
    });
  };

  return <div className="text-ui-xs">{renderEntries(workspacePath, 0)}</div>;
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
        <span className="truncate text-ui-xs font-medium" title={path}>
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
              <div className="p-3 text-ui-xs text-foreground-subtlest">
                {intl.formatMessage({ id: "research.pdf.loading" })}
              </div>
            }
          >
            <PdfViewer source={pdfBytes} className="h-full" />
          </Suspense>
        ) : text != null ? (
          <pre className="font-mono text-ui-xs leading-relaxed whitespace-pre-wrap">{text}</pre>
        ) : failed ? (
          <div className="p-3 text-ui-xs text-foreground-subtlest">
            {intl.formatMessage({ id: "research.viewer.unsupported" })}
          </div>
        ) : (
          <div className="p-3 text-ui-xs text-foreground-subtlest">
            {intl.formatMessage({ id: "research.loading" })}
          </div>
        )}
      </div>
    </div>
  );
}

interface FileServiceLike {
  readdir(params: { path: string; includeHidden?: boolean }): Promise<FileEntry[]>;
  stat(params: { path: string }): Promise<{ size?: number }>;
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
            className="w-72 text-ui-xs"
            aria-label={intl.formatMessage({ id: "research.latex.pathLabel" })}
          >
            <SelectValue placeholder={intl.formatMessage({ id: "research.loading" })} />
          </SelectTrigger>
          <SelectContent>
            {texFiles.map((file) => (
              <SelectItem key={file} value={file} className="text-ui-xs">
                {file}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 px-2.5 text-ui-xs"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.latex.reload" })}
        </Button>
        <Button
          size="sm"
          className="h-8 shrink-0 px-2.5 text-ui-xs"
          disabled={!texRelPath}
          onClick={() =>
            void copyPrompt(
              intl.formatMessage({ id: "research.latex.compilePrompt" }, { path: texRelPath ?? "" }),
              intl.formatMessage({ id: "research.promptCopied" }),
            )
          }
        >
          <ClipboardCopyIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.latex.compile" })}
        </Button>
        <span
          className="ml-auto text-ui-xs text-foreground-subtle"
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
          <div className="border-b border-card-border px-3 py-1.5 text-ui-xs text-foreground-subtle">
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
              <div className="p-3 text-ui-xs text-foreground-subtlest">
                {intl.formatMessage({ id: "research.latex.sourceMissing" })}
              </div>
            ) : source != null ? (
              <CodeViewer
                code={source}
                language="latex"
                enableSyntaxHighlighting
                showLineNumbers
                fontSizePx={12}
                className="h-full"
                markedLines={activeLine != null ? [activeLine] : undefined}
                scrollContainerRef={sourceScrollRef}
              />
            ) : (
              <div className="flex items-center gap-2 p-3 text-ui-xs text-foreground-subtlest">
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
          <div className="flex items-center gap-2 border-b border-card-border px-3 py-1.5 text-ui-xs text-foreground-subtle">
            <span>
              {pdfAbsPath === texAbsPath ? `${texRelPath}.pdf` : pdfAbsPath?.split("/").pop()}
            </span>
            <span className="ml-auto">{intl.formatMessage({ id: "research.pdf.preview" })}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {pdfMissing ? (
              <div className="p-3 text-ui-xs text-foreground-subtlest">
                {intl.formatMessage({ id: "research.pdf.missing" })}
              </div>
            ) : pdfSource ? (
              <Suspense
                fallback={
                  <div className="p-3 text-ui-xs text-foreground-subtlest">
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
              <div className="flex items-center gap-2 p-3 text-ui-xs text-foreground-subtlest">
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

// ── 图表库（图墙 + 图上圈注 + 版本历史指令） ──

interface FigureItem {
  absPath: string;
  relPath: string;
  group: string;
}

interface AnnotationRect {
  x: number;
  y: number;
  w: number;
  h: number;
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
  const [selected, setSelected] = useState<FigureItem | null>(null);
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
    setSelected(null);
    setScanned(false);

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
    const groups = new Map<string, FigureItem[]>();
    for (const figure of figures) {
      const list = groups.get(figure.group) ?? [];
      list.push(figure);
      groups.set(figure.group, list);
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "research.figures.count" }, { count: figures.length })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 px-2.5 text-ui-xs"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.figures.rescan" })}
        </Button>
      </div>
      {selected ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
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
              {previews[selected.absPath] ? (
                <img
                  src={previews[selected.absPath]}
                  alt={selected.relPath}
                  className="block max-h-[60vh] select-none object-contain"
                  draggable={false}
                />
              ) : (
                <div className="p-3 text-ui-xs text-foreground-subtlest">{selected.relPath}</div>
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
                  <span className="absolute -top-2 -left-2 flex size-4 items-center justify-center rounded-full bg-destructive text-ui-xs font-medium text-white">
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
              className="h-8 text-ui-xs"
            />
            {annotations.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 text-ui-xs"
                onClick={() => setAnnotations([])}
              >
                <EraserIcon className="size-3.5" />
                {intl.formatMessage({ id: "research.figures.clearAnnotations" })}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 text-ui-xs"
              onClick={() =>
                void copyPrompt(
                  intl.formatMessage(
                    { id: "research.figures.historyPrompt" },
                    { path: selected.relPath },
                  ),
                  intl.formatMessage({ id: "research.promptCopied" }),
                )
              }
            >
              <HistoryIcon className="size-3.5" />
              {intl.formatMessage({ id: "research.figures.history" })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 text-ui-xs"
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
              className="h-8 shrink-0 text-ui-xs"
              disabled={!comment.trim()}
              onClick={() => {
                const annotationText = describeAnnotations(annotations);
                const prompt = annotationText
                  ? intl.formatMessage(
                      { id: "research.figures.feedbackPromptWithRegions" },
                      { path: selected.relPath, comment: comment.trim(), regions: annotationText },
                    )
                  : intl.formatMessage(
                      { id: "research.figures.feedbackPrompt" },
                      { path: selected.relPath, comment: comment.trim() },
                    );
                void copyPrompt(prompt, intl.formatMessage({ id: "research.promptCopied" }));
              }}
            >
              <ClipboardCopyIcon className="size-3.5" />
              {intl.formatMessage({ id: "research.figures.sendFeedback" })}
            </Button>
          </div>
          <div className="text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: "research.figures.annotateHint" })}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          {grouped.map(([group, items]) => (
            <Collapsible key={group} defaultOpen className="mb-5">
              <CollapsibleTrigger className="group/collapsible mb-2 flex w-full items-center gap-1.5 text-ui-sm font-medium text-foreground-subtle">
                <ChevronDownIcon
                  className="size-3.5 shrink-0 transition-transform group-data-[state=closed]/collapsible:-rotate-90"
                  strokeWidth={1.33}
                />
                <span className="truncate">{group}/</span>
                <span className="shrink-0 text-ui-xs text-foreground-subtlest">{items.length}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid grid-cols-3 gap-3 xl:grid-cols-4 2xl:grid-cols-5">
                {items.map((figure) => (
                  <button
                    key={figure.absPath}
                    type="button"
                    className="flex flex-col overflow-hidden rounded-lg border border-card-border bg-card transition-colors hover:border-primary/50"
                    onClick={() => setSelected(figure)}
                  >
                    <div className="flex h-36 items-center justify-center bg-muted/20">
                      {previews[figure.absPath] ? (
                        <img
                          src={previews[figure.absPath]}
                          alt={figure.relPath}
                          className="max-h-36 max-w-full object-contain"
                        />
                      ) : (
                        <ImageIcon className="size-6 text-foreground-subtlest" strokeWidth={1.33} />
                      )}
                    </div>
                    <div className="truncate px-2.5 py-1.5 text-left text-ui-xs text-foreground-subtle">
                      {figure.relPath.split("/").pop()}
                    </div>
                  </button>
                ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
          {scanned && figures.length === 0 ? (
            <div className="p-3 text-ui-xs text-foreground-subtlest">
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
        <span className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "research.experiments.count" }, { count: cards.length })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 px-2.5 text-ui-xs"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.experiments.rescan" })}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
        <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-3 lg:grid-cols-2">
          {cards.map((card) => (
            <div key={card.dirName} className="rounded-[10px] border border-card-border bg-card px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="truncate text-ui-sm font-medium" title={card.title}>
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
              <div className="mt-1 text-ui-xs text-foreground-subtle">{card.dirName}</div>
              {card.snippet ? (
                <div className="mt-1.5 line-clamp-2 text-ui-xs text-foreground-subtlest">
                  {card.snippet}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {scanned && cards.length === 0 ? (
          <div className="p-3 text-ui-xs text-foreground-subtlest">
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
      // docs/lit/ 没有条目时兜底：docs/papers/ 的本地 PDF 整组列出（文件名即题名）。
      if (loaded.length === 0) {
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
          if (pdfPapers.length > 0) loaded.push({ slug: pdfPapers[0]!.slug, papers: pdfPapers });
        } catch {
          // docs/papers/ 不存在：保持空态。
        }
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
        <span className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "research.literature.count" }, { count: totalPapers })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 px-2.5 text-ui-xs"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.literature.rescan" })}
        </Button>
        <Button
          size="sm"
          className="h-8 px-2.5 text-ui-xs"
          onClick={() =>
            void copyPrompt(
              intl.formatMessage({ id: "research.literature.continuePrompt" }),
              intl.formatMessage({ id: "research.promptCopied" }),
            )
          }
        >
          <ClipboardCopyIcon className="size-3.5" />
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
                  <div className="truncate text-ui-sm" title={paper.title}>
                    {paper.title}
                  </div>
                  <div className="truncate text-ui-xs text-foreground-subtle">
                    {[paper.authors, paper.year].filter(Boolean).join(" · ") || paper.slug}
                  </div>
                </button>
              ))}
            </div>
          ))}
          {scanned && totalPapers === 0 ? (
            <div className="p-3 text-ui-xs text-foreground-subtlest">
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
                <div className="mt-1 truncate text-ui-xs text-foreground-subtle">
                  {[selectedPaper.authors, selectedPaper.year].filter(Boolean).join(" · ") ||
                    selectedPaper.slug}
                </div>
                <div className="mt-1 truncate text-ui-xs text-foreground-subtlest">
                  {selectedPaper.sourceFile}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                {selectedPaper.kind === "pdf" ? (
                  <>
                    <Button
                      size="sm"
                      className="h-7 text-ui-xs"
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
                      className="h-7 text-ui-xs"
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
                      <ClipboardCopyIcon className="size-3.5" />
                      {intl.formatMessage({ id: "research.literature.read" })}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      className="h-7 text-ui-xs"
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
                      className="h-7 text-ui-xs"
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
                      <ClipboardCopyIcon className="size-3.5" />
                      {intl.formatMessage({ id: "research.literature.findFulltext" })}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-ui-xs"
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
                      <ClipboardCopyIcon className="size-3.5" />
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
                        <div className="p-3 text-ui-xs text-foreground-subtlest">
                          {intl.formatMessage({ id: "research.pdf.loading" })}
                        </div>
                      }
                    >
                      <PdfViewer source={pdfBytes} className="h-full" />
                    </Suspense>
                  ) : (
                    <div className="flex items-center gap-2 p-3 text-ui-xs text-foreground-subtlest">
                      <Spinner className="size-3.5" />
                      {intl.formatMessage({ id: "research.pdf.loading" })}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-ui-xs text-foreground-subtle">
              {intl.formatMessage({ id: "research.literature.selectHint" })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 交付物中心（投稿包 / 评审记录 / 文献调研 / 实验证据） ──

interface DeliverableRow {
  label: string;
  detail: string;
  path: string;
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
          loaded.push({ label, detail: `${dirRel}/${entry.name}`, path: entry.path });
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
          });
        }
      } catch {
        // 无文献调研。
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "research.deliverables.count" }, { count: rows.length })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 px-2.5 text-ui-xs"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.deliverables.rescan" })}
        </Button>
        <Button
          size="sm"
          className="h-8 px-2.5 text-ui-xs"
          onClick={() =>
            void copyPrompt(
              intl.formatMessage({ id: "research.deliverables.runSubmitPrompt" }),
              intl.formatMessage({ id: "research.promptCopied" }),
            )
          }
        >
          <ClipboardCopyIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.deliverables.runSubmit" })}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
        <div className="mx-auto w-full max-w-3xl">
          {rows.map((row) => (
            <button
              key={row.path}
              type="button"
              className="mb-2 flex w-full items-center gap-3 rounded-[10px] border border-card-border bg-card px-3 py-3 text-left transition-colors hover:border-primary/50"
              onClick={() =>
                void copyPrompt(
                  row.path,
                  intl.formatMessage({ id: "research.deliverables.pathCopied" }),
                )
              }
              title={intl.formatMessage({ id: "research.deliverables.pathCopiedHint" })}
            >
              <PackageIcon className="size-4 shrink-0 text-foreground-subtle" strokeWidth={1.33} />
              <div className="min-w-0">
                <div className="truncate text-ui-sm">{row.detail}</div>
                <div className="truncate text-ui-xs text-foreground-subtle">{row.label}</div>
              </div>
            </button>
          ))}
          {scanned && rows.length === 0 ? (
            <div className="p-3 text-ui-xs text-foreground-subtlest">
              {intl.formatMessage({ id: "research.deliverables.empty" })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
