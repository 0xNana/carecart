"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type {ClinicContext} from '@/lib/identity-backend';
import {ClinicSwitcher} from './clinic-access';
import {identityMutation} from '@/lib/identity-client';
import { OperatorClient } from "@/lib/operator-client";
import {WorkspaceIcon,type WorkspaceIconName} from './workspace-icon';
import {actionError} from '@/lib/product-copy';
import styles from "./application-shell.module.css";

type OperatorRole = "operator" | "viewer";

const dashboardNavigation = [
  { label: "Overview", href: "/app", icon: "overview" },
  { label: "Inventory", href: "/app/inventory", icon: "inventory" },
  { label: "Replenishment", href: "/app/replenishment", icon: "replenishment" },
  { label: "Suppliers", href: "/app/suppliers", icon: "suppliers" },
  { label: "Payments", href: "/app/payments", icon: "payments" },
  { label: "Activity", href: "/app/activity", icon: "activity" },
  { label: "Settings", href: "/app/settings", icon: "settings" },
];

const ApplicationContext = createContext<{ role: OperatorRole; client: OperatorClient;tenant?:{clinic:ClinicContext;clinics:ClinicContext[];email:string} } | null>(null);

export function useApplication() {
  const context = useContext(ApplicationContext);
  if (!context) throw new Error("ApplicationShell is required.");
  return context;
}

export function ApplicationShell({ role, children,tenant }: { role: OperatorRole; children: ReactNode;tenant?:{clinic:ClinicContext;clinics:ClinicContext[];email:string} }) {
  const [client] = useState(() => new OperatorClient(undefined,tenant?.clinic.id));
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const menuToggle = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const items = dashboardNavigation;

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuToggle.current?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      if(tenant){await identityMutation('logout');router.replace('/login');router.refresh();return;}
      await client.logout();
      router.replace("/operations");
    } catch (cause) {
      setSignOutError(actionError(cause,'Could not sign out. Try again.'));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <ApplicationContext.Provider value={{ role, client,tenant }}>
      <div className={styles.app}>
        <a className={styles.skipLink} href="#application-main">Skip to application</a>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <Link className={styles.brand} href="/app" aria-label="CareCart overview">
              <span className={styles.brandMark} aria-hidden="true">
                <svg viewBox="0 0 32 32" focusable="false">
                  <path d="M20.5 8.5a10 10 0 1 0 0 15" />
                  <path d="M23 4.5v9M18.5 9h9" />
                </svg>
              </span>
              <span>CareCart</span>{(!tenant||tenant.clinic.syntheticDemo)&&<span className={styles.testnetBadge}>Sample workspace</span>}
            </Link>
            <div className={styles.workspaceIdentity}>
              <strong>{tenant?.clinic.name??'CareCart workspace'}</strong>
              <span>{tenant?tenant.clinic.role+' · '+tenant.clinic.country:'Inventory and purchasing'}</span>
            </div>
            <div className={styles.headerActions}>
              {tenant&&<ClinicSwitcher clinics={tenant.clinics} active={tenant.clinic.id}/>}
              <Link className={styles.attentionLink} href="/docs">Product guide <span aria-hidden="true">↗</span></Link>
              <div className={styles.account}>
                <span className={styles.accountAvatar} aria-hidden="true">{tenant?.email.slice(0,2).toUpperCase()??(role==='operator'?'CC':'VW')}</span>
                <span className={styles.accountRole}>{tenant?.clinic.role??(role==='operator'?'Clinic staff':'Viewer')}</span>
                <button type="button" onClick={() => void signOut()} disabled={signingOut}>
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>
            <button
              ref={menuToggle}
              type="button"
              className={styles.menuToggle}
              aria-expanded={menuOpen}
              aria-controls="application-navigation"
              aria-label={menuOpen ? "Close application navigation" : "Open application navigation"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span /><span />
            </button>
          </div>
        </header>

        <div className={styles.body}>
          <aside
            id="application-navigation"
            className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}
            aria-label="Application navigation"
          >
            <div className={styles.sidebarHeading}>
              <span>WORKSPACE</span>
            </div>
            <nav aria-label="Application sections">
              {items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={active ? styles.sideLinkActive : styles.sideLink}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className={styles.sideIcon}><WorkspaceIcon name={item.icon as WorkspaceIconName}/></span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className={styles.sidebarFoot}>
              <span className={styles.footDot} aria-hidden="true"/>
              <div><strong>{tenant?.clinic.name??"CareCart clinic"}</strong><small>{!tenant||tenant.clinic.syntheticDemo?'Sample inventory':'Clinic workspace'}</small></div>
            </div>
            <div className={styles.mobileAccount}>{tenant&&<ClinicSwitcher clinics={tenant.clinics} active={tenant.clinic.id}/>}<span>Signed in as {tenant?.clinic.role??(role==='operator'?'Staff':'Viewer')}</span><button disabled={signingOut} onClick={()=>void signOut()}>{signingOut?'Signing out…':'Sign out'}</button></div>
            {tenant&&<Link href="/onboarding">Manage clinics</Link>}
          </aside>

          <div className={styles.content}>
            <main id="application-main" className={styles.main}>
              {signOutError && <p className={styles.error} role="alert">{signOutError}. Refresh the application session before retrying.</p>}
              {children}
            </main>
          </div>
        </div>
        <nav className={styles.mobileNavigation} aria-label="Quick navigation">
          {items.filter(item=>['overview','inventory','replenishment','payments'].includes(item.icon)).map(item=><Link key={item.href} href={item.href} aria-current={pathname===item.href?'page':undefined} onClick={()=>setMenuOpen(false)}><WorkspaceIcon name={item.icon as WorkspaceIconName}/><span>{item.icon==='replenishment'?'Orders':item.label}</span></Link>)}
        </nav>
      </div>
    </ApplicationContext.Provider>
  );
}
