import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Synqonix</h1>
        <ThemeToggle />
      </div>
      <p className="text-muted-foreground">
        Project management built for developers — tasks, boards, sprints and a VS Code extension.
      </p>
    </main>
  );
}
