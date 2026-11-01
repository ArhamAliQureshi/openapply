import { AgentsDashboard } from "@/components/AgentsDashboard";
import { Nav } from "@/components/Nav";

export default function AgentsPage() {
  return (
    <>
      <Nav active="/agents" />
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-neutral-600">
          What ApplyKit is doing in the background right now: job feed refreshes, autopilot runs, reading application forms, filling
          forms in a hidden browser, and AI calls. Updates every 2 seconds.
        </p>
        <AgentsDashboard />
      </main>
    </>
  );
}
