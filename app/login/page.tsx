import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser, hasUsers } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const [user, initialized] = await Promise.all([getCurrentUser(), hasUsers()]);
  if (user) redirect("/");
  if (!initialized) redirect("/setup");
  return <AuthForm mode="login" />;
}
