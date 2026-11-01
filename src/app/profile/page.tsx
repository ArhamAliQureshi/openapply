import { connection } from "next/server";
import { Suspense } from "react";
import { Nav } from "@/components/Nav";
import { ProfileForm } from "@/components/ProfileForm";
import { getProfile } from "@/lib/apply/service";
import { FormSkeleton } from "@/components/Skeleton";

export default function ProfilePage() {
  return (
    <>
      <Nav active="/profile" />
      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Everything the auto-filler uses. It never invents answers: anything missing here becomes a question for you.
        </p>
        <Suspense fallback={<FormSkeleton cards={4} className="mt-6" />}>
          <LoadedForm />
        </Suspense>
      </main>
    </>
  );
}

async function LoadedForm() {
  await connection();
  return <ProfileForm initial={await getProfile()} />;
}
