"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./landing-page.module.css";

const githubUrl = "https://github.com/0xNana/carecart";

const navigation = [
  { label: "Product", href: "#product" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Security", href: "#security" },
  { label: "Technology", href: "#technology" },
];

const workflow = [
  ["01", "Monitor inventory", "Track stock, use and incoming supply."],
  ["02", "Detect shortage", "Compare coverage with lead times and safety stock."],
  ["03", "Evaluate suppliers", "Review eligible suppliers, quotes and terms."],
  ["04", "Prepare procurement", "Prepare a purchase order from the selected quote."],
  ["05", "Authorize and pay", "Review payment requirements and spending limits."],
  ["06", "Verify and reconcile", "Verify payment, then record goods received."],
];

function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <Link
      className={`${styles.brand} ${footer ? styles.brandFooter : ""}`}
      href="/"
      aria-label="CareCart home"
    >
      <span className={styles.brandMark} aria-hidden="true">
        <svg viewBox="0 0 32 32" focusable="false">
          <path d="M20.5 8.5a10 10 0 1 0 0 15" />
          <path d="M23 4.5v9M18.5 9h9" />
        </svg>
      </span>
      <span>CareCart</span>
    </Link>
  );
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      className={styles.arrowIcon}
    >
      {diagonal ? (
        <path d="M5 15 15 5M6 5h9v9" />
      ) : (
        <path d="M3 10h13m-5-5 5 5-5 5" />
      )}
    </svg>
  );
}

function Check() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
      <path d="m4 10 4 4 8-8" />
    </svg>
  );
}

