/**
 * Where the portal looks for each peer NGO's annual reports. Each link was found on the NGO's own
 * website in October 2026. Safe to re-run: an NGO that already has a link keeps the one VE set.
 * National Association for the Blind's reports are on its Centre for Women's site; Amar Jyoti has
 * no working site and Sense International India publishes no annual report, so neither has a link.
 */
import { db, peerSources } from "./index";

export const PEER_SOURCES_SEED: { ngoName: string; url: string }[] = [
  { ngoName: "National Association for the Blind", url: "https://nabcentreforwomen.org/annual-reports/" },
  { ngoName: "Saksham", url: "https://www.saksham.org/annual-report/" },
  { ngoName: "Enable India", url: "https://www.enableindia.org/reports/" },
  { ngoName: "Mitra Jyothi", url: "https://mitrajyothi.org/annual-reports/" },
  { ngoName: "Samarthanam", url: "https://www.samarthanam.org/annual-report/" },
  { ngoName: "Blind People's Association", url: "https://bpaindia.org/?page_id=10259" },
  // The newest report is linked from the home page; the reports page lists older years.
  { ngoName: "Xavier's Resource Centre for the Visually Challenged", url: "https://www.xrcvc.org/" },
  { ngoName: "Score Foundation", url: "https://scorefoundation.org.in/annual-reports" },
  { ngoName: "Sightsavers", url: "https://www.sightsaversindia.org/governance/annual-reviews/" },
  { ngoName: "Vision Aid", url: "https://visionaid.org/annual-reports/" },
  { ngoName: "Youth4Jobs", url: "https://youth4jobs.org/" },
];

export async function seedPeerSources() {
  const rows = await db.insert(peerSources).values(PEER_SOURCES_SEED).onConflictDoNothing().returning({ id: peerSources.id });
  console.log(`Peer NGO report pages: added ${rows.length} of ${PEER_SOURCES_SEED.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seedPeerSources();
  process.exit(0);
}
