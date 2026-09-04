import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { hasUsers } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await hasUsers()) redirect("/login");
  return <AuthForm mode="setup" />;
}
