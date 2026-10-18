import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "CSR leads" };

export default function LeadsPage() {
  return (
    <>
      <PageHeader title="CSR leads" intro="Indian companies that can fund VE through CSR, ranked by fit, with the reasons written out." />
      <ComingSoon step="step 4, the CSR engine">
        <p>Each company will show a fit score out of 100, an eligibility verdict (Eligible, Needs check or Not eligible) and one line on why it fits.</p>
        <p>Data will come from the National CSR Portal, MCA, annual reports and BRSR filings, company CSR action plans, CSR news and the donor lists of NGOs like VE.</p>
      </ComingSoon>
    </>
  );
}
