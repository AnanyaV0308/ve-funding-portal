import Image from "next/image";
import { redirect } from "next/navigation";
import { devLoginEnabled, microsoftEnabled, signIn } from "@/auth";
import { getCurrentUser } from "@/lib/authz";

export const metadata = { title: "Sign in" };

const DEMO_USERS = [
  ["admin@demo.visionempower.local", "Admin"],
  ["approver@demo.visionempower.local", "Approver"],
  ["associate@demo.visionempower.local", "Associate"],
  ["introducer@demo.visionempower.local", "Introducer"],
  ["viewer@demo.visionempower.local", "Viewer"],
] as const;

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/");

  async function microsoft() {
    "use server";
    await signIn("microsoft-entra-id", { redirectTo: "/" });
  }

  async function demo(formData: FormData) {
    "use server";
    await signIn("dev", { email: formData.get("email"), redirectTo: "/" });
  }

  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-ve-cream px-4 py-10">
      <div className="grid w-full max-w-md gap-6 rounded-xl bg-white p-8 shadow-sm">
        <Image src="/ve-logo.png" alt="Vision Empower" width={220} height={59} priority className="h-auto" />
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold">Sign in to VE Funding</h1>
          <p className="text-ve-muted">Use your Vision Empower Microsoft 365 account.</p>
        </div>

        {microsoftEnabled ? (
          <form action={microsoft}>
            <button type="submit" className="btn btn-primary w-full">
              Sign in with Microsoft
            </button>
          </form>
        ) : (
          <p className="rounded-md bg-ve-yellow-soft p-3 text-sm">
            Microsoft sign-in isn't set up yet. It turns on once VE's Microsoft 365 admin registers the app and the
            details are added to the environment.
          </p>
        )}

        {devLoginEnabled ? (
          <form action={demo} className="grid gap-3 border-t border-ve-line pt-5">
            <fieldset className="grid gap-2">
              <legend className="label mb-2 text-sm text-ve-olive">Local development: sign in as a demo user</legend>
              {DEMO_USERS.map(([email, role], i) => (
                <label key={email} className="inline-flex items-center gap-2">
                  <input type="radio" name="email" value={email} defaultChecked={i === 0} className="accent-ve-olive" />
                  {role}
                </label>
              ))}
            </fieldset>
            <button type="submit" className="btn btn-secondary">
              Continue as demo user
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
