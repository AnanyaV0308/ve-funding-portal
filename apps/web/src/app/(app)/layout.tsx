import { ROLE_LABELS } from "@ve/core";
import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/auth";
import { AppNav, type NavItem } from "@/components/app-nav";
import { requireUser } from "@/lib/authz";

const NAV: NavItem[] = [
  { href: "/", label: "This week" },
  { href: "/leads", label: "CSR leads" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/calendar", label: "Awards calendar" },
  { href: "/knowledge", label: "Knowledge base" },
  { href: "/settings", label: "Settings" },
  { href: "/introductions", label: "Introductions", soon: "Phase 2" },
  { href: "/drafts", label: "Drafts", soon: "Phase 2" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ve-yellow focus:px-4 focus:py-2 focus:text-ve-on-yellow"
      >
        Skip to main content
      </a>

      <aside className="border-b border-ve-line bg-white px-3 py-4 md:border-r md:border-b-0">
        <Link href="/" className="mb-4 block px-2" aria-label="VE Funding home">
          <Image src="/ve-logo.png" alt="Vision Empower" width={180} height={49} priority className="h-auto" />
        </Link>
        <nav aria-label="Main">
          <AppNav items={NAV} />
        </nav>
      </aside>

      <div className="grid min-w-0 grid-rows-[auto_1fr]">
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-ve-line bg-white px-6 py-3">
          <p className="text-sm">
            <span className="font-medium">{user.name ?? user.email}</span>
            <span className="text-ve-muted">
              {" · "}
              {user.roles.map((r) => ROLE_LABELS[r].name).join(", ") || "No role yet"}
            </span>
          </p>
          <form action={doSignOut}>
            <button type="submit" className="btn btn-secondary text-sm">
              Sign out
            </button>
          </form>
        </header>
        <main id="main" tabIndex={-1} className="grid content-start gap-6 px-6 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
