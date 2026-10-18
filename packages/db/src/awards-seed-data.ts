/**
 * Recurring awards from the PRD research, so the calendar starts with the ones VE already knows.
 * Next year's dates aren't out yet, so none has a deadline; whoever checks a call adds its dates
 * and fills in the eligibility checklist.
 */
import type { CallKind, FunderType } from "@ve/core";

export type AwardSeed = {
  organiser: string;
  organiserType: FunderType;
  kind: CallKind;
  title: string;
  url: string | null;
  usualWindow: string | null;
  amountNote: string | null;
  categories: string | null;
  notes: string | null;
};

export const AWARDS_SEED: AwardSeed[] = [
  {
    organiser: "Department of Empowerment of Persons with Disabilities (DEPwD)",
    organiserType: "government",
    kind: "award",
    title: "National Awards for Empowerment of Persons with Disabilities",
    url: "https://awards.gov.in",
    usualWindow: "Nominations go through the Rashtriya Puraskar Portal. The 2026 window was 15 May to 15 July.",
    amountNote: null,
    categories: "Best Institution; Accessible ICT; Best Research, Innovation and Product Development",
    notes: "Categories from DEPwD (https://depwd.gov.in/?p=20134). The 2026 window was reported by Nicobar Times.",
  },
  {
    organiser: "NCPEDP",
    organiserType: "award_body",
    kind: "award",
    title: "NCPEDP-Mphasis Universal Design Awards",
    url: "https://ncpedp.org/awards",
    usualWindow: null,
    amountNote: null,
    categories: null,
    notes: "NCPEDP also gives Role Model Awards; see the same page.",
  },
  {
    organiser: "Infosys Foundation",
    organiserType: "foundation",
    kind: "award",
    title: "Infosys Foundation Aarohan Social Innovation Awards",
    url: "https://www.infosys.org/infosys-foundation/aarohan-social-innovation-awards.html",
    usualWindow: null,
    amountNote: null,
    categories: null,
    notes: "VE has won this award before.",
  },
  {
    organiser: "Zero Project",
    organiserType: "award_body",
    kind: "award",
    title: "Zero Project call for nominations 2027",
    url: "https://zeroproject.org/research/call-for-nominations-2027",
    usualWindow: null,
    amountNote: "No cash prize",
    categories: "The 2027 theme includes assistive technology",
    notes: null,
  },
  {
    organiser: "QS Quacquarelli Symonds",
    organiserType: "award_body",
    kind: "award",
    title: "QS Reimagine Education Awards",
    url: null,
    usualWindow: null,
    amountNote: null,
    categories: null,
    notes: "VE was shortlisted in 2025.",
  },
];
