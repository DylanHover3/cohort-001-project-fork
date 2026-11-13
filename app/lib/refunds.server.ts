import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  comments,
  coupons,
  courseRatings,
  courses,
  enrollments,
  LessonProgressStatus,
  lessonProgress,
  lessons,
  modules,
  purchases,
  RefundStatus,
  refunds,
  users,
  videoWatchEvents,
} from "~/db/schema";
import { formatPrice } from "~/lib/utils";

// ─── Refund Requests ───
// See GLOSSARY.md (Refunds) and docs/adr/0001 for the rules this module
// enforces. Uses positional parameters (project convention).

export type RefundRequestProgress = {
  completedLessons: number;
  totalLessons: number;
  watchedSeconds: number;
};

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

/**
 * The learner's progress on a course since a Purchase was made. Activity from
 * before the Purchase is ignored, so a learner who was refunded and bought
 * again starts the new Purchase from zero for the refund limits.
 */
export function getProgressSincePurchase(
  userId: number,
  courseId: number,
  purchasedAt: string
): RefundRequestProgress {
  const lessonIds = getLessonIdsForCourse(courseId);

  if (lessonIds.length === 0) {
    return { completedLessons: 0, totalLessons: 0, watchedSeconds: 0 };
  }

  const completed = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds),
        gte(lessonProgress.completedAt, purchasedAt)
      )
    )
    .get();

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds),
        gte(videoWatchEvents.createdAt, purchasedAt)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return {
    completedLessons: completed?.count ?? 0,
    totalLessons: lessonIds.length,
    watchedSeconds: furthestPerLesson.reduce(
      (total, row) => total + row.furthest,
      0
    ),
  };
}

function isTeamPurchase(purchaseId: number): boolean {
  return !!db
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();
}

/**
 * True once a Refund Request on this Purchase has been Approved. A team
 * Purchase's unclaimed seat coupons cannot be redeemed after that.
 */
export function isPurchaseRefunded(purchaseId: number): boolean {
  return !!db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        eq(refunds.purchaseId, purchaseId),
        eq(refunds.status, RefundStatus.Approved)
      )
    )
    .get();
}

/**
 * Every Refund Request still waiting on an admin, oldest first, with what the
 * admin needs to decide.
 */
export function listRequestedRefundRequests() {
  const rows = db
    .select({
      id: refunds.id,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      purchaseId: purchases.id,
      purchasedAt: purchases.createdAt,
      refundableAmount: purchases.amountPaid,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.status, RefundStatus.Requested))
    .orderBy(asc(refunds.requestedAt), asc(refunds.id))
    .all();

  return rows.map((row) => ({
    ...row,
    isTeamPurchase: isTeamPurchase(row.purchaseId),
    progress: getProgressSincePurchase(
      row.learnerId,
      row.courseId,
      row.purchasedAt
    ),
  }));
}

export class RefundRequestNotOpenError extends Error {
  constructor() {
    super("This refund request has already been approved or declined.");
  }
}

function getRequestedRefundRequest(refundRequestId: number) {
  const row = db
    .select({
      id: refunds.id,
      status: refunds.status,
      purchaseId: purchases.id,
      refundableAmount: purchases.amountPaid,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.id, refundRequestId))
    .get();

  if (!row) return undefined;
  if (row.status !== RefundStatus.Requested) {
    throw new RefundRequestNotOpenError();
  }
  return row;
}

export type RefundRequestOutcome = {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  refundableAmount: number;
  isTeamPurchase: boolean;
};

/**
 * Approves a Requested Refund Request and ends the access its Purchase
 * granted. Returns undefined when there is no such Refund Request.
 */
export function approveRefundRequest(
  refundRequestId: number,
  adminUserId: number
): RefundRequestOutcome | undefined {
  return db.transaction((tx) => {
    const request = getRequestedRefundRequest(refundRequestId);
    if (!request) return undefined;

    const now = new Date().toISOString();

    tx.update(refunds)
      .set({
        status: RefundStatus.Approved,
        amountRefunded: request.refundableAmount,
        resolvedAt: now,
        resolvedByUserId: adminUserId,
      })
      .where(eq(refunds.id, request.id))
      .run();

    const teamPurchase = isTeamPurchase(request.purchaseId);

    // A team Purchase never gave the buyer access; its unclaimed seats are
    // what it granted, and isPurchaseRefunded stops those being redeemed.
    if (!teamPurchase) {
      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, request.learnerId),
            eq(enrollments.courseId, request.courseId)
          )
        )
        .run();

      tx.delete(courseRatings)
        .where(
          and(
            eq(courseRatings.userId, request.learnerId),
            eq(courseRatings.courseId, request.courseId)
          )
        )
        .run();

      const lessonIds = getLessonIdsForCourse(request.courseId);
      if (lessonIds.length > 0) {
        tx.update(comments)
          .set({ deletedAt: now })
          .where(
            and(
              eq(comments.userId, request.learnerId),
              inArray(comments.lessonId, lessonIds),
              isNull(comments.deletedAt)
            )
          )
          .run();
      }
    }

    return {
      learnerName: request.learnerName,
      learnerEmail: request.learnerEmail,
      courseTitle: request.courseTitle,
      refundableAmount: request.refundableAmount,
      isTeamPurchase: teamPurchase,
    };
  });
}

/**
 * Declines a Requested Refund Request. Nothing else changes. Returns
 * undefined when there is no such Refund Request.
 */
export function declineRefundRequest(
  refundRequestId: number,
  adminUserId: number
): RefundRequestOutcome | undefined {
  return db.transaction((tx) => {
    const request = getRequestedRefundRequest(refundRequestId);
    if (!request) return undefined;

    tx.update(refunds)
      .set({
        status: RefundStatus.Declined,
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: adminUserId,
      })
      .where(eq(refunds.id, request.id))
      .run();

    return {
      learnerName: request.learnerName,
      learnerEmail: request.learnerEmail,
      courseTitle: request.courseTitle,
      refundableAmount: request.refundableAmount,
      isTeamPurchase: isTeamPurchase(request.purchaseId),
    };
  });
}

/**
 * The email the learner gets once an admin has decided. There is no mail
 * transport wired up yet, so callers log the built message.
 */
export function buildRefundOutcomeEmail(
  status: RefundStatus.Approved | RefundStatus.Declined,
  outcome: RefundRequestOutcome
) {
  const greeting = `Hi ${outcome.learnerName},`;
  const signOff = "— The Cadence team";

  if (status === RefundStatus.Approved) {
    const accessLine = outcome.isTeamPurchase
      ? "The unclaimed seats from this purchase can no longer be redeemed. Seats that were already claimed are not affected."
      : `Your access to "${outcome.courseTitle}" has ended. Your progress is saved, so if you buy the course again you can pick up where you left off.`;

    return {
      to: outcome.learnerEmail,
      subject: `Refund approved — ${outcome.courseTitle}`,
      body: [
        greeting,
        "",
        `Your refund request for "${outcome.courseTitle}" has been approved.`,
        `We will refund ${formatPrice(outcome.refundableAmount)}, the amount you paid.`,
        "",
        accessLine,
        "",
        signOff,
      ].join("\n"),
    };
  }

  return {
    to: outcome.learnerEmail,
    subject: `Refund declined — ${outcome.courseTitle}`,
    body: [
      greeting,
      "",
      `Your refund request for "${outcome.courseTitle}" has been declined, so no refund will be made.`,
      "",
      outcome.isTeamPurchase
        ? "Your purchase and its seats are unchanged."
        : `You still have full access to "${outcome.courseTitle}".`,
      "",
      signOff,
    ].join("\n"),
  };
}

