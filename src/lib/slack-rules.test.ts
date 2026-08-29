import { expect, test } from "bun:test";
import { extractQualifyingReviewUrl } from "./slack-rules";

test("accepts GitHub pull request paths", () => {
  expect(
    extractQualifyingReviewUrl(
      "please review https://github.com/mijho/stamphog/pull/12"
    )
  ).toBe("https://github.com/mijho/stamphog/pull/12");
  expect(
    extractQualifyingReviewUrl(
      "files: https://github.com/mijho/stamphog/pull/12/files"
    )
  ).toBe("https://github.com/mijho/stamphog/pull/12/files");
});

test("accepts Graphite review paths", () => {
  expect(
    extractQualifyingReviewUrl(
      "stack https://app.graphite.dev/github/pr/mijho/stamphog/12"
    )
  ).toBe("https://app.graphite.dev/github/pr/mijho/stamphog/12");
});

test("rejects GitHub and Graphite URLs that are not review paths", () => {
  expect(
    extractQualifyingReviewUrl("see https://github.com/mijho/stamphog")
  ).toBeUndefined();
  expect(
    extractQualifyingReviewUrl(
      "issue https://github.com/mijho/stamphog/issues/12"
    )
  ).toBeUndefined();
  expect(
    extractQualifyingReviewUrl("docs https://graphite.dev/docs")
  ).toBeUndefined();
});

test("skips a non-PR host URL and uses a later qualifying review URL", () => {
  expect(
    extractQualifyingReviewUrl(
      "https://github.com/mijho/stamphog then https://github.com/mijho/stamphog/pull/12"
    )
  ).toBe("https://github.com/mijho/stamphog/pull/12");
});
