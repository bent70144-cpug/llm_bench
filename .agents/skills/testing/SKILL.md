# Testing rules for AI agents (TypeScript)

Read this file before you write or change any test. These rules apply to every feature, including APIs, backend logic, auth, payment gateways, webhooks, background jobs, and database code.

Examples use Vitest and Supertest. If the project uses Jest, the rules are the same. Swap `vi` for `jest`.

## The core rule

A test checks what the code should do. It does not check what the code does today.

If you write a test by reading your own implementation and copying its output into an assertion, the test can never fail for the right reason. It only proves the code equals itself. That is the most common mistake agents make, and this file exists to stop it.

Every test must be able to fail when the behavior is wrong. If you cannot name a bug that would make the test fail, delete the test and write a better one. Mutation testing with Stryker (see below) checks this for you.

## Order of work

1. Write the behavior down in plain English first. List what the feature must do, what it must refuse to do, and what happens when things go wrong. Put this list at the top of the test file as a comment, or in the task description.
2. If the requirement is unclear, ask the user. Do not guess a rule and then write a test that locks in your guess.
3. Write the tests from that list.
4. Write or finish the implementation.
5. Run the tests.
6. Run Stryker on the files you changed. Read every survived mutant and fix the tests (see "Mutation testing with Stryker").

When you add tests to code that already exists, still start from the intended behavior, not from the code. Read the requirement, the ticket, the docs, or ask. Use the code only to find names and signatures.

## Where expected values come from

An expected value in an assertion must come from one of these sources.

- The requirement or spec the user gave you.
- A value you worked out by hand, with the working shown in a comment when it is not obvious.
- Official documentation of an external system, such as a payment gateway's sample payload or a JWT standard.
- A fixture file that a human reviewed and committed on purpose.

An expected value must never come from running the code and pasting what it returned. Do not use snapshot tests to create the expectation on the first run. Do not compute the expected value with the same function you are testing.

Bad. The expected value is produced by the code under test.

```ts
it("calculates the total", () => {
  expect(calculateTotal(items)).toBe(calculateTotal(items));
});
```

Bad. The number was copied from the output without checking it.

```ts
it("calculates the total", () => {
  expect(calculateTotal(items)).toBe(1183.2);
});
```

Good. The value comes from the rule, and the working is visible.

```ts
it("applies 18 percent tax after the discount", () => {
  const items = [{ price: 1000, qty: 1 }];
  // 1000 minus 10% discount = 900, plus 18% tax = 1062
  expect(calculateTotal(items, { discountPercent: 10, taxPercent: 18 })).toBe(
    1062,
  );
});
```

## What every test file must contain

Each test file for a feature must cover all of the following. If one item does not apply, write one line in the file saying why.

1. The happy path, with realistic input and a check of the full result.
2. Every validation rule. One test per rule, for example missing field, wrong type, too long, negative number, empty string, bad format.
3. Boundary values. Zero, one, the maximum, one above the maximum, empty array, very large input, special characters, unicode.
4. Permission and ownership checks. Who is allowed, who is refused, and what the refusal looks like.
5. Failure paths. What happens when the database errors, the network times out, or a third party returns an error.
6. Side effects. Check that the right rows were written, the right events were sent, the right emails or jobs were queued, and that nothing extra happened.
7. Repeat and concurrent calls. What happens when the same request arrives twice, or two requests arrive at the same moment.
8. State after failure. After a rejected or failed call, confirm nothing was saved, charged, or sent.

## TypeScript rules for test code

- Tests are `*.test.ts` files and compile under the project's `strict` setting.
- Do not use `any`, `@ts-ignore`, or non-null assertions (`!`) to make a test compile. Fix the types.
- To send deliberately invalid input, cast with `as unknown as T` and add a comment that says why.
- Build test data with typed factory functions, for example `buildUser({ role: "admin" })`. Do not copy large object literals across tests.
- `await` every promise. A missing `await` makes a test pass without running the assertion.
- Check thrown errors by class and by code or message.

```ts
await expect(refund(order, 99_999)).rejects.toThrow(RefundExceedsPaymentError);
await expect(refund(order, 99_999)).rejects.toMatchObject({
  code: "REFUND_EXCEEDS_PAYMENT",
});
```

