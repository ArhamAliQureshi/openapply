import { Suspense } from "react";
import { ResumeEditor } from "@/components/ResumeEditor";
import { loadResume } from "./load";
import { EditorSkeleton } from "@/components/Skeleton";

export default function ResumePage(props: PageProps<"/resumes/[id]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <Editor params={props.params} />
    </Suspense>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const row = await loadResume(params);
  return (
    <>
      <title>{`${row.title} · ApplyKit`}</title>
      <ResumeEditor
        key={row.id}
        id={row.id}
        initialTitle={row.title}
        initialData={row.data}
        initialTemplate={row.template}
      />
    </>
  );
}
