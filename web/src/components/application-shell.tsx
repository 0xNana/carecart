"use client";

import {
  ApplicationRoutingContext,
  ApplicationLink as Link,
} from "./application-link";
import { applicationInternalPath } from "../lib/application-routing";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ClinicContext } from "@/lib/identity-backend";
import { ClinicSwitcher } from "./clinic-access";
import { identityMutation } from "@/lib/identity-client";
import { OperatorClient } from "@/lib/operator-client";
import { WorkspaceIcon, type WorkspaceIconName } from "./workspace-icon";
import { actionError } from "@/lib/product-copy";
import styles from "./application-shell.module.css";

type OperatorRole = "operator" | "viewer";
type Tenant = {
  clinic: ClinicContext;
  clinics: ClinicContext[];
  email: string;
};
const dashboardNavigation: {
  label: string;
  href: string;
  icon: WorkspaceIconName;
}[] = [
  { label: "Overview", href: "/app", icon: "overview" },
  { label: "Inventory", href: "/app/inventory", icon: "inventory" },
  { label: "Replenishment", href: "/app/replenishment", icon: "replenishment" },
  { label: "Suppliers", href: "/app/suppliers", icon: "suppliers" },
  { label: "Payments", href: "/app/payments", icon: "payments" },
  { label: "Activity", href: "/app/activity", icon: "activity" },
  { label: "Settings", href: "/app/settings", icon: "settings" },
];
const ApplicationContext = createContext<{
  role: OperatorRole;
  client: OperatorClient;
  tenant?: Tenant;
} | null>(null);

export function useApplication() {
  const context = useContext(ApplicationContext);
  if (!context) throw new Error("ApplicationShell is required.");
  return context;
}