- Freeze time. Do not use the real clock.

```ts
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
```

- Wait for async work with `vi.waitFor(...)` or by awaiting the real promise. Do not use `setTimeout` or a fixed sleep.

## How to write one test

- One test checks one behavior. A test with five unrelated assertions hides which behavior broke.
- Name the test after the behavior and the condition. `rejects an expired token with 401` is good. `works` and `test 2` are not.
- Use Arrange, Act, Assert. Set up the data, call the code once, then check the result.
- Each test sets up its own data. Tests must not depend on run order or on data left by another test.
- Use realistic data. `"test"`, `"abc"`, and `123` hide bugs that real names, emails, amounts, and dates would expose.
- Keep logic out of tests. No loops or if statements that decide what to assert. Use `it.each` with a table of input and expected output when many cases share a shape.

```ts
it.each([
  { amount: 0, valid: false },
  { amount: 1, valid: true },
  { amount: 100_000, valid: true },
  { amount: 100_001, valid: false }, // limit is 100,000 per the spec
])("amount $amount is valid=$valid", ({ amount, valid }) => {
  expect(isValidAmount(amount)).toBe(valid);
});
```

## What to assert

Checking the status code alone is not a test. For any call, assert all that apply.

- The status code or return type.
- The full response body or return value, including field names, types, and values. Do not only check that a key exists. Use `toStrictEqual` for exact shapes.
- Headers that matter, such as content type and cache headers.
- The database state after the call. Read the row back and compare each field.
- The calls made to other systems, with the exact arguments.
- What must not be in the response. Password hashes, secrets, internal IDs, other users' data, stack traces.

Bad. This passes even if the endpoint saves the wrong data.

```ts
it("creates a user", async () => {
  const res = await request(app)
    .post("/users")
    .send({ email: "a@b.com", name: "Asha" });
  expect(res.status).toBe(201);
});
```

Good. This checks the response, the stored data, and that no secret leaks.

```ts
it("creates the user, stores a hashed password, and hides secrets", async () => {
  const res = await request(app).post("/users").send({
    email: "asha@example.com",
    name: "Asha Verma",
    password: "S3cure!pass",
  });

  expect(res.status).toBe(201);
  expect(res.body).toStrictEqual({
    id: expect.any(String),
    email: "asha@example.com",
    name: "Asha Verma",
  });

  const row = await db.user.findUnique({
    where: { email: "asha@example.com" },
  });
  expect(row).toMatchObject({ name: "Asha Verma" });
  expect(row?.passwordHash).not.toBe("S3cure!pass"); // stored hashed, not plain
});
```

Use `expect.any(String)` only for values the code generates, such as ids and timestamps. Check their format in a separate assertion when the format matters.

## Rules for mocks and fakes

Mocking is where most fake tests come from. Follow these rules.

- Mock only things outside your system that you do not control. Examples are a payment gateway, an email provider, an SMS service, the system clock, and random number generators.
- Never mock the function or class you are testing.
- Do not mock your own database layer in tests that claim to check database behavior. Use a real test database.
- Do not mock your own internal modules just to make a test pass. If a test needs that many mocks, it is at the wrong level. Write an integration test instead.
- A mock must behave like the real system, including its errors. Make the fake return the same shapes, error codes, and delays the real service returns. Copy these from the provider's documentation.
- Assert on how the mock was called, not only that it was called. Check the arguments and the count.
- Do not let every mock return exactly what the code expects. Include responses that are errors, empty, slow, malformed, or repeated.
- Type your fakes against the real client's type, so a change in the real API breaks the fake at compile time.

Bad. The mock is set up so the test cannot fail.

```ts
gateway.charge = vi.fn().mockResolvedValue({ status: "success" });
const result = await checkout(cart);
expect(result.status).toBe("success");
```

Good. The test controls the gateway, then checks what the code sent and what it stored.

```ts
const charge = vi.fn().mockResolvedValue({ id: "ch_123", status: "succeeded" });
const gateway: PaymentGateway = { charge, refund: vi.fn() };

const result = await checkout(cartWorth500Rupees, { gateway, currency: "INR" });

expect(charge).toHaveBeenCalledTimes(1);
expect(charge).toHaveBeenCalledWith({
  amount: 50_000, // 500.00 INR in paise
  currency: "INR",
  idempotencyKey: expect.any(String),
});
const order = await db.order.findUniqueOrThrow({
  where: { id: result.orderId },
});
expect(order).toMatchObject({ paymentId: "ch_123", status: "paid" });
```

