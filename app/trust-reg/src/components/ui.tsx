"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import type { OverallStatus, RequirementStatus, SimpleStatus, VerificationStatus } from "@/server/domain/types";
import {
  OVERALL_STATUS_LABEL,
  OVERALL_STATUS_TONE,
  REQUIREMENT_STATUS_LABEL,
  REQUIREMENT_STATUS_TONE,
  SIMPLE_STATUS_LABEL,
  SIMPLE_STATUS_TONE,
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
} from "@/lib/labels";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export function Badge({ tone, children, className }: { tone: string; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", tone, className)}>
      {children}
    </span>
  );
}

export const OverallStatusBadge = ({ status }: { status: OverallStatus }) => (
  <Badge tone={OVERALL_STATUS_TONE[status]}>{OVERALL_STATUS_LABEL[status]}</Badge>
);
export const RequirementStatusBadge = ({ status }: { status: RequirementStatus }) => (
  <Badge tone={REQUIREMENT_STATUS_TONE[status]}>{REQUIREMENT_STATUS_LABEL[status]}</Badge>
);
export const VerificationBadge = ({ status }: { status: VerificationStatus }) => (
  <Badge tone={VERIFICATION_TONE[status]}>{VERIFICATION_LABEL[status]}</Badge>
);
export const SimpleStatusBadge = ({ status }: { status: SimpleStatus }) => (
  <Badge tone={SIMPLE_STATUS_TONE[status]}>{SIMPLE_STATUS_LABEL[status]}</Badge>
);

export function ActivationBadge({ blocked }: { blocked: boolean }) {
  return blocked ? (
    <Badge tone="bg-red-50 text-red-700 ring-red-200">Activation blocked</Badge>
  ) : (
    <Badge tone="bg-emerald-50 text-emerald-700 ring-emerald-200">Activation cleared</Badge>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANT: Record<Variant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400",
  secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-300",
  ghost: "text-slate-700 hover:bg-slate-100 disabled:text-slate-400",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        VARIANT[variant],
        className
      )}
    />
  );
}

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: Variant }) {
  return (
    <Link href={href} className={cx("inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition", VARIANT[variant])}>
      {children}
    </Link>
  );
}

// variant "inner": a section nested inside another Card. Flat tint instead of a second shadow, so the
// outer card stays the one raised object on the page.
export function Card({
  title,
  actions,
  children,
  className,
  variant = "default",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  variant?: "default" | "inner";
}) {
  const inner = variant === "inner";
  return (
    <section className={cx(inner ? "rounded-md bg-slate-50 ring-1 ring-slate-200" : "rounded-lg bg-white ring-1 ring-slate-200 shadow-sm", className)}>
      {(title || actions) && (
        <header className={cx("flex items-center justify-between gap-3 border-b border-slate-200", inner ? "px-4 py-2.5" : "px-4 py-3")}>
          {inner ? <h3 className="text-sm font-semibold text-slate-800">{title}</h3> : <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, required }: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const CONTROL = "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-900 disabled:bg-slate-50";

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={cx(CONTROL, props.className)} />;
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={cx(CONTROL, props.className)} />;
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} className={cx(CONTROL, "min-h-20", props.className)} />;

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warning"; children: ReactNode }) {
  const tones = {
    info: "bg-sky-50 text-sky-900 ring-sky-200",
    error: "bg-red-50 text-red-900 ring-red-200",
    success: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-200",
  };
  return <div className={cx("rounded-md px-3 py-2 text-sm ring-1 ring-inset", tones[tone])}>{children}</div>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}

export function DL({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onClick={onClose} role="presentation">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
