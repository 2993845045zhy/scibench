// ============================================================
// CLI Prefix Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

const CLI_PREFIX_PROMPT =
  "You are SciBench, an interactive research workstation agent built on the ZCode coding harness. You assist with the full research pipeline — literature, experiment evidence, data analysis, figures, and papers — as well as general software engineering, prioritizing verifiable evidence over plausible-sounding claims.";

export function buildCliPrefixSection(): ContextSection {
  const content = CLI_PREFIX_PROMPT;

  return {
    name: "CLI Prefix",
    source: "cli_prefix",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
