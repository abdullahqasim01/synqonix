import Link from "next/link";
import { CheckCircle2, GitBranch, MessageSquare, Terminal } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const points = [
  { icon: CheckCircle2, text: "Boards, sprints and backlogs that stay out of your way" },
  { icon: GitBranch, text: "Branches, commits and pull requests linked to tasks" },
  { icon: Terminal, text: "Start a task from VS Code and get the branch for free" },
  { icon: MessageSquare, text: "Channels and threads right next to the work" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col">
        <header className="flex items-center justify-between px-6 py-4">
          <Link href="/" aria-label="Synqonix home"><Logo height={34} /></Link>
          <ThemeToggle />
        </header>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 pb-16">{children}</main>
      </div>
      <aside aria-hidden className="relative hidden overflow-hidden bg-rail p-12 text-white lg:flex lg:flex-col lg:justify-center">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary/50 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-info/30 blur-3xl" />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Project management built for developers</h2>
          <p className="mt-3 text-white/70">Plan, build and ship from one place — in the browser or in your editor.</p>
          <ul className="mt-8 grid gap-4">
            {points.map((p) => (
              <li key={p.text} className="flex items-start gap-3 text-sm text-white/85">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10"><p.icon className="h-4 w-4" /></span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
