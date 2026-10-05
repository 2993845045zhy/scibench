import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import {
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import type { FileEntry } from "@zcode/shared";
import type { PdfViewerLabels, PdfViewerSource } from "@/components/ui/pdf-viewer.js";

// react-pdf 体积大，沿用 PreviewPane 的懒加载策略：首次用到才进 bundle。
const PdfViewer = lazy(() =>
  import("@/components/ui/pdf-viewer.js").then((module) => ({
    default: module.PdfViewer,
  })),
);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const TEX_SOURCE_LIMIT_BYTES = 128 * 1024;
const META_LIMIT_BYTES = 16 * 1024;
const FIGURE_SCAN_DEPTH = 2;
const PDF_FULL_READ_MAX_BYTES = 8 * 1024 * 1024;

function joinPath(base: string, rel: string): string {
  const cleanRel = rel.replace(/^\/+/, "");
  return `${base.replace(/\/+$/, "")}/${cleanRel}`;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * 科研面板（停靠形态）：挂在聊天主视图右侧，边对话边看。
 * 与整页 ResearchWorkbench（主视图形态）共用目录约定与数据逻辑；
 * 此处为紧凑布局：Tab 切换 + LaTeX 上下堆叠。
 */
export function ResearchPane({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
}: {
  workspacePath: string;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
}) {
  const { intl } = useZCodeIntl();
  const { fileService } = useWorkspaceServices(workspacePath, remoteSessionId, workspaceIdentity);
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FlaskConicalIcon className="size-4 shrink-0 text-primary" />
        <span className="text-ui-sm font-medium">
          {intl.formatMessage({ id: "research.paneTitle" })}
        </span>
        <span className="ml-auto truncate text-ui-xs text-muted-foreground" title={workspacePath}>
          {workspacePath}
        </span>
      </div>
      {error ? (
        <div className="border-b border-border bg-destructive/10 px-3 py-2 text-ui-xs break-all text-destructive">
          {error}
        </div>
      ) : null}
      {toast ? (
        <div className="border-b border-border bg-primary/10 px-3 py-2 text-ui-xs text-primary">
          {toast}
        </div>
      ) : null}
      <Tabs defaultValue="latex" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="mx-3 mt-2 self-start">
          <TabsTrigger value="latex">
            <FileTextIcon className="size-3.5" />
            {intl.formatMessage({ id: "research.latex.tab" })}
          </TabsTrigger>
          <TabsTrigger value="figures">
            <ImageIcon className="size-3.5" />
            {intl.formatMessage({ id: "research.figures.tab" })}
          </TabsTrigger>
          <TabsTrigger value="experiments">
            <ListIcon className="size-3.5" />
            {intl.formatMessage({ id: "research.experiments.tab" })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="latex" className="min-h-0">
          <LatexWorkbench
            workspacePath={workspacePath}
            fileService={fileService}
            onError={setError}
            copyPrompt={copyPrompt}
          />
        </TabsContent>
        <TabsContent value="figures" className="min-h-0">
          <FiguresGallery
            workspacePath={workspacePath}
            fileService={fileService}
            onError={setError}
            copyPrompt={copyPrompt}
          />
        </TabsContent>
        <TabsContent value="experiments" className="min-h-0">
          <ExperimentsList workspacePath={workspacePath} fileService={fileService} onError={setError} />
        </TabsContent>
      </Tabs>
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
  onError,
  copyPrompt,
}: {
  workspacePath: string;
  fileService: FileServiceLike;
  onError: (message: string | null) => void;
  copyPrompt: CopyPromptFn;
}) {
  const { intl } = useZCodeIntl();
  const [texRelPath, setTexRelPath] = useState("paper/main.tex");
  const [source, setSource] = useState<string | null>(null);
  const [sourceMissing, setSourceMissing] = useState(false);
  const [pdfSource, setPdfSource] = useState<PdfViewerSource | null>(null);
  const [pdfMissing, setPdfMissing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const texAbsPath = joinPath(workspacePath, texRelPath);
  const pdfAbsPath = texAbsPath.replace(/\.tex$/, ".pdf");

  useEffect(() => {
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
            requestRange: (offset, length) => fileService.readFileRange({ path: pdfAbsPath, offset, length }),
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <Input
          value={texRelPath}
          onChange={(event) => setTexRelPath(event.target.value)}
          className="h-7 text-ui-xs"
          spellCheck={false}
          aria-label={intl.formatMessage({ id: "research.latex.pathLabel" })}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2 text-ui-xs"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.latex.reload" })}
        </Button>
        <Button
          size="sm"
          className="h-7 shrink-0 px-2 text-ui-xs"
          onClick={() =>
            void copyPrompt(
              intl.formatMessage({ id: "research.latex.compilePrompt" }, { path: texRelPath }),
              intl.formatMessage({ id: "research.promptCopied" }),
            )
          }
        >
          <ClipboardCopyIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.latex.compile" })}
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-2 gap-2 px-3 pb-3">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border">
          <div className="border-b border-border bg-muted/40 px-2 py-1 text-ui-xs text-muted-foreground">
            {texRelPath}
          </div>
          <pre className="min-h-0 flex-1 overflow-auto p-2 font-mono text-ui-xs leading-relaxed">
            {sourceMissing
              ? intl.formatMessage({ id: "research.latex.sourceMissing" })
              : (source ?? intl.formatMessage({ id: "research.loading" }))}
          </pre>
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-2 py-1 text-ui-xs text-muted-foreground">
            <span>{pdfAbsPath === texAbsPath ? `${texRelPath}.pdf` : pdfAbsPath.split("/").pop()}</span>
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
  onError,
  copyPrompt,
}: {
  workspacePath: string;
  fileService: FileServiceLike;
  onError: (message: string | null) => void;
  copyPrompt: CopyPromptFn;
}) {
  const { intl } = useZCodeIntl();
  const [figures, setFigures] = useState<FigureItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<FigureItem | null>(null);
  const [comment, setComment] = useState("");
  const [scanned, setScanned] = useState(false);
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
        if (found.length > 0) break;
      }
      if (disposed) return;
      setFigures(found);
      setScanned(true);

      // 缩略图按需生成：仅前 24 张，避免大目录一次拉爆。
      for (const figure of found.slice(0, 24)) {
        try {
          const preview = await fileService.readMediaPreview({ path: figure.absPath, maxBytes: 2 * 1024 * 1024 });
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
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-ui-xs text-muted-foreground">
          {intl.formatMessage({ id: "research.figures.count" }, { count: figures.length })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-7 px-2 text-ui-xs"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.figures.rescan" })}
        </Button>
      </div>
      {selected ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/20">
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
              className="h-7 text-ui-xs"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 text-ui-xs"
              onClick={() => setSelected(null)}
            >
              {intl.formatMessage({ id: "research.figures.back" })}
            </Button>
            <Button
              size="sm"
              className="h-7 shrink-0 text-ui-xs"
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
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-3">
              <div className="mb-1 text-ui-xs font-medium text-muted-foreground">{group}/</div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                {items.map((figure) => (
                  <button
                    key={figure.absPath}
                    type="button"
                    className="flex flex-col overflow-hidden rounded-md border border-border transition-colors hover:border-primary/50"
                    onClick={() => setSelected(figure)}
                  >
                    <div className="flex h-24 items-center justify-center bg-muted/20">
                      {previews[figure.absPath] ? (
                        <img
                          src={previews[figure.absPath]}
                          alt={figure.relPath}
                          className="max-h-24 max-w-full object-contain"
                        />
                      ) : (
                        <ImageIcon className="size-5 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="truncate px-2 py-1 text-left text-ui-xs text-muted-foreground">
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
  onError,
}: {
  workspacePath: string;
  fileService: FileServiceLike;
  onError: (message: string | null) => void;
}) {
  const { intl } = useZCodeIntl();
  const [cards, setCards] = useState<ExperimentCard[]>([]);
  const [scanned, setScanned] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
      for (const dirName of directories.slice(0, 50)) {
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
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-ui-xs text-muted-foreground">
          {intl.formatMessage({ id: "research.experiments.count" }, { count: cards.length })}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-7 px-2 text-ui-xs"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RefreshCwIcon className="size-3.5" />
          {intl.formatMessage({ id: "research.experiments.rescan" })}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {cards.map((card) => (
          <div key={card.dirName} className="mb-2 rounded-md border border-border p-2">
            <div className="flex items-center gap-2">
              <span className="truncate text-ui-sm font-medium" title={card.title}>
                {card.title}
              </span>
              {card.verdict ? (
                <Badge variant={VERDICT_BADGE_VARIANT[card.verdict] ?? "outline"} className="ml-auto">
                  {card.verdict}
                </Badge>
              ) : null}
            </div>
            <div className="mt-0.5 text-ui-xs text-muted-foreground">{card.dirName}</div>
            {card.snippet ? (
              <div className="mt-1 line-clamp-2 text-ui-xs text-muted-foreground/80">{card.snippet}</div>
            ) : null}
          </div>
        ))}
        {scanned && cards.length === 0 ? (
          <div className="p-3 text-ui-xs text-muted-foreground">
            {intl.formatMessage({ id: "research.experiments.empty" })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
