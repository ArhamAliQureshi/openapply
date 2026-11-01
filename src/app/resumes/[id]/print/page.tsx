import { Suspense } from "react";
import { ResumePreview } from "@/components/ResumePreview";
import { loadResume } from "../load";
import { AutoPrint } from "./AutoPrint";

// Print-optimised page. The browser's "Save as PDF" produces a text-selectable, ATS-friendly PDF.
export default function PrintPage(props: PageProps<"/resumes/[id]/print">) {
  return (
    <main className="bg-neutral-300 py-8 print:bg-white print:py-0">
      <p className="no-print mb-4 text-center text-sm text-neutral-700">
        In the print dialog, choose <strong>Save as PDF</strong>, set margins to <strong>None</strong> and turn off headers and footers.
      </p>
      <Suspense fallback={null}>
        <PrintableResume params={props.params} />
      </Suspense>
    </main>
  );
}

async function PrintableResume({ params }: { params: Promise<{ id: string }> }) {
  const row = await loadResume(params);
  return (
    <>
      <title>{row.title}</title>
      <div className="shadow-xl print:shadow-none">
        <ResumePreview data={row.data} template={row.template} />
      </div>
      <AutoPrint />
    </>
  );
}
