import type { KnowledgeCategory } from "@ve/core";

/**
 * Starting facts about VE, gathered from public sources during the PRD research (October 2026).
 * They load as "Needs confirming": someone at VE checks each one before drafts can use it.
 */
export type SeedFact = {
  category: KnowledgeCategory;
  title: string;
  body: string;
  asOf?: string;
  sourceLabel?: string;
  sourceUrl?: string;
};

const GIVE = { sourceLabel: "Give profile", sourceUrl: "https://give.do/discover/1C0B/vision-empower-trust/" };
const ABOUT = { sourceLabel: "VE website: About", sourceUrl: "https://visionempowertrust.org/about-vision-empower/" };
const AR26 = {
  sourceLabel: "Annual report 2025-26",
  sourceUrl: "https://visionempowertrust.org/reports/annual-report-2025-26/",
  asOf: "2026-03-31",
};
const FY25 = { ...GIVE, asOf: "2025-03-31" };

export const KNOWLEDGE_SEED: SeedFact[] = [
  // Organisation
  { category: "organisation", title: "Legal form", body: "Public charitable trust based in Bengaluru, founded in October 2017 and incubated at IIIT Bangalore.", ...ABOUT },
  { category: "organisation", title: "PAN", body: "AACTV5898B", ...GIVE },
  { category: "organisation", title: "12A registration", body: "AACTV5898BE20213", ...GIVE },
  { category: "organisation", title: "80G registration", body: "AACTV5898BF20229", ...GIVE },
  { category: "organisation", title: "CSR-1 registration", body: "CSR00022102", ...GIVE },
  { category: "organisation", title: "FCRA", body: "Not registered, so VE cannot receive foreign contributions directly." },
  {
    category: "organisation",
    title: "Leadership",
    body: "Supriya Dey (Co-founder, Managing Trustee), Vidhya Y (Co-founder, Trustee), Prof. Amit Prakash (Co-founder, Trustee), Sylvia Veeraraghavan (Executive Director).",
    ...ABOUT,
  },
  { category: "organisation", title: "Registered address", body: "W103 Innovation Center, IIIT Bangalore, Electronics City, Bengaluru." },
  { category: "organisation", title: "Team", body: "100+ staff, with regional teams in Karnataka, Odisha, Tamil Nadu and Kerala, and West Bengal." },
  {
    category: "organisation",
    title: "Approach",
    body: "Built on the Ludic Design for Accessibility approach from Microsoft Research.",
  },

  // Impact, FY 2025-26
  { category: "impact", title: "States reached, FY 2025-26", body: "17", ...AR26 },
  { category: "impact", title: "Schools, FY 2025-26", body: "151", ...AR26 },
  { category: "impact", title: "Students reached, FY 2025-26", body: "10,300+", ...AR26 },
  { category: "impact", title: "Teachers reached, FY 2025-26", body: "3,500+", ...AR26 },
  { category: "impact", title: "Hexis devices, FY 2025-26", body: "1,000+", ...AR26 },
  { category: "impact", title: "Iris devices, FY 2025-26", body: "600+", ...AR26 },
  { category: "impact", title: "Accessible science labs, FY 2025-26", body: "40+", ...AR26 },
  { category: "impact", title: "Volunteers, FY 2025-26", body: "4,463", ...AR26 },

  // Impact, FY 2024-25
  { category: "impact", title: "Students in Anubhav, FY 2024-25", body: "6,155", ...FY25 },
  { category: "impact", title: "Teachers trained, FY 2024-25", body: "3,026 in-service and 270 pre-service", ...FY25 },
  { category: "impact", title: "Devices deployed, FY 2024-25", body: "599", ...FY25 },
  { category: "impact", title: "Corporate volunteers, FY 2024-25", body: "4,299", ...FY25 },

  // Programmes
  { category: "programme", title: "Anubhav", body: "Experiential STEM learning in special schools, using tactile models and teacher instruction kits." },
  { category: "programme", title: "Pragya", body: "Training for in-service and pre-service teachers, both sighted and visually impaired." },
  { category: "programme", title: "Ananda", body: "Volunteer and corporate-volunteering programme, with over 4,000 corporate volunteers a year." },
  {
    category: "programme",
    title: "Srujan",
    body: "Assistive-technology research. Products include Hexis (a low-cost refreshable braille reader), Iris, the Subodha LMS, the Tactile Audio Gallery and 85 accessible learning games.",
  },
  {
    category: "programme",
    title: "Accessible Resource Centres",
    body: "Three operational centres plus ARC on Wheels, alongside accessible science labs, computational thinking and digital literacy.",
  },
];
