import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";

let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, prop) {
        const value = Reflect.get(testDb, prop);
        return typeof value === "function" ? value.bind(testDb) : value;
      },
    }
  ),
}));

const {
  approveRefundRequest,
  buildRefundOutcomeEmail,
  declineRefundRequest,
  getProgressSincePurchase,
  isPurchaseRefunded,
  listRequestedRefundRequests,
  RefundRequestNotOpenError,
} = await import("./refunds.server");

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

let base: ReturnType<typeof seedBaseData>;
let admin: typeof schema.users.$inferSelect;
let lessonIds: number[];

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);

  admin = testDb
    .insert(schema.users)
    .values({ name: "Admin", email: "admin@example.com", role: schema.UserRole.Admin })
    .returning()
    .get();

  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "M1", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2, 3, 4].map(
    (position) =>
      testDb
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: `L${position}`, position })
        .returning()
        .get().id
  );
});

function buyIndividually(purchasedAt = daysAgo(3), amountPaid = 2500) {
  testDb
    .insert(schema.enrollments)
    .values({ userId: base.user.id, courseId: base.course.id })
    .run();
  return testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid,
      createdAt: purchasedAt,
    })
    .returning()
    .get();
}

function requestRefund(purchaseId: number) {
  return testDb
    .insert(schema.refunds)
    .values({ purchaseId, reason: "Not what I expected" })
    .returning()
    .get();
}

function getRefund(id: number) {
  return testDb.select().from(schema.refunds).where(eq(schema.refunds.id, id)).get();
}

function isEnrolled() {
  return !!testDb
    .select()
    .from(schema.enrollments)
    .where(
      and(
        eq(schema.enrollments.userId, base.user.id),
        eq(schema.enrollments.courseId, base.course.id)
      )
    )
    .get();
}

describe("getProgressSincePurchase", () => {
  it("ignores lessons completed and video watched before the purchase", () => {
    const purchasedAt = daysAgo(3);

    testDb
      .insert(schema.lessonProgress)
      .values([
        {
          userId: base.user.id,
          lessonId: lessonIds[0],
          status: schema.LessonProgressStatus.Completed,
          completedAt: daysAgo(30),
        },
        {
          userId: base.user.id,
          lessonId: lessonIds[1],
          status: schema.LessonProgressStatus.Completed,
          completedAt: daysAgo(1),
        },
      ])
      .run();

    testDb
      .insert(schema.videoWatchEvents)
      .values([
        {
          userId: base.user.id,
          lessonId: lessonIds[0],
          eventType: "progress",
          positionSeconds: 5000,
          createdAt: daysAgo(30),
        },
        {
          userId: base.user.id,
          lessonId: lessonIds[1],
          eventType: "progress",
          positionSeconds: 300,
          createdAt: daysAgo(1),
        },
      ])
      .run();

    expect(
      getProgressSincePurchase(base.user.id, base.course.id, purchasedAt)
    ).toEqual({ completedLessons: 1, totalLessons: 4, watchedSeconds: 300 });
  });
});

describe("listRequestedRefundRequests", () => {
  it("lists only Requested refund requests, with the amount actually paid", () => {
    const purchase = buyIndividually(daysAgo(3), 1234);
    const open = requestRefund(purchase.id);
    testDb
      .insert(schema.refunds)
      .values({
        purchaseId: purchase.id,
        reason: "Already handled",
        status: schema.RefundStatus.Declined,
      })
      .run();

    const rows = listRequestedRefundRequests();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: open.id,
      refundableAmount: 1234,
      learnerEmail: base.user.email,
      courseTitle: base.course.title,
      isTeamPurchase: false,
      progress: { completedLessons: 0, totalLessons: 4, watchedSeconds: 0 },
    });
  });
});

