export type NoteStatus = "empty" | "saved" | "unsaved" | "saving" | "error";

export type NoteEditorInput = {
  draft: string;
  savedBody: string | null;
  isSaving: boolean;
  error: string | undefined;
  maxLength: number;
};

export type NoteEditorView = {
  status: NoteStatus;
  characterCount: number;
  nearLimit: boolean;
  overLimit: boolean;
  // A saved note emptied in the editor: the server refuses an empty note.
  cleared: boolean;
  canSave: boolean;
};

// The warning starts when a tenth of the allowance is left.
const NEAR_LIMIT_SHARE = 0.1;

export function describe(input: NoteEditorInput): NoteEditorView {
  // The server trims before it stores, so compare and count what it will keep.
  const kept = input.draft.trim();
  const characterCount = kept.length;
  const overLimit = characterCount > input.maxLength;
  const nearLimit =
    !overLimit &&
    input.maxLength - characterCount <= input.maxLength * NEAR_LIMIT_SHARE;
  const dirty = kept !== (input.savedBody ?? "");

  return {
    status: statusOf(input, dirty),
    characterCount,
    nearLimit,
    overLimit,
    cleared: dirty && characterCount === 0,
    canSave: !input.isSaving && dirty && characterCount > 0 && !overLimit,
  };
}

function statusOf(input: NoteEditorInput, dirty: boolean): NoteStatus {
  if (input.isSaving) return "saving";
  if (input.error) return "error";
  if (dirty) return "unsaved";
  return input.savedBody === null ? "empty" : "saved";
}
