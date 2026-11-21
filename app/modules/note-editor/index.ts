import { describe } from "./lib/describe";
import type { NoteEditorInput, NoteEditorView } from "./lib/describe";

export type {
  NoteStatus,
  NoteEditorInput,
  NoteEditorView,
} from "./lib/describe";

/**
 * What the Note editor on the Lesson page shows for the Student's draft:
 * its save status, the character count against the limit, and whether Save
 * is worth pressing.
 */
export function describeNoteEditor(input: NoteEditorInput): NoteEditorView {
  return describe(input);
}
