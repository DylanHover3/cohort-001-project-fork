import { useEffect, useState } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/admin.refund-requests";
import { db } from "~/db";
import { RefundStatus, UserRole, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  approveRefundRequest,
  buildRefundOutcomeEmail,
  declineRefundRequest,
  listRequestedRefundRequests,
  RefundRequestNotOpenError,
} from "~/lib/refunds.server";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { AlertTriangle, ReceiptText } from "lucide-react";

const refundDecisionSchema = z.object({
  intent: z.enum(["approve", "decline"]),
  refundRequestId: z.coerce.number().int(),
});

export function meta() {
  return [{ title: "Refund Requests — Cadence" }];
}

async function requireAdmin(request: Request): Promise<number> {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to review refund requests.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can review refund requests.", { status: 403 });
  }

  return currentUserId;
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return { refundRequests: listRequestedRefundRequests() };
}

export async function action({ request }: Route.ActionArgs) {
  const adminUserId = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundDecisionSchema);

  if (!parsed.success) {
    throw data("Invalid decision.", { status: 400 });
  }

  const { intent, refundRequestId } = parsed.data;

  let outcome;
  try {
    outcome =
      intent === "approve"
        ? approveRefundRequest(refundRequestId, adminUserId)
        : declineRefundRequest(refundRequestId, adminUserId);
  } catch (error) {
    if (error instanceof RefundRequestNotOpenError) {
      throw data(error.message, { status: 409 });
    }
    throw error;
  }

  if (!outcome) {
    throw data("Refund request not found.", { status: 404 });
  }

  const email = buildRefundOutcomeEmail(
    intent === "approve" ? RefundStatus.Approved : RefundStatus.Declined,
    outcome
  );

  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);

  return { decided: intent };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatWatchTime(seconds: number) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

type RefundRequestRow = Route.ComponentProps["loaderData"]["refundRequests"][number];

function RefundRequestCard({ refundRequest }: { refundRequest: RefundRequestRow }) {
  const fetcher = useFetcher<typeof action>();
  const [isConfirmingApproval, setIsConfirmingApproval] = useState(false);
  const isSubmitting = fetcher.state !== "idle";
  const { progress } = refundRequest;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    toast.success(
      fetcher.data.decided === "approve"
        ? "Refund request approved."
        : "Refund request declined."
    );
  }, [fetcher.state, fetcher.data]);

  function decide(intent: "approve" | "decline") {
    fetcher.submit(
      { intent, refundRequestId: String(refundRequest.id) },
      { method: "post" }
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">{refundRequest.learnerName}</p>
            <p className="text-sm text-muted-foreground">
              {refundRequest.learnerEmail}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">
              {formatPrice(refundRequest.refundableAmount)}
            </p>
            <p className="text-xs text-muted-foreground">Refundable Amount</p>
          </div>
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Course
            </p>
            <Link
              to={`/courses/${refundRequest.courseSlug}`}
              className="font-medium hover:underline"
            >
              {refundRequest.courseTitle}
            </Link>
            {refundRequest.isTeamPurchase && (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                Team purchase
              </span>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Progress since purchase
            </p>
            <p>
              {progress.completedLessons}/{progress.totalLessons} lessons
              completed · {formatWatchTime(progress.watchedSeconds)} watched
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Purchased
            </p>
            <p>{formatDate(refundRequest.purchasedAt)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Requested
            </p>
            <p>{formatDate(refundRequest.requestedAt)}</p>
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Reason
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{refundRequest.reason}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {isConfirmingApproval ? (
            <>
              <p className="mr-2 text-sm">
                {refundRequest.isTeamPurchase
                  ? "Approve? The unclaimed seats will stop working. This cannot be undone."
                  : "Approve? The learner loses access to this course. This cannot be undone."}
              </p>
              <Button
                size="sm"
                disabled={isSubmitting}
                onClick={() => decide("approve")}
              >
                {isSubmitting ? "Approving..." : "Confirm approval"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isSubmitting}
                onClick={() => setIsConfirmingApproval(false)}
              >
                Back
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                disabled={isSubmitting}
                onClick={() => setIsConfirmingApproval(true)}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => decide("decline")}
              >
                {isSubmitting ? "Declining..." : "Decline"}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminRefundRequests({ loaderData }: Route.ComponentProps) {
  const { refundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Refund requests waiting for review, oldest first
        </p>
      </div>

      {refundRequests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              No refund requests are waiting for review.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {refundRequests.map((refundRequest) => (
            <RefundRequestCard key={refundRequest.id} refundRequest={refundRequest} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refund requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
    } else if (error.status === 403) {
      title = "Access denied";
    } else {
      title = `Error ${error.status}`;
    }
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
