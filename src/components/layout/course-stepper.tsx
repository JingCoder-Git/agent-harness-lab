"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { LEARNING_PATH, VERSION_META } from "@/lib/constants";
import { useLocale, useTranslations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "agent-harness-lab.current-step";

function stepFromPath(pathname: string) {
  return LEARNING_PATH.find((step) => pathname.includes(`/${step}`)) ?? null;
}

export function useCurrentCourseStep() {
  const pathname = usePathname();
  const current = stepFromPath(pathname);

  useEffect(() => {
    if (current) localStorage.setItem(STORAGE_KEY, current);
  }, [current]);

  return current;
}

export function getSavedCourseStep() {
  if (typeof window === "undefined") return LEARNING_PATH[0];
  const saved = localStorage.getItem(STORAGE_KEY);
  return LEARNING_PATH.includes(saved as (typeof LEARNING_PATH)[number])
    ? (saved as (typeof LEARNING_PATH)[number])
    : LEARNING_PATH[0];
}

export function CourseStepper() {
  const locale = useLocale();
  const current = useCurrentCourseStep();
  const tSession = useTranslations("sessions");

  return (
    <aside className="w-full shrink-0 md:w-64">
      <div className="sticky top-[calc(3.5rem+1rem)] space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Course Steps
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              From 0 to 1.
            </p>
          </div>
        </div>

        <ol className="flex gap-2 overflow-x-auto pb-2 md:block md:space-y-1 md:overflow-visible md:pb-0">
          {LEARNING_PATH.map((step, index) => {
            const meta = VERSION_META[step];
            const isActive = current === step;

            return (
              <li key={step} className="shrink-0 md:shrink">
                <Link
                  href={`/${locale}/${step}`}
                  className={cn(
                    "grid min-w-52 grid-cols-[2.25rem_1fr] items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors md:min-w-0",
                    isActive
                      ? "border-zinc-900 bg-zinc-950 text-white dark:border-white dark:bg-white dark:text-zinc-950"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-600"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                      isActive
                        ? "bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white"
                        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300"
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-wide">
                      Step {index + 1}
                    </span>
                    <span className="block truncate text-sm font-medium">
                      {tSession(step) || meta.title}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}

export function StepNavigation({ version }: { version: string }) {
  const router = useRouter();
  const locale = useLocale();
  const index = LEARNING_PATH.indexOf(version as (typeof LEARNING_PATH)[number]);
  const prev = index > 0 ? LEARNING_PATH[index - 1] : null;
  const next = index < LEARNING_PATH.length - 1 ? LEARNING_PATH[index + 1] : null;

  function go(step: string | null) {
    if (!step) return;
    localStorage.setItem(STORAGE_KEY, step);
    router.push(`/${locale}/${step}`);
  }

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={() => go(prev)}
        disabled={!prev}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-4 text-sm font-medium text-zinc-600 transition-colors hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600"
      >
        <ChevronLeft size={16} />
        Previous Step
      </button>
      <button
        type="button"
        onClick={() => go(next)}
        disabled={!next}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        <Check size={16} />
        {next ? "Complete and Continue" : "Course Complete"}
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