export function LandingPage() {
  const menuToggle=useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [poPrepared, setPoPrepared] = useState(false);

  useEffect(()=>{if(!menuOpen)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenuOpen(false);menuToggle.current?.focus();}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[menuOpen]);
  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className={styles.landing}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Brand />
          <button
            type="button"
            ref={menuToggle}
            className={styles.menuToggle}
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
          </button>
          <nav
            id="primary-navigation"
            aria-label="Main navigation"
            className={`${styles.navigation} ${menuOpen ? styles.navigationOpen : ""}`}
          >
            <div className={styles.navLinks}>
              {navigation.map((item) => (
                <a key={item.href} href={item.href} onClick={closeMenu}>
                  {item.label}
                </a>
              ))}
              <a href={githubUrl} target="_blank" rel="noreferrer">
                GitHub <Arrow diagonal />
              </a>
            </div>
            <div className={styles.navActions}>
              <a className={styles.navDemo} href="#interactive-demo" onClick={closeMenu}>
                Explore demo
              </a>
              <Link className={styles.navApp} href="/app" onClick={closeMenu}>
                Open app <Arrow />
              </Link>
            </div>
          </nav>
        </div>
      </header>

      <main id="main-content" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>
                <span className={styles.eyebrowDot} />
                Autonomous healthcare procurement
              </p>
              <h1 id="hero-title">
                Your medical supplies shouldn&apos;t run out before you notice.
              </h1>
              <p className={styles.heroDescription}>
                Record stock as it arrives and is used. CareCart checks for shortages, compares approved offers and prepares the next order.
              </p>
              <p>NEAR Testnet MVP · synthetic suppliers and CCUSD test tokens, not Circle USDC. Signing requires separate owner activation.</p>
              <div className={styles.heroActions}>
                <a className={styles.buttonPrimary} href="#interactive-demo">
                  Explore demo <Arrow />
                </a>
                <a className={styles.buttonSecondary} href="#how-it-works">
                  See how it works
                </a>
              </div>
              <p className={styles.tagline}>
                <span aria-hidden="true">✳</span> Give AI a budget, not your wallet.
              </p>
            </div>

            <div className={styles.heroVisual} id="interactive-demo">
              <div className={styles.visualGlow} aria-hidden="true" />
              <div className={styles.productWindow}>
                <div className={styles.windowTop}>
                  <div className={styles.windowBrand}>
                    <span className={styles.windowMark} aria-hidden="true">
                      <svg viewBox="0 0 32 32" focusable="false">
                        <path d="M20.5 8.5a10 10 0 1 0 0 15" />
                        <path d="M23 4.5v9M18.5 9h9" />
                      </svg>
                    </span>
                    <span>CareCart</span>
                    <span className={styles.windowDivider}>/</span>
                    <span className={styles.windowWorkspace}>Inventory</span>
                  </div>
                  <span className={styles.syntheticBadge}>
                    <span /> Synthetic preview
                  </span>
                </div>
                <div className={styles.productContent}>
                  <div className={styles.clinicHeading}>
                    <div>
                      <p className={styles.microLabel}>CLINIC WORKSPACE</p>
                      <h2>Northside Community Clinic</h2>
                    </div>
                    <span className={styles.avatar} aria-label="Synthetic clinic">
                      NC
                    </span>
                  </div>
                  <div className={styles.healthStrip}>
                    <div className={styles.healthMetric}>
                      <span className={styles.healthIcon} aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M4 19V5m0 14h16M8 15l4-4 3 2 5-7" />
                        </svg>
                      </span>
                      <span>
                        <small>Inventory health</small>
                        <strong>Needs attention</strong>
                      </span>
                    </div>
                    <div className={styles.healthMetric}>
                      <span className={`${styles.healthIcon} ${styles.healthIconMint}`} aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M12 3v18m6-12a4 4 0 0 0-4-3h-4a4 4 0 0 0 0 8h4a4 4 0 0 1 0 8h-4a4 4 0 0 1-4-3" />
                        </svg>
                      </span>
                      <span>
                        <small>Procurement</small>
                        <strong>{poPrepared ? "Draft ready for review" : "1 case to prepare"}</strong>
                      </span>
                    </div>
                  </div>

                  <div className={styles.inventoryPanel}>
                    <div className={styles.panelHeading}>
                      <div>
                        <p className={styles.microLabel}>LOW-STOCK ALERT</p>
                        <h3>Medical gloves</h3>
                      </div>
                      <span className={styles.attentionPill}>Reorder now</span>
                    </div>
                    <div className={styles.gloveStats}>
                      <div>
                        <strong>12</strong>
                        <span>boxes on hand</span>
                      </div>
                      <div>
                        <strong>4</strong>
                        <span>used per day</span>
                      </div>
                      <div>
                        <strong>5 days</strong>
                        <span>supplier lead time</span>
                      </div>
                    </div>
                    <div className={styles.stockTrack} aria-label="12 boxes in stock; reorder point is 28 boxes">
                      <span />
                      <i />
                    </div>
                    <div className={styles.stockLegend}>
                      <span><i className={styles.legendCurrent} /> On hand: 12 boxes</span>
                      <span><i className={styles.legendThreshold} /> Reorder point: 28</span>
                    </div>
                  </div>

                  <div className={styles.activityPanel}>
                    <div className={styles.activityIcon} aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M12 3v3m0 12v3M4.6 4.6l2.1 2.1m10.6 10.6 2.1 2.1M3 12h3m12 0h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1M12 8l1.2 2.8L16 12l-2.8 1.2L12 16l-1.2-2.8L8 12l2.8-1.2L12 8Z" />
                      </svg>
                    </div>
                    <div className={styles.activityCopy}>
                      <strong>{poPrepared ? "Sample purchase order prepared" : "Shortage detected"}</strong>
                      <span>
                        {poPrepared
                          ? "36 boxes suggested · payment review pending"
                          : "Coverage is below supplier lead time"}
                      </span>
                    </div>
                    <span className={styles.activityTime}>{poPrepared ? "DRAFT" : "NOW"}</span>
                  </div>

                  <div className={styles.policyRow}>
                    <span className={styles.policyShield} aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M12 3 5 6v5c0 4.5 2.8 8.2 7 10 4.2-1.8 7-5.5 7-10V6l-7-3Z" />
                        <path d="m9 12 2 2 4-4" />
                      </svg>
                    </span>
                    <span>
                      <strong>Financial policy</strong>
                      <small>Payment review required</small>
                    </span>
                    <span className={styles.policyStatus}>POLICY CONTROLLED</span>
                  </div>
                </div>
                <div className={styles.demoControls}>
                  <div>
                    <span className={styles.demoIndicator} />
                    <span>Illustrative example</span>
                  </div>
                  <button
                    type="button"
                    className={styles.demoButton}
                    onClick={() => setPoPrepared((prepared) => !prepared)}
                  >
                    {poPrepared ? "Reset example" : "Prepare sample PO"}
                    <Arrow />
                  </button>
                </div>
                <p className={styles.srOnly} aria-live="polite" role="status">
                  {poPrepared
                    ? "Synthetic purchase order prepared. 36 boxes suggested. Payment review is pending. No transaction was initiated."
                    : "Synthetic shortage detected. Medical gloves are below the reorder point. No transaction was initiated."}
                </p>
              </div>
              <p className={styles.visualCaption}>
                <span>01</span> A shortage becomes a purchasing decision
              </p>
            </div>
          </div>
          <div className={styles.heroFoot}>
            <span>BUILT FOR HEALTHCARE OPERATIONS</span>
            <span className={styles.heroFootLine} />
            <span>PAYMENTS WITH SPENDING CONTROLS</span>
          </div>
        </section>

        <section className={styles.problemSection} aria-labelledby="problem-title">
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>The cost of reactive procurement</p>
            <h2 id="problem-title">Healthcare procurement is still too reactive.</h2>
            <p>
              The work between noticing a shortage and resolving it is scattered
              across spreadsheets, inboxes and disconnected approvals.
            </p>
          </div>
          <div className={styles.problemGrid}>
            <article className={styles.problemCard}>
              <span className={styles.problemNumber}>01</span>
              <span className={styles.problemSymbol} aria-hidden="true">↘</span>
              <h3>Shortages surface too late</h3>
              <p>Teams discover critical supplies are low after the buffer is already gone.</p>
            </article>
            <article className={styles.problemCard}>
              <span className={styles.problemNumber}>02</span>
              <span className={styles.problemSymbol} aria-hidden="true">⌁</span>
              <h3>Purchasing lives in silos</h3>
              <p>Supplier sourcing, quote review and purchase orders rarely share one trail.</p>
            </article>
            <article className={styles.problemCard}>
              <span className={styles.problemNumber}>03</span>
              <span className={styles.problemSymbol} aria-hidden="true">↔</span>
              <h3>Money is hard to reconcile</h3>
              <p>Approvals, payments, invoices and deliveries are difficult to connect.</p>
            </article>
          </div>
        </section>

        <section className={styles.workflowSection} id="how-it-works" aria-labelledby="workflow-title">
          <div className={`${styles.sectionIntro} ${styles.sectionIntroCentered}`}>
            <p className={styles.eyebrow}>How it works</p>
            <h2 id="workflow-title">From stockroom to purchase order.</h2>
            <p>
              Stock monitoring runs in the background. Staff review exceptions and record deliveries.
            </p>
          </div>
          <ol className={styles.workflow}>
            {workflow.map(([number, title, description], index) => (
              <li key={number} className={styles.workflowStep}>
                <span className={styles.workflowNode}>
                  {index === workflow.length - 1 ? <Check /> : number}
                </span>
                {index < workflow.length - 1 && <span className={styles.workflowConnector} aria-hidden="true" />}
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
          <p className={styles.workflowNote}>
            <span aria-hidden="true">↳</span>
            Payments follow vault policy. Public human purchase approval is still in development.
          </p>
        </section>

        <section className={styles.productSection} id="product" aria-labelledby="product-title">
          <div className={styles.productIntro}>
            <div className={styles.sectionIntro}>
              <p className={styles.eyebrow}>A connected operations layer</p>
              <h2 id="product-title">One clear path from stockroom to supplier.</h2>
            </div>
            <p>
              Purpose-built for the decisions and evidence that make healthcare
              procurement accountable.
            </p>
          </div>

          <article className={`${styles.showcase} ${styles.showcaseInventory}`}>
            <div className={styles.showcaseCopy}>
              <span className={styles.showcaseIndex}>01 / SEE WHAT NEEDS ATTENTION</span>
              <h3>Inventory intelligence</h3>
              <p>
                Bring stock, consumption, reorder thresholds, expiries and incoming
                supply into one operational view.
              </p>
              <ul>
                <li><Check /> On-hand stock and usage signals</li>
                <li><Check /> Reorder points informed by lead time</li>
                <li><Check /> Expiry and incoming-stock visibility</li>
              </ul>
            </div>
            <div className={styles.showcaseVisual}>
              <div className={styles.inventoryMock}>
                <div className={styles.mockHeader}>
                  <div>
                    <span className={styles.mockKicker}>INVENTORY OVERVIEW</span>
                    <strong>Supply levels</strong>
                  </div>
                  <span className={styles.mockSelect}>All supplies <span>⌄</span></span>
                </div>
                <div className={styles.mockTableHead}>
                  <span>ITEM</span><span>ON HAND</span><span>STATUS</span>
                </div>
                <div className={styles.stockRow}>
                  <span className={styles.itemMark}>MG</span>
                  <span className={styles.stockItemName}><strong>Medical gloves</strong><small>Reorder at 28 boxes</small></span>
                  <span className={styles.stockQuantity}>12 <small>boxes</small></span>
                  <span className={styles.stockStatusLow}><i /> Reorder</span>
                </div>
                <div className={styles.stockRow}>
                  <span className={`${styles.itemMark} ${styles.itemMarkBlue}`}>SY</span>
                  <span className={styles.stockItemName}><strong>Syringes · 5 mL</strong><small>Reorder at 160 units</small></span>
                  <span className={styles.stockQuantity}>214 <small>units</small></span>
                  <span className={styles.stockStatusGood}><i /> In range</span>
                </div>
                <div className={styles.stockRow}>
                  <span className={`${styles.itemMark} ${styles.itemMarkGold}`}>SA</span>
                  <span className={styles.stockItemName}><strong>Saline · 500 mL</strong><small>Expires in 42 days</small></span>
                  <span className={styles.stockQuantity}>86 <small>bags</small></span>
                  <span className={styles.stockStatusSoon}><i /> Expiring</span>
                </div>
                <div className={styles.incomingStrip}>
                  <span className={styles.incomingIcon} aria-hidden="true">↓</span>
                  <span><strong>Incoming inventory</strong><small>Gauze pads · 240 units expected Jun 18</small></span>
                  <span className={styles.incomingState}>IN TRANSIT</span>
                </div>
                <p className={styles.mockDisclosure}>Illustrative interface · synthetic supplies and values</p>
              </div>
            </div>
          </article>

          <article className={`${styles.showcase} ${styles.showcaseReplenishment}`}>
            <div className={`${styles.showcaseCopy} ${styles.showcaseCopySecond}`}>
              <span className={styles.showcaseIndex}>02 / TURN SIGNALS INTO A CASE</span>
              <h3>Autonomous replenishment</h3>
              <p>
                Shortage detection opens a replenishment request, compare eligible supplier
                options and prepare a purchase order with a traceable decision history.
              </p>
              <ul>
                <li><Check /> Supplier eligibility and quote comparison</li>
                <li><Check /> Purchase orders with clear approval requirements</li>
                <li><Check /> Decision trace with accountable next steps</li>
              </ul>
            </div>
            <div className={styles.showcaseVisual}>
              <div className={styles.caseMock}>
                <div className={styles.caseTop}>
                  <span className={styles.caseLabel}><span /> REPLENISHMENT CASE</span>
                  <span className={styles.caseRef}>CASE · CC-2048</span>
                </div>
                <h4>Medical gloves</h4>
                <p className={styles.caseSubhead}>Northside Community Clinic <span>·</span> Synthetic data</p>
                <div className={styles.caseProgress}>
                  <div><span className={styles.progressComplete}><Check /></span><span><strong>Shortage detected</strong><small>12 on hand · reorder point 28</small></span><i>DONE</i></div>
                  <div><span className={styles.progressComplete}><Check /></span><span><strong>Supplier evaluated</strong><small>2 eligible options compared</small></span><i>DONE</i></div>
                  <div><span className={styles.progressCurrent}>03</span><span><strong>Purchase order draft</strong><small>36 boxes suggested · policy check pending</small></span><i className={styles.progressReview}>REVIEW</i></div>
                </div>
                <div className={styles.caseBottom}>
                  <span><span className={styles.caseAvatar}>AI</span> Procurement coordination</span>
                  <span className={styles.caseApproval}>Payment review required</span>
                </div>
                <p className={styles.mockDisclosure}>Illustrative case · no supplier order or payment created</p>
              </div>
            </div>
          </article>

          <article className={`${styles.showcase} ${styles.showcasePayments}`}>
            <div className={styles.showcaseCopy}>
              <span className={styles.showcaseIndex}>03 / KEEP FINANCIAL AUTHORITY BOUNDED</span>
              <h3>Policy-controlled payments</h3>
              <p>
                Before settlement, validate the supplier and recipient, check
                configured limits, collect human approval where required and verify
                the transaction independently.
              </p>
              <ul>
                <li><Check /> Approved-supplier and recipient checks</li>
                <li><Check /> NEAR policy vault, spend limits and human review</li>
                <li><Check /> Testnet transaction evidence and payment status</li>
              </ul>
            </div>
            <div className={styles.showcaseVisual}>
              <div className={styles.paymentMock}>
                <div className={styles.paymentHeader}>
                  <div>
                    <span className={styles.mockKicker}>PAYMENT CONTROL PREVIEW</span>
                    <strong>Supplier settlement</strong>
                  </div>
                  <span className={styles.previewTag}>ILLUSTRATIVE</span>
                </div>
                <div className={styles.paymentAmount}>
                  <span>Purchase order · PO-1042</span>
                  <strong>1.50 <small>CCUSD</small></strong>
                  <span>Northstar Medical Supply · Example terms</span>
                </div>
                <div className={styles.paymentChecks}>
                  <div><span className={styles.checkPassed}><Check /></span><span><strong>Supplier &amp; recipient</strong><small>Must match approved records</small></span><span className={styles.checkState}>CHECKED</span></div>
                  <div><span className={styles.checkPassed}><Check /></span><span><strong>Spending policy</strong><small>Configured caps and permissions</small></span><span className={styles.checkState}>CHECKED</span></div>
                  <div><span className={styles.checkPending}>03</span><span><strong>Human authorization</strong><small>Public wallet approval not yet available</small></span><span className={styles.checkWaiting}>REQUIRED</span></div>
                </div>
                <div className={styles.settlementNotice}>
                  <span className={styles.settlementPulse} />
                  <span><strong>Payment not initiated</strong><small>Independent verification is required before confirmation.</small></span>
                </div>
                <p className={styles.mockDisclosure}>Illustrative controls · not a live payment</p>
              </div>
            </div>
          </article>
        </section>

        <section className={styles.securitySection} id="security" aria-labelledby="security-title">
          <div className={styles.securityInner}>
            <div className={styles.securityCopy}>
              <p className={styles.eyebrowLight}>Financial authority, by design</p>
              <h2 id="security-title">Give AI a budget, not your wallet.</h2>
              <p>
                CareCart prepares purchasing work while the policy vault checks eligible suppliers and spending limits. Separate role workers handle authorized testnet payments.
              </p>
              <Link className={styles.securityLink} href="/app/payments">
                Review payments <Arrow />
              </Link>
            </div>
            <ul className={styles.securityList}>
              <li><span><Check /></span><span><strong>Contract-enforced spending caps</strong><small>Configured limits constrain eligible payouts.</small></span></li>
              <li><span><Check /></span><span><strong>Approved supplier restrictions</strong><small>Recipient checks tie payment terms to trusted records.</small></span></li>
              <li><span><Check /></span><span><strong>Immutable purchase-order commitments</strong><small>Reviewed obligations are bound before execution.</small></span></li>
              <li><span><Check /></span><span><strong>Restricted worker permissions</strong><small>Procurement workers cannot sign, approve or pay.</small></span></li>
              <li><span><Check /></span><span><strong>Human purchase approval · planned</strong><small>Public wallet approval is not yet connected.</small></span></li>
              <li><span><Check /></span><span><strong>Independent payment verification</strong><small>Submission is not the same as confirmed settlement.</small></span></li>
            </ul>
            <p className={styles.securityCaveat}>
              Contract and local Sandbox evidence are available in the technical notes. Custody, upgrade authority and anti-splitting remain under review.
            </p>
          </div>
        </section>

        <section className={styles.technologySection} id="technology" aria-labelledby="technology-title">
          <div className={styles.technologyIntro}>
            <div>
              <p className={styles.eyebrow}>Programmable financial infrastructure</p>
              <h2 id="technology-title">Built on NEAR. Designed around real obligations.</h2>
            </div>
            <p>
              NEAR smart contracts provide the policy boundary between procurement
              coordination and financial execution. The chain provides transaction
              evidence; CareCart connects it back to the order.
            </p>
          </div>
          <div className={styles.technologyGrid}>
            <div className={styles.techFeature}>
              <span className={styles.techIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.8 7.5 4.4 7.5-4.4M12 12.2V21" /></svg>
              </span>
              <h3>NEAR smart contracts</h3>
              <p>Encode spending rules and purchase-order commitments on-chain.</p>
            </div>
            <div className={styles.techFeature}>
              <span className={styles.techIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false"><path d="M12 3 5 6v5c0 4.5 2.8 8.2 7 10 4.2-1.8 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
              </span>
              <h3>Policy-controlled treasury</h3>
              <p>Restrict execution roles and keep sensitive actions reviewable.</p>
            </div>
            <div className={styles.techFeature}>
              <span className={styles.techIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9" /><path d="M12 6v12m4-8a3 3 0 0 0-3-2h-2a3 3 0 0 0 0 6h2a3 3 0 0 1 0 6h-2a3 3 0 0 1-3-2" /></svg>
              </span>
              <h3>Testnet token payments</h3>
              <p>Use explicitly configured CCUSD test tokens for the current MVP.</p>
            </div>
            <div className={styles.techFeature}>
              <span className={styles.techIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false"><path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h8" /><path d="m14 13 2 2 4-4" /></svg>
              </span>
              <h3>Verifiable transaction evidence</h3>
              <p>Distinguish a submitted transaction from an independently observed outcome.</p>
            </div>
          </div>
          <div className={styles.techBottom}>
            <span>
              Current MVP: clinic stock records, background replenishment, live NEAR AI Cloud procurement evaluation, and scoped NEAR testnet payments.
            </span>
            <a href={`${githubUrl}#readme`} target="_blank" rel="noreferrer">
              Explore technical notes <Arrow diagonal />
            </a>
          </div>
        </section>

        <section className={styles.finalCta} aria-labelledby="cta-title">
          <div className={styles.ctaPattern} aria-hidden="true" />
          <div className={styles.ctaCopy}>
            <p className={styles.eyebrowLight}>Procurement, brought into focus</p>
            <h2 id="cta-title">Your inventory should tell you what to buy next.</h2>
            <p>
              Create your clinic workspace, record stock and review what needs replenishing.
            </p>
          </div>
          <div className={styles.ctaActions}>
            <a className={styles.buttonLight} href="#interactive-demo">
              Explore demo <Arrow />
            </a>
            <Link className={styles.buttonOutlineLight} href="/app">
              Open app <Arrow />
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerMain}>
          <div className={styles.footerIdentity}>
            <Brand footer />
            <p>Give AI a budget, not your wallet.</p>
            <span>Healthcare procurement, under control.</span>
          </div>
          <div className={styles.footerNav}>
            <div>
              <span className={styles.footerLabel}>PRODUCT</span>
              <a href="#product">Inventory intelligence</a>
              <a href="#how-it-works">How it works</a>
              <a href="#security">Financial security</a>
            </div>
            <div>
              <span className={styles.footerLabel}>EXPLORE</span>
              <a href="#interactive-demo">Interactive demo</a>
              <Link href="/app">Open app</Link>
              <a href={`${githubUrl}#readme`} target="_blank" rel="noreferrer">Documentation</a>
            </div>
            <div>
              <span className={styles.footerLabel}>ECOSYSTEM</span>
              <a href="https://near.org/" target="_blank" rel="noreferrer">Built on NEAR <Arrow diagonal /></a>
              <a href={githubUrl} target="_blank" rel="noreferrer">GitHub <Arrow diagonal /></a>
              <a href="https://docs.near.org/" target="_blank" rel="noreferrer">NEAR docs <Arrow diagonal /></a>
            </div>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>© CareCart. All rights reserved.</span>
          <span className={styles.footerDisclosure}>NEAR Testnet MVP · sample suppliers</span>
          <span className={styles.nearAttribution}><span aria-hidden="true">◈</span> Built on NEAR</span>
        </div>
      </footer>
    </div>
  );
}
