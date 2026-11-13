# An approved Refund Request removes the enrollment but keeps progress

When an admin approves a Refund Request on an individual Purchase, we delete the learner's enrollment (which is what grants access) but keep their lesson progress, watch history, and quiz attempts; only their rating and their comments on that course are removed. Keeping progress means a learner who buys again picks up where they left off and instructor analytics stay accurate. Because a re-buyer would otherwise carry their old watch time into the refund limits and never qualify again, the limits only count activity since the Purchase being refunded. Approval is final: there is no undo, and getting back in means buying again.

## Considered Options

- **Keep the enrollment and add a "revoked" flag.** Rejected: every access check reads enrollment existence, and a flag would need threading through all of them.
- **Delete progress along with the enrollment.** Rejected: it loses analytics history and the learner's place if they come back.
- **Cut access as soon as the Refund Request is made.** Rejected: it punishes learners whose request is then Declined.

## Consequences

- An approved refund on a team Purchase does not touch the buyer's own access, rating, or comments; it makes that Purchase's unclaimed seat coupons unredeemable instead.
