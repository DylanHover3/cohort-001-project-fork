import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./bookmarks-notes.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 10, 16, 12, 0, 0);
const LATER = new Date(2026, 10, 16, 13, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;
let otherStudentId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;

  otherLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 2", position: 2 })
    .returning()
    .get().id;

  otherStudentId = db
    .insert(schema.users)
    .values({
      name: "Other Student",
      email: "other@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get().id;
});

describe("toggling a Bookmark", () => {
  it("adds a Bookmark the first time and removes it the second", () => {
    expect(toggleBookmark(db, base.user.id, lessonId)).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonId)).toBe(true);

    expect(toggleBookmark(db, base.user.id, lessonId)).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonId)).toBe(false);
  });

  it("leaves another Student's Bookmark on the same Lesson alone", () => {
    toggleBookmark(db, otherStudentId, lessonId);
    toggleBookmark(db, base.user.id, lessonId);
    toggleBookmark(db, base.user.id, lessonId);

    expect(isBookmarked(db, otherStudentId, lessonId)).toBe(true);
  });
});

describe("saving a Note", () => {
  it("creates the Note, then replaces its body on the next save", () => {
    saveNote(db, base.user.id, lessonId, "first", NOW);
    const updated = saveNote(db, base.user.id, lessonId, "second", LATER);

    expect(updated?.body).toBe("second");
    expect(updated?.createdAt).toBe(NOW.toISOString());
    expect(updated?.updatedAt).toBe(LATER.toISOString());
    expect(db.select().from(schema.notes).all()).toHaveLength(1);
  });

  it("deletes the Note when the body is empty", () => {
    saveNote(db, base.user.id, lessonId, "something", NOW);

    expect(saveNote(db, base.user.id, lessonId, "", LATER)).toBeNull();
    expect(getNote(db, base.user.id, lessonId)).toBeUndefined();
  });

  it("does not show one Student's Note to another", () => {
    saveNote(db, base.user.id, lessonId, "mine", NOW);

    expect(getNote(db, otherStudentId, lessonId)).toBeUndefined();
    expect(listNotes(db, otherStudentId)).toEqual([]);
  });
});

describe("listing a Student's Bookmarks and Notes", () => {
  it("returns Notes most recently edited first, with course and module", () => {
    saveNote(db, base.user.id, lessonId, "older", NOW);
    saveNote(db, base.user.id, otherLessonId, "newer", LATER);

    const listed = listNotes(db, base.user.id);

    expect(listed.map((note) => note.body)).toEqual(["newer", "older"]);
    expect(listed[0]).toMatchObject({
      lessonTitle: "Lesson 2",
      moduleTitle: "Basics",
      courseTitle: "Test Course",
      courseSlug: "test-course",
    });
  });

  it("returns only the Student's own Bookmarks", () => {
    toggleBookmark(db, base.user.id, lessonId);
    toggleBookmark(db, otherStudentId, otherLessonId);

    expect(
      listBookmarks(db, base.user.id).map((bookmark) => bookmark.lessonId)
    ).toEqual([lessonId]);
  });
});
