import { describe, it, expect } from "vitest";
import { describeNoteEditor, type NoteEditorInput } from "../index";

const base: NoteEditorInput = {
  draft: "",
  savedBody: null,
  isSaving: false,
  error: undefined,
  maxLength: 100,
};

function view(overrides: Partial<NoteEditorInput>) {
  return describeNoteEditor({ ...base, ...overrides });
}

describe("describeNoteEditor status", () => {
  it("is empty when nothing is written or saved", () => {
    expect(view({}).status).toBe("empty");
  });

  it("is unsaved when a new draft has text", () => {
    expect(view({ draft: "hello" }).status).toBe("unsaved");
  });

  it("is saved when the draft matches the saved body", () => {
    expect(view({ draft: "hello", savedBody: "hello" }).status).toBe("saved");
  });

  it("ignores surrounding whitespace the server trims away", () => {
    expect(view({ draft: "  hello \n", savedBody: "hello" }).status).toBe(
      "saved"
    );
  });

  it("is unsaved when the draft differs from the saved body", () => {
    expect(view({ draft: "hello!", savedBody: "hello" }).status).toBe(
      "unsaved"
    );
  });

  it("is unsaved when a saved note is cleared", () => {
    expect(view({ draft: "", savedBody: "hello" }).status).toBe("unsaved");
  });

  it("shows saving over everything else", () => {
    expect(view({ draft: "x", isSaving: true, error: "Nope" }).status).toBe(
      "saving"
    );
  });

  it("shows an error over unsaved changes", () => {
    expect(view({ draft: "x", error: "Nope" }).status).toBe("error");
  });
});

describe("describeNoteEditor character count", () => {
  it("counts the trimmed draft", () => {
    expect(view({ draft: "  abc  " }).characterCount).toBe(3);
  });

  it("is neither near nor over the limit with room to spare", () => {
    const v = view({ draft: "a".repeat(89) });
    expect(v.nearLimit).toBe(false);
    expect(v.overLimit).toBe(false);
  });

  it("is near the limit with a tenth of the allowance left", () => {
    const v = view({ draft: "a".repeat(90) });
    expect(v.nearLimit).toBe(true);
    expect(v.overLimit).toBe(false);
  });

  it("is near, not over, exactly at the limit", () => {
    const v = view({ draft: "a".repeat(100) });
    expect(v.nearLimit).toBe(true);
    expect(v.overLimit).toBe(false);
  });

  it("is over, not near, past the limit", () => {
    const v = view({ draft: "a".repeat(101) });
    expect(v.overLimit).toBe(true);
    expect(v.nearLimit).toBe(false);
  });
});

describe("describeNoteEditor cleared", () => {
  it("is cleared when a saved note is emptied", () => {
    expect(view({ draft: " ", savedBody: "hello" }).cleared).toBe(true);
  });

  it("is not cleared when there was nothing saved", () => {
    expect(view({ draft: "" }).cleared).toBe(false);
  });

  it("is not cleared while the draft has text", () => {
    expect(view({ draft: "hi", savedBody: "hello" }).cleared).toBe(false);
  });
});

describe("describeNoteEditor canSave", () => {
  it("allows saving a changed draft", () => {
    expect(view({ draft: "hello" }).canSave).toBe(true);
  });

  it("allows saving a draft exactly at the limit", () => {
    expect(view({ draft: "a".repeat(100) }).canSave).toBe(true);
  });

  it("blocks saving an empty draft", () => {
    expect(view({ draft: "   " }).canSave).toBe(false);
  });

  it("blocks saving a cleared note, which the server would reject", () => {
    expect(view({ draft: "  ", savedBody: "hello" }).canSave).toBe(false);
  });

  it("blocks saving an unchanged note", () => {
    expect(view({ draft: "hello", savedBody: "hello" }).canSave).toBe(false);
  });

  it("blocks saving past the limit", () => {
    expect(view({ draft: "a".repeat(101) }).canSave).toBe(false);
  });

  it("blocks saving while a save is in flight", () => {
    expect(view({ draft: "hello", isSaving: true }).canSave).toBe(false);
  });

  it("allows retrying after an error", () => {
    expect(view({ draft: "hello", error: "Nope" }).canSave).toBe(true);
  });
});
