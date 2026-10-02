import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Synqonix</h1>
        <ThemeToggle />
      </div>
      <p className="text-muted-foreground">
        Project management built for developers — tasks, boards, sprints and a VS Code extension.
      </p>
      <div className="flex gap-3">
        <Button asChild><Link href="/register">Get started</Link></Button>
        <Button asChild variant="outline"><Link href="/login">Sign in</Link></Button>
      </div>
    </main>
  );
}
