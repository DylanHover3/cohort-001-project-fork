import { and, desc, eq } from "drizzle-orm";
import type { Db } from "~/lib/comments.server";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";

// ─── Bookmarks and Notes ───
// A Student's private flag on a Lesson, and their private writing about it.
// One of each per Student per Lesson. See GLOSSARY.md for the language.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type Note = typeof notes.$inferSelect;

export function isBookmarked(db: Db, studentId: number, lessonId: number) {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(
      and(eq(bookmarks.userId, studentId), eq(bookmarks.lessonId, lessonId))
    )
    .get();
}

/** Adds the Bookmark if it is missing, removes it if present. Returns the new state. */
export function toggleBookmark(
  db: Db,
  studentId: number,
  lessonId: number
): boolean {
  const removed = db
    .delete(bookmarks)
    .where(
      and(eq(bookmarks.userId, studentId), eq(bookmarks.lessonId, lessonId))
    )
    .returning({ id: bookmarks.id })
    .all();

  if (removed.length > 0) return false;

  db.insert(bookmarks).values({ userId: studentId, lessonId }).run();
  return true;
}

export function getNote(
  db: Db,
  studentId: number,
  lessonId: number
): Note | undefined {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId)))
    .get();
}

/**
 * Writes the Student's Note on a Lesson, creating it or replacing its body.
 * An empty body deletes the Note, and returns null.
 */
export function saveNote(
  db: Db,
  studentId: number,
  lessonId: number,
  body: string,
  now: Date
): Note | null {
  if (body.length === 0) {
    db.delete(notes)
      .where(and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId)))
      .run();
    return null;
  }

  const timestamp = now.toISOString();
  return db
    .insert(notes)
    .values({
      userId: studentId,
      lessonId,
      body,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body, updatedAt: timestamp },
    })
    .returning()
    .get();
}

const lessonRefColumns = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  moduleTitle: modules.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

/** The Student's Bookmarks, newest first, with the Lesson's course and module. */
export function listBookmarks(db: Db, studentId: number) {
  return db
    .select({
      id: bookmarks.id,
      createdAt: bookmarks.createdAt,
      ...lessonRefColumns,
    })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, studentId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
}

/** The Student's Notes, most recently edited first, with the Lesson's course and module. */
export function listNotes(db: Db, studentId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...lessonRefColumns,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, studentId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
