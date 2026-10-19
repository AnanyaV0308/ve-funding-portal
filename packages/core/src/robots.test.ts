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

  it("ends a group at an empty Disallow, so a bot shut out after it doesn't shut out everyone", () => {
    const txt = "User-agent: *\nDisallow:\n\nUser-agent: GPTBot\nDisallow: /\n";
    expect(robotsAllows(txt, "/annual-reports/")).toBe(true);
    expect(robotsAllows(txt, "/annual-reports/", "GPTBot")).toBe(false);
  });

  it("combines every group for everyone, as WordPress sites with Yoast write them", () => {
    const txt = [
      "User-agent: *",
      "Disallow: /wp-admin/",
      "Allow: /wp-admin/admin-ajax.php",
      "",
      "User-agent: *",
      "Disallow: /wp-content/uploads/wpo/wpo-plugins-tables-list.json",
      "# START YOAST BLOCK",
      "User-agent: *",
      "Disallow:",
      "Sitemap: https://example.org/sitemap_index.xml",
      "# END YOAST BLOCK",
    ].join("\n");
    expect(robotsAllows(txt, "/wp-content/uploads/2025/09/Annual-Report-2024-25.pdf")).toBe(true);
    expect(robotsAllows(txt, "/wp-admin/options.php")).toBe(false);
    expect(robotsAllows(txt, "/wp-content/uploads/wpo/wpo-plugins-tables-list.json")).toBe(false);
  });
});