function ShellIcon({
  name,
}: {
  name: "chevron" | "guide" | "logout" | "close" | "clinic";
}) {
  const paths = {
    chevron: "m9 5 7 7-7 7",
    guide:
      "M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V6Z",
    logout: "M9 4H4v16h5m4-12 4 4-4 4m-5-4h13",
    close: "m6 6 12 12M6 18 18 6",
    clinic: "M4 21V5h16v16M9 21v-5h6v5M9 9h6m-3-3v6M2 21h20",
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function ApplicationShell({
  role,
  children,
  tenant,
  cleanPaths = false,
  siteOrigin = "",
}: {
  role: OperatorRole;
  children: ReactNode;
  cleanPaths?: boolean;
  siteOrigin?: string;
  tenant?: Tenant;
}) {
  const [client] = useState(
    () => new OperatorClient(undefined, tenant?.clinic.id),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const menuToggle = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const account = useRef<HTMLDetailsElement>(null);
  const publicPathname = usePathname();
  const pathname = cleanPaths
    ? applicationInternalPath(publicPathname)
    : publicPathname;
  const router = useRouter();
  const currentSection = dashboardNavigation.find(
    (item) =>
      pathname === item.href ||
      (item.href !== "/app" && pathname.startsWith(item.href + "/")),
  );
  const clinicName = tenant?.clinic.name ?? "CareCart clinic";
  const memberRole =
    tenant?.clinic.role ?? (role === "operator" ? "Clinic staff" : "Viewer");
  const accountName = tenant?.email ?? "Local workspace";

  function closeNavigation() {
    setMenuOpen(false);
    requestAnimationFrame(() => menuToggle.current?.focus());
  }

  useEffect(() => {
    const closeAccount = (event: PointerEvent) => {
      if (account.current && !account.current.contains(event.target as Node))
        account.current.open = false;
    };
    const escapeAccount = (event: KeyboardEvent) => {
      if (event.key === "Escape" && account.current?.open) {
        event.preventDefault();
        account.current.open = false;
        account.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeAccount);
    document.addEventListener("keydown", escapeAccount);
    return () => {
      document.removeEventListener("pointerdown", closeAccount);
      document.removeEventListener("keydown", escapeAccount);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not(:disabled), select, summary",
        ) ?? [],
      ).filter(
        (node) =>
          node.getClientRects().length > 0 &&
          (!node.closest("details:not([open])") || node.tagName === "SUMMARY"),
      );
    focusable()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        requestAnimationFrame(() => menuToggle.current?.focus());
      }
      if (event.key === "Tab") {
        const nodes = focusable(),
          first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const desktop = window.matchMedia("(min-width: 1025px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    document.addEventListener("keydown", keyboard);
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keyboard);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [menuOpen]);

  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      if (tenant) {
        await identityMutation("logout");
        router.replace("/login");
        router.refresh();
        return;
      }
      await client.logout();
      router.replace("/operations");
    } catch (cause) {
      setMenuOpen(false);
      setSignOutError(actionError(cause, "Could not sign out. Try again."));
    } finally {
      setSigningOut(false);
    }
  }

  function navigation(items: typeof dashboardNavigation) {
    return items.map((item) => {
      const active = currentSection?.href === item.href;
      return (
        <Link
          key={item.href}
          href={item.href}
          className={active ? styles.sideLinkActive : styles.sideLink}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            setMenuOpen(false);
            if (account.current) account.current.open = false;
          }}
        >
          <WorkspaceIcon name={item.icon} />
          <span>{item.label}</span>
          {active && <span className={styles.activeMark} aria-hidden="true" />}
        </Link>
      );
    });
  }

  return (
    <ApplicationRoutingContext.Provider value={cleanPaths}>
      <ApplicationContext.Provider value={{ role, client, tenant }}>
        <div className={styles.app}>
          <a
            className={styles.skipLink}
            href="#application-main"
            inert={menuOpen}
          >
            Skip to application
          </a>
          {menuOpen && (
            <button
              className={styles.backdrop}
              type="button"
              onClick={closeNavigation}
              aria-label="Close navigation backdrop"
              tabIndex={-1}
            />
          )}
          <aside
            ref={sidebar}
            id="application-navigation"
            className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}
            aria-label="Application navigation"
            role={menuOpen ? "dialog" : undefined}
            aria-modal={menuOpen || undefined}
          >
            <div className={styles.brandRow}>
              <Link
                className={styles.brand}
                href="/app"
                aria-label="CareCart overview"
                onClick={() => setMenuOpen(false)}
              >
                <span className={styles.brandMark} aria-hidden="true">
                  <svg viewBox="0 0 32 32" focusable="false">
                    <path d="M20.5 8.5a10 10 0 1 0 0 15" />
                    <path d="M23 4.5v9M18.5 9h9" />
                  </svg>
                </span>
                <span>CareCart</span>
              </Link>
              <button
                type="button"
                className={styles.drawerClose}
                onClick={closeNavigation}
                aria-label="Close application navigation"
              >
                <ShellIcon name="close" />
              </button>
            </div>
            <div className={styles.clinicCard}>
              <span className={styles.clinicIcon}>
                <ShellIcon name="clinic" />
              </span>
              <div className={styles.clinicIdentity}>
                {tenant ? (
                  <ClinicSwitcher
                    clinics={tenant.clinics}
                    active={tenant.clinic.id}
                  />
                ) : (
                  <>
                    <span className={styles.eyebrow}>Workspace</span>
                    <strong>{clinicName}</strong>
                  </>
                )}
                {tenant?.clinic.country && (
                  <span className={styles.clinicCaption}>
                    {tenant.clinic.country}
                  </span>
                )}
              </div>
            </div>
            <nav
              className={styles.navigation}
              aria-label="Application sections"
            >
              {navigation(dashboardNavigation)}
            </nav>
            <div className={styles.sidebarFooter}>
              <Link className={styles.guideLink} href={siteOrigin + "/docs"}>
                <ShellIcon name="guide" />
                <span>Product guide</span>
                <span className={styles.externalArrow} aria-hidden="true">
                  ↗
                </span>
              </Link>
              <details className={styles.account} ref={account}>
                <summary aria-label="Account options">
                  <span className={styles.accountAvatar} aria-hidden="true">
                    {tenant?.email.slice(0, 2).toUpperCase() ??
                      (role === "operator" ? "CC" : "VW")}
                  </span>
                  <span className={styles.accountIdentity}>
                    <strong title={accountName}>{accountName}</strong>
                    <span>{memberRole}</span>
                  </span>
                  <ShellIcon name="chevron" />
                </summary>
                <div className={styles.accountPanel}>
                  <div className={styles.accountPanelIdentity}>
                    <strong>{accountName}</strong>
                    <span>{memberRole}</span>
                  </div>
                  {tenant && (
                    <Link href="/onboarding">
                      Manage clinics <span aria-hidden="true">↗</span>
                    </Link>
                  )}
                  <button
                    type="button"
                    disabled={signingOut}
                    onClick={() => void signOut()}
                  >
                    <ShellIcon name="logout" />
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              </details>
            </div>
          </aside>
          <div className={styles.workspace} inert={menuOpen}>
            <header className={styles.header}>
              <div className={styles.pageLocation}>
                <button
                  ref={menuToggle}
                  type="button"
                  className={styles.menuToggle}
                  aria-expanded={menuOpen}
                  aria-controls="application-navigation"
                  aria-label={
                    menuOpen
                      ? "Close application navigation"
                      : "Open application navigation"
                  }
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <span />
                  <span />
                </button>
                <span className={styles.breadcrumbClinic} title={clinicName}>
                  {clinicName}
                </span>
                <span className={styles.breadcrumbSeparator} aria-hidden="true">
                  /
                </span>
                <span className={styles.currentPage}>
                  {currentSection?.label ?? "Workspace"}
                </span>
              </div>
              <span className={styles.environment}>
                {cleanPaths ? "NEAR Testnet" : "Local demo"}
              </span>
            </header>
            <main id="application-main" className={styles.main} tabIndex={-1}>
              {signOutError && (
                <p className={styles.error} role="alert">
                  {signOutError}
                </p>
              )}
              {children}
            </main>
          </div>
          <nav
            className={styles.mobileNavigation}
            aria-label="Quick navigation"
            inert={menuOpen}
          >
            {dashboardNavigation
              .filter((item) =>
                ["overview", "inventory", "replenishment", "payments"].includes(
                  item.icon,
                ),
              )
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={
                    currentSection?.href === item.href ? "page" : undefined
                  }
                  onClick={() => setMenuOpen(false)}
                >
                  <WorkspaceIcon name={item.icon} />
                  <span>
                    {item.icon === "replenishment" ? "Orders" : item.label}
                  </span>
                </Link>
              ))}
          </nav>
        </div>
      </ApplicationContext.Provider>
    </ApplicationRoutingContext.Provider>
  );
}