## Patterns that are banned

Do not write any of these.

- Tests with no assertion, or with a weak assertion such as `toBeDefined()`, `toBeTruthy()`, `not.toBeNull()` on its own, `expect.anything()`, or `toHaveBeenCalled()` without arguments.
- `expect(() => fn()).toThrow()` with no error class, code, or message.
- A `try/catch` in a test that swallows failures. Use `rejects` and `toThrow`.
- `it.skip`, `it.todo`, `describe.skip`, `it.only`, or commented out tests to get a green run.
- Changing an assertion to match wrong output so the test passes.
- Loosening a check, for example replacing an exact value with `toBeGreaterThan(0)`, because the exact value failed.
- `toMatchSnapshot()` as the only check for logic.
- Tests that hit the real internet, a real payment gateway, or production data in the normal test run.
- Fixed sleeps to wait for async work.
- Coverage-chasing tests that call code without checking its result.
- A test that re-implements the production formula inside the test.

## Checklists by feature type

### API endpoint

- Success response with exact body and status code.
- Each required field missing, one at a time. Each field with the wrong type. Extra unknown fields.
- Invalid JSON, empty body, wrong content type.
- Not logged in, logged in with the wrong role, logged in as another user trying to reach this user's data.
- Resource not found. Resource already exists. Conflict on duplicate.
- Pagination limits, sorting, filtering, and empty results.
- Database row after create, update, and delete. Confirm delete removes the right row and nothing else.
- Same request sent twice. Is the result correct for a create, an update, and a delete?
- Error responses use the documented format and do not leak internal details.

### Authentication and authorization

- Correct credentials succeed and return a usable token or session.
- Wrong password, unknown user, and locked or disabled account all fail. The error message must not reveal which one it was.
- Missing token, malformed token, expired token, token with a bad signature, token for a different audience or issuer, and a token signed with the "none" algorithm all fail.
- Logout and password change invalidate old tokens or sessions.
- Refresh tokens rotate. A refresh token used twice is rejected.
- A user cannot read or change another user's data by changing an ID in the URL or body.
- Each role can do what it should and is refused everything else. Test the refusal, not only the access.
- Passwords are stored hashed. Reset tokens expire and work only once.
- Repeated failed attempts trigger the rate limit or lockout.

### Payment gateway

- Amounts use the smallest currency unit, as the gateway requires. Check rounding with amounts like 0.01, 99.99, and large totals.
- The currency is sent and checked. A mismatch between order currency and payment currency is rejected.
- Successful, declined, insufficient funds, expired card, authentication required, timeout, and gateway outage each lead to the correct order state.
- Timeout on charge. The order is not marked paid, and a retry does not charge twice. Check the idempotency key is sent and reused on retry.
- Webhooks check the signature. A missing or wrong signature is rejected and changes nothing.
- The same webhook delivered twice changes state once.
- Webhooks arriving out of order, for example "refunded" before "paid", leave the order in a valid state.
- Full refund, partial refund, refund larger than the payment, and a second refund after the first. Totals stay correct.
- The amount the gateway reports must match the order total. If it does not, the order is flagged and not fulfilled.
- Card numbers, CVV, and secret keys never appear in logs, responses, or stored fields.
- Two checkout requests for the same cart at the same time create one charge.
- Use the gateway's sandbox or test mode for integration tests, with its documented test card numbers. Never use real keys in tests.

Example of a webhook test that checks a refusal and the absence of a side effect.

