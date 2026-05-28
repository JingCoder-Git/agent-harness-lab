"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getSavedCourseStep } from "@/components/layout/course-stepper";
import { useLocale } from "@/lib/i18n";

export function ContinueLearningButton({ label }: { label: string }) {
  const router = useRouter();
  const locale = useLocale();

  return (
    <button
      type="button"
      onClick={() => router.push(`/${locale}/${getSavedCourseStep()}`)}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-zinc-950 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
    >
      {label}
      <ArrowRight size={16} />
    </button>
  );
}
