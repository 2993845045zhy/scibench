import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ClipboardCopyIcon,
  FileTextIcon,
  FlaskConicalIcon,
  ImageIcon,
  ListIcon,
  RefreshCwIcon,
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

type ResearchSection = "latex" | "figures" | "experiments";

const SECTIONS: Array<{
  id: ResearchSection;
  icon: typeof FileTextIcon;
  labelId: string;
}> = [
  { id: "latex", icon: FileTextIcon, labelId: "research.latex.tab" },
  { id: "figures", icon: ImageIcon, labelId: "research.figures.tab" },
  { id: "experiments", icon: ListIcon, labelId: "research.experiments.tab" },
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

/**
 * 科研工作台（ClawsGO 形态：顶栏 + 左侧导航 + 大内容区；视觉沿用 ZCode 设计系统）。
 * 作为右侧面板渲染：与对话同屏共写；onBack 仅在整页嵌入时提供，面板形态不渲染返回按钮。
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {onBack ? (
          <>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-ui-xs" onClick={onBack}>
              <ArrowLeftIcon className="size-3.5" />
              {intl.formatMessage({ id: "research.backToChat" })}
            </Button>
            <div className="h-4 w-px bg-border" aria-hidden />
          </>
        ) : null}
        <FlaskConicalIcon className="size-4 text-primary" />
        <h1 className="text-ui-base font-medium">{intl.formatMessage({ id: "research.title" })}</h1>
        <span
          className="ml-auto max-w-[40%] truncate text-ui-xs text-muted-foreground"
          title={workspacePath}
        >
          {workspacePath}
        </span>
      </header>
      {error ? (
        <div className="border-b border-border bg-destructive/10 px-4 py-2 text-ui-xs break-all text-destructive">
          {error}
        </div>
      ) : null}
      {toast ? (
        <div className="border-b border-border bg-primary/10 px-4 py-2 text-ui-xs text-primary">
          {toast}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-40 shrink-0 flex-col gap-1 border-r border-border p-2">
          {SECTIONS.map(({ id, icon: SectionIcon, labelId }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-ui-sm transition-colors",
                section === id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
              aria-current={section === id ? "page" : undefined}
            >
              <SectionIcon className="size-4 shrink-0" />
              {intl.formatMessage({ id: labelId })}
            </button>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1">
          {section === "latex" ? (
            <LatexWorkbench
              workspacePath={workspacePath}
              fileService={fileService}
              watcher={fileWatcherService}
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
          ) : (
            <ExperimentsList
              workspacePath={workspacePath}
              fileService={fileService}
              watcher={fileWatcherService}
              onError={setError}
            />
          )}
        </div>
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

function LatexWorkbench({
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
  const [texFiles, setTexFiles] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const [texRelPath, setTexRelPath] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [sourceMissing, setSourceMissing] = useState(false);
  const [pdfSource, setPdfSource] = useState<PdfViewerSource | null>(null);
  const [pdfMissing, setPdfMissing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
          let offset = 0;
          const chunks: Uint8Array[] = [];
          while (offset < fileStat.size) {
            const chunk = await fileService.readFileRange({
              path: pdfAbsPath,
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
          if (!disposed) setPdfSource(whole);
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

  if (discovered && texFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md text-center text-ui-sm text-muted-foreground">
          {intl.formatMessage({ id: "research.latex.noFiles" })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Select
          value={texRelPath ?? undefined}
          onValueChange={(value) => setTexRelPath(value)}
        >
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
              intl.formatMessage(
                { id: "research.latex.compilePrompt" },
                { path: texRelPath ?? "" },
              ),
              intl.formatMessage({ id: "research.promptCopied" }),
            )
          }
        >
          <ClipboardCopyIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.latex.compile" })}
        </Button>
        <span className="ml-auto text-ui-xs text-muted-foreground">
          {intl.formatMessage({ id: "research.latex.autoHint" })}
        </span>
      </div>
      {/* 整页形态：源码与 PDF 左右并排（窄面板时代是上下堆叠） */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 px-4 pb-4">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-ui-xs text-muted-foreground">
            {texRelPath}
          </div>
          <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-ui-xs leading-relaxed">
            {sourceMissing
              ? intl.formatMessage({ id: "research.latex.sourceMissing" })
              : (source ?? intl.formatMessage({ id: "research.loading" }))}
          </pre>
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-ui-xs text-muted-foreground">
            <span>{pdfAbsPath === texAbsPath ? `${texRelPath}.pdf` : pdfAbsPath?.split("/").pop()}</span>
            <span className="ml-auto">{intl.formatMessage({ id: "research.pdf.preview" })}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {pdfMissing ? (
              <div className="p-3 text-ui-xs text-muted-foreground">
                {intl.formatMessage({ id: "research.pdf.missing" })}
              </div>
            ) : pdfSource ? (
              <Suspense
                fallback={
                  <div className="p-3 text-ui-xs text-muted-foreground">
                    {intl.formatMessage({ id: "research.pdf.loading" })}
                  </div>
                }
              >
                <PdfViewer source={pdfSource} labels={pdfLabels} className="h-full" />
              </Suspense>
            ) : (
              <div className="p-3 text-ui-xs text-muted-foreground">
                {intl.formatMessage({ id: "research.loading" })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface FigureItem {
  absPath: string;
  relPath: string;
  group: string;
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
      if (disposed) return;
      setFigures(found);
      setScanned(true);

      // 缩略图按需生成：仅前 40 张，整页形态放宽上限但仍防大目录拖垮。
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="text-ui-xs text-muted-foreground">
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
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-muted/20">
            {previews[selected.absPath] ? (
              <img
                src={previews[selected.absPath]}
                alt={selected.relPath}
                className="mx-auto max-h-full object-contain"
              />
            ) : (
              <div className="p-3 text-ui-xs text-muted-foreground">{selected.relPath}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={intl.formatMessage({ id: "research.figures.commentPlaceholder" })}
              className="h-8 text-ui-xs"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 text-ui-xs"
              onClick={() => setSelected(null)}
            >
              {intl.formatMessage({ id: "research.figures.back" })}
            </Button>
            <Button
              size="sm"
              className="h-8 shrink-0 text-ui-xs"
              disabled={!comment.trim()}
              onClick={() =>
                void copyPrompt(
                  intl.formatMessage(
                    { id: "research.figures.feedbackPrompt" },
                    { path: selected.relPath, comment: comment.trim() },
                  ),
                  intl.formatMessage({ id: "research.promptCopied" }),
                )
              }
            >
              <ClipboardCopyIcon className="size-3.5" />
              {intl.formatMessage({ id: "research.figures.sendFeedback" })}
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-5">
              <div className="mb-2 text-ui-sm font-medium text-muted-foreground">{group}/</div>
              <div className="grid grid-cols-3 gap-3 xl:grid-cols-4 2xl:grid-cols-5">
                {items.map((figure) => (
                  <button
                    key={figure.absPath}
                    type="button"
                    className="flex flex-col overflow-hidden rounded-lg border border-border transition-colors hover:border-primary/50"
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
                        <ImageIcon className="size-6 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="truncate px-2.5 py-1.5 text-left text-ui-xs text-muted-foreground">
                      {figure.relPath.split("/").pop()}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {scanned && figures.length === 0 ? (
            <div className="p-3 text-ui-xs text-muted-foreground">
              {intl.formatMessage({ id: "research.figures.empty" })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

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
        <span className="text-ui-xs text-muted-foreground">
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
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-3 lg:grid-cols-2">
          {cards.map((card) => (
            <div key={card.dirName} className="rounded-lg border border-border p-3.5">
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
              <div className="mt-1 text-ui-xs text-muted-foreground">{card.dirName}</div>
              {card.snippet ? (
                <div className="mt-1.5 line-clamp-2 text-ui-xs text-muted-foreground/80">
                  {card.snippet}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {scanned && cards.length === 0 ? (
          <div className="p-3 text-ui-xs text-muted-foreground">
            {intl.formatMessage({ id: "research.experiments.empty" })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