```ts
it("rejects a webhook with a bad signature and leaves the order unpaid", async () => {
  const order = await createPendingOrder({ totalPaise: 50_000 });
  const payload = JSON.stringify({
    id: "evt_1",
    type: "payment.succeeded",
    orderId: order.id,
  });

  const res = await request(app)
    .post("/webhooks/payments")
    .set("x-signature", "sha256=deadbeef")
    .set("content-type", "application/json")
    .send(payload);

  expect(res.status).toBe(401);
  const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  expect(after.status).toBe("pending");
});

it("applies the same webhook once when it is delivered twice", async () => {
  const order = await createPendingOrder({ totalPaise: 50_000 });
  const payload = JSON.stringify({
    id: "evt_2",
    type: "payment.succeeded",
    orderId: order.id,
  });
  const signature = signLikeTheGateway(payload, WEBHOOK_SECRET); // algorithm from the gateway docs

  await request(app)
    .post("/webhooks/payments")
    .set("x-signature", signature)
    .send(payload);
  await request(app)
    .post("/webhooks/payments")
    .set("x-signature", signature)
    .send(payload);

  const ledger = await db.ledgerEntry.findMany({
    where: { orderId: order.id },
  });
  expect(ledger).toHaveLength(1);
});
```

### Database and business logic

- Test rules with real values, and check results against numbers you worked out by hand.
- Constraint violations, such as unique keys and foreign keys, are handled and return a clear error.
- A transaction that fails halfway rolls back fully. Check that no partial data remains.
- Soft delete, timestamps, and audit fields are set correctly.
- Migrations apply on an empty database and on a database with existing data.

### Webhooks, queues, and background jobs

- A job runs once for one event. A retried job does not repeat its side effects.
- A failing job retries the expected number of times, then moves to the dead letter queue or reports the failure.
- A payload with missing or unexpected fields is handled without crashing the worker.

## Test levels

Use the right level for the risk.

- Unit tests cover pure logic such as calculations, validation, and parsing. They run with no network and no database.
- Integration tests cover an endpoint or service with a real test database and real internal modules. Only external third parties are faked. Payment, auth, and anything that writes data must have integration tests.
- End to end tests cover the few most important user flows, such as sign up, login, checkout, and refund. Keep them few and stable.

Passing unit tests with everything mocked does not show that the feature works. For any feature that touches a database, auth, or a gateway, write at least one integration test that goes through the real code path.

## Mutation testing with Stryker

Coverage says which lines ran. It does not say whether a test would notice a bug on those lines. Stryker answers that question. It copies your code, plants a small bug (a mutant) such as changing `>` to `>=`, and runs your tests. If a test fails, the mutant is killed. If every test still passes, the mutant survived, which means your tests missed a real bug.

Use Stryker as the proof that your tests can fail. A green test run alone is not proof.

### Setup

Requirements are Node 20 or higher, and Vitest 2 or higher if you use the Vitest runner.

```bash
npm install --save-dev @stryker-mutator/core @stryker-mutator/vitest-runner @stryker-mutator/typescript-checker
```

For Jest, install `@stryker-mutator/jest-runner` instead of the Vitest runner and set `"testRunner": "jest"`.

