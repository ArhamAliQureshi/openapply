import Link from "next/link";

const LINKS = [
  { href: "/jobs", label: "Jobs" },
  { href: "/apply", label: "Applications" },
  { href: "/profile", label: "Profile" },
  { href: "/answers", label: "Answers" },
  { href: "/", label: "Resumes" },
  { href: "/agents", label: "Agents" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ active }: { active: string }) {
  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
        <Link href="/jobs" className="font-bold tracking-tight">ApplyKit</Link>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={l.href === active ? "font-medium text-teal-700" : "text-neutral-600 hover:text-neutral-900"}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
