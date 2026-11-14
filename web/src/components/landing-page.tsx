"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SupplyDrawing } from "./landing-illustrations";
import styles from "./landing-page.module.css";

const journey = [
  {
    label: "Inventory",
    title: "Start with what is on the shelf.",
    copy: "Record supplies received, dispensed and used. Keep quantities, batches and expiry dates in one place.",
    kind: "stock",
    detail: "Stock changes when your team records a movement.",
  },
  {
    label: "Shortage",
    title: "Catch the need before the rush.",
    copy: "Stock checks compare available supplies with reorder levels, expected usage and delivery lead times.",
    kind: "stock",
    detail: "A shortage can start a replenishment request in the background.",
  },
  {
    label: "Order",
    title: "Turn the shortage into an order.",
    copy: "Compare approved supplier offers and prepare a purchase order with a clear quantity, cost and next step.",
    kind: "order",
    detail: "Supplier selection and order details stay with the request.",
  },
  {
    label: "Payment",
    title: "Keep the purchase inside your rules.",
    copy: "Eligible orders can proceed automatically within the clinic’s approved budget. Exceptions remain on hold for review.",
    kind: "shield",
    detail: "Submitted payments remain pending until independently confirmed.",
  },
  {
    label: "Delivery",
    title: "Close the loop when supplies arrive.",
    copy: "Record the delivery against the order, including the supplier, lot and receipt. Your stock updates with the goods you receive.",
    kind: "delivery",
    detail:
      "Payment confirmation and physical delivery are recorded separately.",
  },
] as const;
const features = [
  {
    kind: "stock",
    number: "01",
    title: "A clear view of every supply.",
    copy: "Receipts, consumption, dispensing and adjustments share one stock history. Your team can see what is available and what needs attention.",
    href: "/docs/inventory-guide",
    link: "Explore inventory",
  },
  {
    kind: "order",
    number: "02",
    title: "Replenishment that keeps moving.",
    copy: "Background checks find shortages, compare supplier offers and prepare the next order. Every request has a visible state and next step.",
    href: "/docs/how-it-works",
    link: "Follow a replenishment",
  },
  {
    kind: "shield",
    number: "03",
    title: "A budget with boundaries.",
    copy: "Choose the items, suppliers and amount your clinic can spend automatically. The policy vault checks limits before a payment proceeds.",
    href: "/docs/purchasing-and-payments",
    link: "Understand payments",
  },
] as const;
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
  const app = appOrigin ? appOrigin + "/" : "/app";
  const [menuOpen, setMenuOpen] = useState(false),
    [step, setStep] = useState(0);
  const menuButton = useRef<HTMLButtonElement>(null),
    tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (!menuOpen) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [menuOpen]);
  function moveStep(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % journey.length;
    else if (event.key === "ArrowLeft")
      next = (index + journey.length - 1) % journey.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = journey.length - 1;
    else return;
    event.preventDefault();
    setStep(next);
    tabButtons.current[next]?.focus();
  }
  const active = journey[step];
  return (
    <div className={styles.site}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.navInner}>
          <Brand />
          <button
            ref={menuButton}
            className={styles.menuToggle}
            aria-expanded={menuOpen}
            aria-controls="site-navigation"
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? "Close" : "Menu"}
            <span aria-hidden="true">{menuOpen ? "−" : "+"}</span>
          </button>
          <nav
            id="site-navigation"
            className={`${styles.nav} ${menuOpen ? styles.navOpen : ""}`}
            aria-label="Main navigation"
          >
            <a href="#how-it-works" onClick={() => setMenuOpen(false)}>
              How it works
            </a>
            <a href="#controls" onClick={() => setMenuOpen(false)}>
              Controls
            </a>
            <a href="#questions" onClick={() => setMenuOpen(false)}>
              FAQ
            </a>
            <Link href="/docs">Docs</Link>
            <Link className={styles.navApp} href={app}>
              Open app <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>
      <main id="main-content" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroGrid} aria-hidden="true" />
          <div className={styles.heroContent}>
            <p className={styles.kicker}>
              <span /> THE CLINIC SUPPLY WORKSPACE
            </p>
            <h1 id="hero-title">
              Your medical supplies shouldn&apos;t run out{" "}
              <span>before you notice.</span>
            </h1>
            <p className={styles.heroLead}>
              Stay on top of stock. Let the next order take shape.
              <br className={styles.desktopBreak} /> CareCart keeps
              replenishment moving within the rules your clinic sets.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primary} href={app}>
                Open clinic app <span aria-hidden="true">↗</span>
              </Link>
              <a className={styles.secondary} href="#how-it-works">
                See how it works <span aria-hidden="true">↓</span>
              </a>
            </div>
            <div className={styles.journey} id="how-it-works">
              <div className={styles.journeyTop}>
                <span className={styles.journeyLabel}>
                  <span className={styles.smallMark} aria-hidden="true">
                    C<span>+</span>
                  </span>
                  One connected workflow
                </span>
                <span className={styles.illustrationLabel}>
                  Interactive guide
                </span>
              </div>
              <div
                role="tablist"
                aria-label="Explore the supply workflow"
                className={styles.stepTabs}
              >
                {journey.map((item, index) => (
                  <button
                    key={item.label}
                    ref={(element) => {
                      tabButtons.current[index] = element;
                    }}
                    type="button"
                    role="tab"
                    id={"workflow-tab-" + index}
                    aria-selected={step === index}
                    aria-controls="workflow-panel"
                    tabIndex={step === index ? 0 : -1}
                    onClick={() => setStep(index)}
                    onKeyDown={(event) => moveStep(event, index)}
                  >
                    <span className={styles.stepDot}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {item.label}
                  </button>
                ))}
              </div>
              <div
                id="workflow-panel"
                role="tabpanel"
                aria-labelledby={"workflow-tab-" + step}
                tabIndex={0}
                className={styles.journeyPanel}
              >
                <div className={styles.journeyDrawing}>
                  <SupplyDrawing kind={active.kind} />
                </div>
                <div>
                  <p className={styles.panelEyebrow}>
                    {String(step + 1).padStart(2, "0")} / {active.label}
                  </p>
                  <h2>{active.title}</h2>
                  <p>{active.copy}</p>
                </div>
              </div>
              <p className={styles.journeyFoot}>{active.detail}</p>
            </div>
            <p className={styles.heroFoot}>
              Built for clinic operations. <span>Running on NEAR Testnet.</span>
            </p>
          </div>
        </section>
        <div className={styles.contentFrame}>
          <section className={styles.features} aria-labelledby="features-title">
            <div className={styles.sectionIntro}>
              <h2 id="features-title">
                Keep supplies moving.
                <br />
                <span>Keep care going.</span>
              </h2>
              <p>
                Stock, purchasing and payments share one trail. Your team sees
                what needs attention and what happens next.
              </p>
            </div>
            <div className={styles.featureGrid}>
              {features.map((feature) => (
                <article key={feature.number}>
                  <div className={styles.featureDrawing}>
                    <SupplyDrawing kind={feature.kind} />
                    <span>{feature.number}</span>
                  </div>
                  <h3>{feature.title}</h3>
                  <p>{feature.copy}</p>
                  <Link href={feature.href} className={styles.textLink}>
                    {feature.link}
                    <span aria-hidden="true">↗</span>
                  </Link>
                </article>
              ))}
            </div>
          </section>
          <section
            className={styles.controls}
            id="controls"
            aria-labelledby="controls-title"
          >
            <div className={styles.sectionIntro}>
              <h2 id="controls-title">
                Give AI a budget,
                <br />
                <span>not your wallet.</span>
              </h2>
              <p>
                Choose the supplies, suppliers and spending limit. Eligible
                orders can proceed automatically; purchases outside those rules
                stay on hold for review.
              </p>
            </div>
            <div className={styles.controlBody}>
              <div
                className={styles.policyDiagram}
                role="img"
                aria-label="Approved suppliers and clinic spending limits are checked by the NEAR policy vault. Eligible purchases continue; exceptions are held for review."
              >
                <div className={styles.policyInputs}>
                  <span>Approved suppliers</span>
                  <span>Order &amp; daily limits</span>
                  <span>Pause control</span>
                </div>
                <div className={styles.policyCore}>
                  <span className={styles.coreDrawing}>
                    <SupplyDrawing kind="shield" />
                  </span>
                  <strong>NEAR policy vault</strong>
                  <small>Check before payment</small>
                </div>
                <div className={styles.policyOutputs}>
                  <span>
                    <i aria-hidden="true" />
                    Within policy<small>Continue</small>
                  </span>
                  <span>
                    <i aria-hidden="true" />
                    Needs review<small>Hold</small>
                  </span>
                </div>
              </div>
              <div className={styles.controlNotes}>
                <div>
                  <span>01</span>
                  <h3>Separate permissions</h3>
                  <p>
                    Inventory monitoring and AI planning do not hold payment
                    signing keys.
                  </p>
                </div>
                <div>
                  <span>02</span>
                  <h3>Confirmation you can trace</h3>
                  <p>
                    A submitted transaction stays pending until an independent
                    observer confirms the payment.
                  </p>
                </div>
                <div>
                  <span>03</span>
                  <h3>Delivery stays physical</h3>
                  <p>
                    Stock increases when your team records the goods received,
                    separately from payment.
                  </p>
                </div>
              </div>
            </div>
            <Link href="/docs/safety-and-data" className={styles.sectionLink}>
              Read about the spending controls{" "}
              <span aria-hidden="true">↗</span>
            </Link>
          </section>
          <section
            className={styles.questions}
            id="questions"
            aria-labelledby="questions-title"
          >
            <div>
              <p className={styles.panelEyebrow}>A FEW THINGS TO KNOW</p>
              <h2 id="questions-title">
                Clear from
                <br />
                <span>the start.</span>
              </h2>
              <Link href="/docs" className={styles.textLink}>
                Read the product guide <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <div className={styles.faqList}>
              <details>
                <summary>
                  What can CareCart do automatically?
                  <span aria-hidden="true" />
                </summary>
                <p>
                  CareCart can monitor stock, open replenishment requests,
                  compare supplier offers and prepare orders. Eligible purchases
                  can proceed under a clinic-approved policy. Orders outside
                  those limits remain for review.
                </p>
              </details>
              <details>
                <summary>
                  How does my team keep stock up to date?
                  <span aria-hidden="true" />
                </summary>
                <p>
                  Record receipts, dispensing, consumption and adjustments in
                  Inventory. Supplier, batch, expiry and receipt details stay
                  with the movement, giving the team a shared stock history.
                </p>
              </details>
              <details>
                <summary>
                  Does the current release use real money?
                  <span aria-hidden="true" />
                </summary>
                <p>
                  The current release runs on NEAR testnet with CCUSD, a
                  demonstration token with no cash value. It is not Circle USDC.
                  Payment demonstrations use controlled test supplier accounts.
                </p>
              </details>
              <details>
                <summary>
                  When is a payment shown as confirmed?
                  <span aria-hidden="true" />
                </summary>
                <p>
                  After independent verification of the payment receipt.
                  Submitting a transaction alone does not mark it as paid.
                  Physical delivery is recorded separately.
                </p>
              </details>
              <details>
                <summary>
                  What comes next for CareCart?
                  <span aria-hidden="true" />
                </summary>
                <p>
                  Clinic pilots, real supplier integrations and mainnet payments
                  are the next steps. Explore the{" "}
                  <Link href="/docs/product-roadmap">roadmap</Link> and{" "}
                  <Link href="/docs/clinic-pilot">pilot plan</Link> for the
                  rollout requirements.
                </p>
              </details>
            </div>
          </section>
          <section className={styles.finalCta} aria-labelledby="cta-title">
            <span className={styles.ctaMark} aria-hidden="true">
              C<span>+</span>
            </span>
            <h2 id="cta-title">
              Make room for
              <br />
              <span>a better-stocked clinic.</span>
            </h2>
            <p>Start with clear stock records. Build purchasing around them.</p>
            <div className={styles.heroActions}>
              <Link href={app} className={styles.primary}>
                Open CareCart <span aria-hidden="true">↗</span>
              </Link>
              <Link href="/docs" className={styles.secondary}>
                Explore the docs <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </section>
        </div>
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <div>
            <Brand />
            <p>
              Medical supplies.
              <br />
              Clear records. Controlled purchasing.
            </p>
          </div>
          <nav aria-label="Footer navigation">
            <div>
              <span>PRODUCT</span>
              <Link href={app}>Clinic workspace</Link>
              <Link href="/docs/inventory-guide">Inventory guide</Link>
              <Link href="/docs/purchasing-and-payments">
                Purchasing &amp; payments
              </Link>
            </div>
            <div>
              <span>EXPLORE</span>
              <Link href="/docs/product-roadmap">Roadmap</Link>
              <Link href="/docs/clinic-pilot">Clinic pilots</Link>
              <a
                href="https://github.com/0xNana/carecart"
                target="_blank"
                rel="noreferrer"
              >
                GitHub ↗
              </a>
            </div>
          </nav>
        </div>
        <div className={styles.footerBottom}>
          <span>CareCart · Built on NEAR</span>
          <span>Testnet release · CCUSD has no cash value</span>
          <a href="#main-content">Back to top ↑</a>
        </div>
      </footer>
    </div>
  );
}