Create `stryker.config.json` in the repo root.

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "testRunner": "vitest",
  "checkers": ["typescript"],
  "tsconfigFile": "tsconfig.json",
  "mutate": [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.d.ts"
  ],
  "coverageAnalysis": "perTest",
  "reporters": ["clear-text", "progress", "html"],
  "thresholds": { "high": 90, "low": 80, "break": 80 },
  "incremental": true
}
```

What the main fields do.

- `mutate` lists the files Stryker changes. Test files must be excluded.
- `checkers` with `typescript` drops mutants that would not compile, which saves time and removes noise.
- `coverageAnalysis` set to `perTest` runs only the tests that touch a mutant.
- `thresholds.break` makes the command exit with an error when the mutation score falls below it. Set it to 80 or higher.
- `incremental` reuses results for code and tests that did not change, so repeat runs are fast.

Add these lines to `.gitignore`.

```
.stryker-tmp/
reports/
```

Add scripts to `package.json`.

```json
{
  "scripts": {
    "test": "vitest run",
    "test:mutation": "stryker run",
    "test:mutation:file": "stryker run --mutate"
  }
}
```

### How to run it

1. Check that the setup works. The normal test run must pass first.

```bash
npx stryker run --dryRunOnly
```

2. Run it on the files you changed, not the whole repo. A full run can take many minutes.

```bash
npx stryker run --mutate "src/payments/**/*.ts,!src/payments/**/*.test.ts"
```

3. Open `reports/mutation/mutation.html`. Each mutant has a status.
   - Killed. A test failed, which is what you want.
   - Survived. All tests passed with the bug in place. This is a missing or weak test.
   - No coverage. No test runs this code at all.
   - Timeout. The mutant caused an infinite loop. This counts as killed.
   - Compile error. The mutant did not compile, and Stryker ignores it.

4. For each survived and no coverage mutant, write a test that fails because of that bug, then run Stryker on that file again.

### When you must run it

Run Stryker on the changed files for all code that handles money, auth, permissions, tokens, signatures, deletion of data, rate limits, and any calculation. The mutation score for these files must be 90 or higher.

For other code, such as controllers with no logic, DTOs, config, and generated code, a run is optional. The `thresholds.break` value still applies to files in `mutate`.

### Turning survivors into tests

Read the mutator name and the changed line in the report. Each survivor points to a specific missing test.

| Survived mutant                                               | What it tells you                                | Test to add                                                       |
| ------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| `amount > 0` became `amount >= 0` (EqualityOperator)          | The boundary at 0 is untested                    | Assert that amount 0 is rejected                                  |
| `user.role === "admin"` became `true` (ConditionalExpression) | No test sends a non-admin                        | Assert that a normal user gets 403                                |
| `price * qty` became `price / qty` (ArithmeticOperator)       | Totals are only tested with qty 1                | Assert a total with qty 3 against a hand-computed value           |
| `a && b` became `a \|\| b` (LogicalOperator)                  | The case where only one side is true is untested | Add a test where only `a` is true, and one where only `b` is true |
| Body of `if` replaced with `{}` (BlockStatement)              | The side effect is never asserted                | Assert the row, event, or queue job that block creates            |
| `"paid"` became `""` (StringLiteral)                          | The status value is never checked                | Assert the exact status in the stored order                       |
| `await queue.add(...)` removed                                | Nothing checks that the job was queued           | Assert the queue received the job with the right payload          |

A survivor must be killed by a test that checks real behavior from the requirement. Do not kill it by asserting an internal detail, such as a private helper call or the exact order of internal steps. That test would break on every refactor and prove nothing about correctness.

### Rules for Stryker

- Do not lower `thresholds`, remove files from `mutate`, or add paths to ignore lists to make the score pass. If you think the config must change, tell the user why and ask.
- Do not add `// Stryker disable` comments to hide a survivor. The only allowed use is an equivalent mutant, which is a change that cannot alter behavior, such as the text of a log message. Use the narrowest form and give the reason.

```ts
// Stryker disable next-line StringLiteral: log text only, no behavior
logger.info("order paid");
```

- List every disable comment you added in your final report.
- Tests that depend on time, random values, network, or run order give wrong mutation results. Fix flaky tests before you run Stryker.
- Stryker runs your tests many times, so slow tests make it slow. Run it against fast tests. If a route needs a database, make the test database reset quickly, or put the logic in a service function that you can test without HTTP.
- A high mutation score does not prove the feature is complete. Stryker cannot see a rule you forgot to implement or to test. The behavior list at the top of the test file still comes first.

## When a test fails

- Assume the code is wrong first. Read the failure and the requirement, then fix the code.
- Change a test only when the requirement was misread, or the requirement changed. Say so plainly in your report, and explain what changed and why.
- Never delete, skip, or weaken a failing test to get a green run.
- If you cannot make a test pass, stop and tell the user what is failing and why. A clear failure report is better than a fake pass.

## Final report

When you finish, include all of the following in your message to the user.

- The behaviors you tested, as a list in plain English.
- The behaviors you did not test, and the reason.
- Assumptions you made where the requirement was unclear.
- Which external services were faked, and how closely the fake matches the real service.
- The Stryker mutation score for each file you changed, the survivors you killed, and any survivors left with the reason.
- Any `// Stryker disable` comments you added.
- The exact command to run the tests, and the result.

## Quick self-check

Before you submit, answer these for each test file.

1. Could every expected value be written without running my code?
2. If I introduced a bug in the feature, which test would fail?
3. Did Stryker run on my changed files, and did I handle every survivor?
4. Are my mocks only on things I do not own?
5. Did I test the failure cases and the refusals, not only success?
6. Did I check stored data and side effects, not only the response?
7. Would these tests still be correct if someone rewrote the implementation from scratch?

If any answer is no, fix the tests first.
