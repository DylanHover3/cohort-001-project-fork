import { useState } from "react";
import { useFetcher } from "react-router";
import {
  AlertCircle,
  Check,
  Loader2,
  Lock,
  NotebookPen,
  Save,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { cn, formatRelativeTime } from "~/lib/utils";
import {
  describeNoteEditor,
  type NoteEditorView,
  type NoteStatus,
} from "~/modules/note-editor";

/** The Student's private Note on a Lesson, shown on the Lesson page. */
export function LessonNote({
  note,
}: {
  note: { body: string; updatedAt: string } | null | undefined;
}) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [draft, setDraft] = useState(note?.body ?? "");
  const error = fetcher.data?.error;
  const view = describeNoteEditor({
    draft,
    savedBody: note?.body ?? null,
    isSaving: fetcher.state !== "idle",
    error,
    maxLength: MAX_NOTE_LENGTH,
  });

  return (
    <Card className="mb-8 gap-0 overflow-hidden py-0">
      <NoteHeader status={view.status} />

      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="save-note" />
        <div className="px-5 py-4">
          <Textarea
            name="body"
            aria-label="Your notes"
            aria-invalid={view.overLimit || Boolean(error)}
            aria-describedby="note-character-count note-cleared-hint"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              // The error was about the text the user is now changing.
              if (error) fetcher.reset();
            }}
            placeholder="Jot down key ideas, questions, or anything you want to remember from this lesson."
            className="min-h-36 resize-y bg-background leading-relaxed"
          />
          <NoteMessage cleared={view.cleared} error={error} />
        </div>

        <NoteFooter view={view} updatedAt={note?.updatedAt} />
      </fetcher.Form>
    </Card>
  );
}

function NoteMessage({
  cleared,
  error,
}: {
  cleared: boolean;
  error: string | undefined;
}) {
  if (error) {
    return (
      <p
        role="alert"
        className="mt-2 flex items-center gap-1.5 text-sm text-destructive"
      >
        <AlertCircle className="size-4 shrink-0" />
        {error}
      </p>
    );
  }
  if (!cleared) return null;
  return (
    <p id="note-cleared-hint" className="mt-2 text-sm text-muted-foreground">
      A note can&apos;t be empty. Write something to save it.
    </p>
  );
}

function NoteHeader({ status }: { status: NoteStatus }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <NotebookPen className="size-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold leading-tight">Your notes</h2>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" />
            Private. Only you can read this.
          </p>
        </div>
      </div>
      <NoteStatusBadge status={status} />
    </div>
  );
}

function NoteFooter({
  view,
  updatedAt,
}: {
  view: NoteEditorView;
  updatedAt: string | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t bg-muted/40 px-5 py-3">
      <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
        <span
          id="note-character-count"
          className={cn(
            "tabular-nums",
            view.nearLimit && "text-amber-600 dark:text-amber-500",
            view.overLimit && "font-medium text-destructive"
          )}
        >
          {view.characterCount.toLocaleString("en")} /{" "}
          {MAX_NOTE_LENGTH.toLocaleString("en")}
        </span>
        {updatedAt && (
          <>
            <span aria-hidden className="text-border">
              |
            </span>
            <span suppressHydrationWarning className="truncate">
              Last edited {formatRelativeTime(updatedAt)}
            </span>
          </>
        )}
      </div>
      <Button type="submit" size="sm" disabled={!view.canSave}>
        {view.status === "saving" ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Save />
        )}
        {view.status === "saving" ? "Saving..." : "Save note"}
      </Button>
    </div>
  );
}

const statusBadges: Record<
  Exclude<NoteStatus, "empty">,
  { label: string; className: string; icon: React.ReactNode }
> = {
  saved: {
    label: "Saved",
    className:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
    icon: <Check className="size-3" />,
  },
  unsaved: {
    label: "Unsaved changes",
    className:
      "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
    icon: <span className="size-1.5 rounded-full bg-current" />,
  },
  saving: {
    label: "Saving",
    className: "bg-muted text-muted-foreground",
    icon: <Loader2 className="size-3 animate-spin" />,
  },
  error: {
    label: "Not saved",
    className: "bg-destructive/10 text-destructive",
    icon: <AlertCircle className="size-3" />,
  },
};

function NoteStatusBadge({ status }: { status: NoteStatus }) {
  if (status === "empty") return null;
  const badge = statusBadges[status];

  return (
    <output
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        badge.className
      )}
    >
      {badge.icon}
      {badge.label}
    </output>
  );
}
