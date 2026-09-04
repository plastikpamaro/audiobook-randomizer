import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  return (
    <button className={`button button-${variant} button-${size} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
