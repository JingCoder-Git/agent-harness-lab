import { CourseStepper } from "@/components/layout/course-stepper";

export default function LearnLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-8">
      <CourseStepper />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
