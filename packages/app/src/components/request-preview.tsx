"use client";

import { useState } from "react";
import { SLOT_GRAMMAR } from "@/lib/compose/grammar";
import { serializeRequest } from "@/lib/compose/request";
import type { ComposePrompt, RecommendationRequest } from "@/lib/compose/types";

type Tab = "request" | "system" | "user";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "request", label: "Request envelope" },
  { id: "system", label: "System prompt" },
  { id: "user", label: "User prompt" },
];

export function RequestPreview({
  request,
  prompt,
  nonce,
}: {
  request: RecommendationRequest;
  prompt: ComposePrompt;
  nonce: number;
}) {
  const [tab, setTab] = useState<Tab>("request");

  const bodies: Record<Tab, string> = {
    request: JSON.stringify(serializeRequest(request), null, 2),
    system: prompt.system,
    user: prompt.user,
  };

  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-medium">What would be sent</h2>
          <p className="text-xs text-muted">
            Assembled locally. Nothing has been sent anywhere.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge label="promptVersion" value={prompt.promptVersion} />
          <Badge label="nonce" value={String(nonce)} />
        </div>
      </header>

      {SLOT_GRAMMAR.provisional && (
        <div className="border-b border-border bg-warn/5 px-5 py-3">
          <p className="text-xs text-warn">
            <strong>Slot grammar is provisional.</strong> It is included in the
            prompt verbatim, but F1 Q2 is unsettled — settle it against the
            forked bytecode before the validator is built against this table.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            {SLOT_GRAMMAR.provisionalReason}
          </p>
        </div>
      )}

      <nav className="flex gap-1 border-b border-border px-3 pt-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-md px-3 py-2 text-xs transition-colors ${
              tab === t.id
                ? "bg-surface-2 text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto pb-2">
          <CopyButton text={bodies[tab]} />
        </div>
      </nav>

      <pre className="max-h-[28rem] overflow-auto bg-surface-2 p-5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/90">
        {bodies[tab]}
      </pre>
    </section>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-border px-2 py-1 text-[11px] text-muted">
      {label} <span className="font-mono text-foreground">{value}</span>
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-muted hover:text-foreground"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
