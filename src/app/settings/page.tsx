import { connection } from "next/server";
import { Suspense } from "react";
import { AiSettingsForm } from "@/components/AiSettingsForm";
import { Nav } from "@/components/Nav";
import { CLAUDE_MODELS, getAiSettings, providerStatus } from "@/lib/ai/config";
import { listOllamaModels } from "@/lib/ai/ollama";
import { FormSkeleton } from "@/components/Skeleton";

export default function SettingsPage() {
  return (
    <>
      <Nav active="/settings" />
      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">AI settings</h1>
        <p className="mt-1 text-sm text-neutral-600">Choose which AI provider and model handles each task. Test a model before saving.</p>
        <Suspense fallback={<FormSkeleton className="mt-6" />}>
          <Loaded />
        </Suspense>
      </main>
    </>
  );
}

async function Loaded() {
  await connection();
  const [settings, status, ollamaModels] = await Promise.all([getAiSettings(), providerStatus(), listOllamaModels()]);
  return <AiSettingsForm initial={settings} status={status} claudeModels={CLAUDE_MODELS} ollamaModels={ollamaModels} />;
}
