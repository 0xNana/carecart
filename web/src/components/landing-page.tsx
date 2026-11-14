"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./landing-page.module.css";

const steps = [
  ["Inventory", "Staff record what arrives and what gets used."],
  ["Shortage", "The monitor checks stock against reorder levels."],
  ["Purchase order", "Approved supplier offers become a saved order."],
  ["Payment", "Eligible orders proceed within the clinic’s policy."],
  ["Delivery", "Staff receive the supplies and update stock."],
];
function Brand() {
  return (
    <Link href="/" className={styles.brand} aria-label="CareCart home">
      <span className={styles.brandMark} aria-hidden="true">
        <svg viewBox="0 0 32 32" focusable="false">
          <path d="M20.5 8.5a10 10 0 1 0 0 15M23 4.5v9M18.5 9h9" />
        </svg>
      </span>
      CareCart
    </Link>
  );
}
export function LandingPage({ appOrigin = "" }: { appOrigin?: string }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const app = appOrigin ? appOrigin + "/" : "/app";
  useEffect(() => {
    if (!open) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);
  return (
    <div className={styles.site}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.navInner}>
          <Brand />
          <button
            ref={toggle}
            className={styles.menuToggle}
            type="button"
            aria-expanded={open}
            aria-controls="site-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? "Close menu" : "Menu"}
          </button>
          <nav
            id="site-navigation"
            className={`${styles.nav} ${open ? styles.navOpen : ""}`}
            aria-label="Main navigation"
          >
            <a href="#product-demo" onClick={() => setOpen(false)}>
              Product
            </a>
            <a href="#how-it-works" onClick={() => setOpen(false)}>
              How it works
            </a>
            <a href="#security" onClick={() => setOpen(false)}>
              Spending controls
            </a>
            <Link href="/docs">Documentation</Link>
            <Link className={styles.navApp} href={app}>
              Open app <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>
      <main id="main-content" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <p className={styles.eyebrow}>THE CLINIC SUPPLY WORKSPACE</p>
          <h1 id="hero-title">
            Your medical supplies shouldn&apos;t run out before you notice.
          </h1>
          <div className={styles.heroBottom}>
            <p>
              Record stock. Spot shortages. Keep purchasing moving.
              <br />
              CareCart replenishes essential supplies within the budget and
              supplier rules your clinic sets.
            </p>
            <div className={styles.actions}>
              <Link className={styles.primary} href={app}>
                Open clinic app <span aria-hidden="true">↗</span>
              </Link>
              <a className={styles.secondary} href="#product-demo">
                View product walkthrough <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
          <p className={styles.releaseNote}>
            <span aria-hidden="true" />
            NEAR Testnet · CCUSD demonstration tokens · No real-money purchases
          </p>
          <figure className={styles.productScreen} id="product-demo">
            <div className={styles.screenBar}>
              <span>CARECART / WORKSPACE</span>
              <span>Actual application · sample clinic</span>
            </div>
            <a
              href="/screenshots/carecart-product-preview.png"
              target="_blank"
              rel="noreferrer"
              aria-label="Open full-size CareCart overview screenshot"
            >
              <Image
                src="/screenshots/carecart-product-preview.png"
                width={1440}
                height={1000}
                priority
                alt="CareCart clinic overview with stock counts, low-stock supplies, expected deliveries and stock actions."
              />
            </a>
            <figcaption>
              One place for stock, orders and payment records. Captured from the
              working app using synthetic inventory.
            </figcaption>
          </figure>
        </section>
        <section
          className={styles.workflowSection}
          id="how-it-works"
          aria-labelledby="workflow-title"
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>FROM STOCKROOM TO SUPPLIER</p>
            <h2 id="workflow-title">
              A shortage should start a workflow,
              <br />
              not a scramble.
            </h2>
          </div>
          <ol className={styles.workflow}>
            {steps.map(([title, description], i) => (
              <li key={title}>
                <span className={styles.stepNumber}>0{i + 1}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
          <div className={styles.inventoryStory}>
            <div>
              <p className={styles.eyebrow}>START WITH RELIABLE STOCK</p>
              <h3>Every box accounted for.</h3>
              <p>
                Receive stock with supplier, lot and receipt details. Record
                dispensing, consumption and adjustments as they happen. Keep
                physical delivery separate from payment confirmation.
              </p>
              <Link className={styles.textLink} href="/docs/inventory-guide">
                Read the inventory guide ↗
              </Link>
            </div>
            <figure>
              <a
                href="/screenshots/carecart-stock-receiving.png"
                target="_blank"
                rel="noreferrer"
                aria-label="Open full-size stock receiving screenshot"
              >
                <Image
                  src="/screenshots/carecart-stock-receiving.png"
                  width={1440}
                  height={1000}
                  alt="Actual CareCart stock receiving form with quantity, supplier, lot and receipt fields."
                />
              </a>
              <figcaption>
                Stock receiving in the working app · synthetic data.
              </figcaption>
            </figure>
          </div>
        </section>
        <section
          className={styles.policySection}
          id="security"
          aria-labelledby="policy-title"
        >
          <div>
            <p className={styles.eyebrow}>AUTONOMY WITH LIMITS</p>
            <h2 id="policy-title">Give AI a budget, not your wallet.</h2>
            <p>
              Set the suppliers, supplies and amount a clinic can spend
              automatically. Eligible orders can proceed automatically;
              purchases outside those rules stay on hold for review.
            </p>
            <Link className={styles.textLink} href="/docs/safety-and-data">
              Understand the spending controls ↗
            </Link>
          </div>
          <dl className={styles.controls}>
            <div>
              <dt>Approved suppliers</dt>
              <dd>
                The order and recipient must match the configured supplier.
              </dd>
            </div>
            <div>
              <dt>Bounded spending</dt>
              <dd>
                The NEAR policy vault checks order limits, daily caps and pause
                controls.
              </dd>
            </div>
            <div>
              <dt>Separate permissions</dt>
              <dd>
                Stock monitoring and AI planning do not hold payment signing
                keys.
              </dd>
            </div>
            <div>
              <dt>Verified payment records</dt>
              <dd>
                A submitted transaction stays pending until an independent
                observer confirms the payment.
              </dd>
            </div>
          </dl>
        </section>
        <section className={styles.scope} aria-labelledby="scope-title">
          <p className={styles.eyebrow}>WHERE WE ARE TODAY</p>
          <h2 id="scope-title">
            A working testnet release.
            <br />A deliberate path to clinic pilots.
          </h2>
          <p>
            CareCart currently uses CCUSD, a demonstration token with no cash
            value. It is not Circle USDC. The recorded supplier payment used a
            controlled test account. Real supplier integrations, mainnet
            payments and clinic pilots remain ahead.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href={app}>
              Explore the workspace ↗
            </Link>
            <Link className={styles.secondary} href="/docs/mainnet-readiness">
              Read the rollout plan ↗
            </Link>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <Brand />
        <p>Medical supplies. Clear records. Controlled purchasing.</p>
        <nav aria-label="Footer navigation">
          <Link href="/docs">Product docs</Link>
          <Link href={app}>Open app</Link>
          <a
            href="https://github.com/0xNana/carecart"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
        <small>Built on NEAR · Testnet release</small>
      </footer>
    </div>
  );
}
