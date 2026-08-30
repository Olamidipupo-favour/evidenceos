import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow-[0_1px_2px_0] shadow-black/[0.04]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-header" className={cn("px-5 pt-4", className)} {...props} />;
}

export function CardTitle({
  className,
  as: As = "h3",
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" | "h4" }) {
  return (
    <As
      data-slot="card-title"
      className={cn("text-sm font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="card-description"
      className={cn("mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-content" className={cn("px-5 py-4", className)} {...props} />;
}

export function CardSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h4 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}
