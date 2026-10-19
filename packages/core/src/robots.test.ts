import { describe, expect, it } from "vitest";
import { robotsAllows } from "./robots";

describe("robots.txt", () => {
  it("follows the group for everyone", () => {
    const txt = "User-agent: *\nDisallow: /private/\nAllow: /private/annual-report.pdf\n";
    expect(robotsAllows(txt, "/investors/annual-report-2025.pdf")).toBe(true);
    expect(robotsAllows(txt, "/private/board.pdf")).toBe(false);
    expect(robotsAllows(txt, "/private/annual-report.pdf")).toBe(true);
  });

  it("prefers a group that names the portal", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: VEFundingPortal\nUser-agent: OtherBot\nAllow: /\n";
    expect(robotsAllows(txt, "/report.pdf")).toBe(true);
    expect(robotsAllows("User-agent: VEFundingPortal\nDisallow: /\n", "/report.pdf")).toBe(false);
  });

  it("reads wildcards, end anchors, comments and empty rules", () => {
    const txt = "# NSE\nUser-agent: *\nAllow: /\nDisallow: /*.zip$\nDisallow: /market-data-test\nDisallow:\n";
    expect(robotsAllows(txt, "/files/AR_2025.zip")).toBe(false);
    expect(robotsAllows(txt, "/files/AR_2025.zip?x=1")).toBe(true);
    expect(robotsAllows(txt, "/market-data-test/x")).toBe(false);
    expect(robotsAllows(txt, "/annual_reports/AR.pdf")).toBe(true);
    expect(robotsAllows("", "/anything")).toBe(true);
    expect(robotsAllows("<html>not a robots file</html>", "/anything")).toBe(true);
  });
});