describe("approveRefundRequest", () => {
  it("ends access, removes the rating and comments, and keeps progress", () => {
    const purchase = buyIndividually();
    const refund = requestRefund(purchase.id);

    testDb
      .insert(schema.courseRatings)
      .values({ userId: base.user.id, courseId: base.course.id, rating: 1 })
      .run();
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: lessonIds[0],
        status: schema.LessonProgressStatus.Completed,
        completedAt: daysAgo(1),
      })
      .run();
    const comment = testDb
      .insert(schema.comments)
      .values({ userId: base.user.id, lessonId: lessonIds[0], body: "Meh" })
      .returning()
      .get();

    const outcome = approveRefundRequest(refund.id, admin.id);

    expect(outcome).toMatchObject({ refundableAmount: 2500, isTeamPurchase: false });
    expect(getRefund(refund.id)).toMatchObject({
      status: schema.RefundStatus.Approved,
      amountRefunded: 2500,
      resolvedByUserId: admin.id,
    });
    expect(isEnrolled()).toBe(false);
    expect(testDb.select().from(schema.courseRatings).all()).toHaveLength(0);
    expect(
      testDb.select().from(schema.comments).where(eq(schema.comments.id, comment.id)).get()
        ?.deletedAt
    ).not.toBeNull();
    expect(testDb.select().from(schema.lessonProgress).all()).toHaveLength(1);
    expect(isPurchaseRefunded(purchase.id)).toBe(true);
  });

  it("leaves the buyer's own access alone for a team purchase", () => {
    buyIndividually(daysAgo(10));
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const teamPurchase = testDb
      .insert(schema.purchases)
      .values({ userId: base.user.id, courseId: base.course.id, amountPaid: 9000 })
      .returning()
      .get();
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "SEAT-1",
        purchaseId: teamPurchase.id,
      })
      .run();
    testDb
      .insert(schema.courseRatings)
      .values({ userId: base.user.id, courseId: base.course.id, rating: 5 })
      .run();
    const refund = requestRefund(teamPurchase.id);

    const outcome = approveRefundRequest(refund.id, admin.id);

    expect(outcome?.isTeamPurchase).toBe(true);
    expect(isEnrolled()).toBe(true);
    expect(testDb.select().from(schema.courseRatings).all()).toHaveLength(1);
    expect(isPurchaseRefunded(teamPurchase.id)).toBe(true);
  });

  it("refuses a refund request that has already been decided", () => {
    const refund = requestRefund(buyIndividually().id);
    declineRefundRequest(refund.id, admin.id);

    expect(() => approveRefundRequest(refund.id, admin.id)).toThrow(
      RefundRequestNotOpenError
    );
    expect(isEnrolled()).toBe(true);
  });

  it("returns undefined for an unknown refund request", () => {
    expect(approveRefundRequest(999, admin.id)).toBeUndefined();
  });
});

describe("declineRefundRequest", () => {
  it("marks it Declined and changes nothing else", () => {
    const purchase = buyIndividually();
    const refund = requestRefund(purchase.id);

    declineRefundRequest(refund.id, admin.id);

    expect(getRefund(refund.id)).toMatchObject({
      status: schema.RefundStatus.Declined,
      amountRefunded: null,
      resolvedByUserId: admin.id,
    });
    expect(isEnrolled()).toBe(true);
    expect(isPurchaseRefunded(purchase.id)).toBe(false);
  });
});

describe("buildRefundOutcomeEmail", () => {
  const outcome = {
    learnerName: "Sam",
    learnerEmail: "sam@example.com",
    courseTitle: "TypeScript",
    refundableAmount: 2500,
    isTeamPurchase: false,
  };

  it("tells an approved learner the amount and that access has ended", () => {
    const email = buildRefundOutcomeEmail(schema.RefundStatus.Approved, outcome);
    expect(email.subject).toBe("Refund approved — TypeScript");
    expect(email.body).toContain("$25.00");
    expect(email.body).toContain("access");
  });

  it("tells a declined learner they keep access", () => {
    const email = buildRefundOutcomeEmail(schema.RefundStatus.Declined, outcome);
    expect(email.subject).toBe("Refund declined — TypeScript");
    expect(email.body).toContain("still have full access");
  });
});
