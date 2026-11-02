'use client';
import { useNear } from '@/providers/near-provider';
import { amount } from '@/lib/procurement';
import { transactionUrl } from '@/lib/near';
import { TransactionReview } from './transaction-review';

export function WalletControls() {
  const near = useNear();
  const { vault, account, walletBusy, canAdmin } = near;
  const transaction = near.result?.hash && transactionUrl(near.result.hash);
  return <section className="panel wallet-panel" id="vault" aria-labelledby="vault-title">
    <div className="section-top"><div><span className="eyebrow">Human control</span><h2 id="vault-title">Testnet vault & wallet</h2></div><span className="tag muted-tag">NEAR testnet · CCTEST</span></div>
    <p className="section-description">CCTEST is a synthetic test token with no monetary value. Wallet actions control approvals, policy and pause state.</p>
    <div className="wallet-actions"><button className="button primary" disabled={walletBusy || near.walletUncertain} onClick={() => void (account ? near.disconnect() : near.connect())}>{walletBusy ? 'Wallet busy…' : account ? 'Disconnect wallet' : 'Connect testnet wallet'}</button><button className="button" disabled={near.loading} onClick={() => void near.refresh().catch(() => {})}>{near.loading ? 'Reading testnet…' : 'Refresh vault'}</button></div>
    <p className="wallet-account">{account ? <>Connected: <strong>{account}</strong></> : 'No wallet connected. Connecting requests no transaction or signing permission.'}</p>
    {near.loading && <p role="status">Reading the testnet vault…</p>}
    {near.error && <p className="error-banner" role="alert">{near.error}</p>}
    {near.walletError && <p className="error-banner" role="alert">{near.walletError}</p>}
    {near.walletStatus && <p className="notice" role="status">{near.walletStatus}</p>}
    {near.walletUncertain && <p className="setup-note" role="status">A signing request is still unresolved. Signing controls stay disabled to prevent a duplicate request. Refresh vault reads are available. Reject or finish the original wallet request; a late response is still tracked. If you reload or use the CLI, first close the old wallet prompt and check canonical state. Refreshing this page does not cancel a wallet transaction.</p>}
    {near.result && <p className="notice" role="status">{near.result.message} {transaction && <a className="text-link" href={transaction} target="_blank" rel="noreferrer">View testnet transaction ↗</a>}</p>}
    {vault && <><dl className="vault-facts"><div><dt>Admin wallet</dt><dd>{vault.adminId}</dd></div><div><dt>Vault contract</dt><dd>{vault.vaultId}</dd></div><div><dt>Test token</dt><dd>{vault.tokenId}</dd></div><div><dt>Payment processing</dt><dd><strong>{vault.deployment === 'not_deployed' ? 'Awaiting deployment' : vault.paused ? 'Paused' : 'Active'}</strong></dd></div></dl>
      {vault.deployment === 'not_deployed' ? <p className="setup-note">The account exists, but no vault contract is deployed. Approvals, policy and pause controls unlock after the reviewed testnet deployment. No live payment status is available yet.</p> : <>
        <div className="vault-facts"><div><span className="caption">Vault token balance · atomic</span><strong>{amount(vault.balance!)} CCTEST</strong></div><div><span className="caption">Total spent / reserved · atomic</span><strong>{amount(vault.usage!.total_spent)} / {amount(vault.usage!.total_reserved)}</strong></div><div><span className="caption">Recorded UTC day {vault.usage!.day} · spent / reserved</span><strong>{amount(vault.usage!.daily_spent)} / {amount(vault.usage!.daily_reserved)}</strong></div><div><span className="caption">Commit storage reserve · yoctoNEAR</span><strong>{amount(vault.storageReserve!)}</strong></div></div>
        {!canAdmin && <p className="setup-note">Connect {vault.adminId} to change policy, approve payments or control the pause state.</p>}
        <button className="button" disabled={!canAdmin} onClick={() => near.prepare({ method: 'set_paused', args: { paused: !vault.paused } })}>{vault.paused ? 'Review resume payments' : 'Review pause payments'}</button>
        <PolicyControls key={JSON.stringify(vault.policy)} />
      </>}
      <p className="caption">Read from testnet at {new Date(vault.checkedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC' })} UTC. Refresh to check changes.</p>
    </>}
    <TransactionReview />
  </section>;
}
function PolicyControls() {
  const { vault, canAdmin, prepare } = useNear();
  const policy = vault?.policy;
  if (!policy) return null;
  return <form className="policy-form" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    prepare({ method: 'set_policy', args: { policy: { token_id: policy.token_id,
      per_order_cap: String(data.get('per_order_cap')), daily_cap: String(data.get('daily_cap')), balance_cap: String(data.get('balance_cap')) } } });
  }}><h3>Automatic payment policy</h3><p className="caption">Current limits · per order {amount(policy.per_order_cap)} / daily {amount(policy.daily_cap)} / cumulative {amount(policy.balance_cap)} CCTEST atomic.</p><p className="caption">Positive whole CCTEST atomic units. Balance cap is a cumulative budget. Token changes are unavailable here.</p><fieldset disabled={!canAdmin}><legend className="sr-only">Payment limits</legend><div className="policy-fields">{([
    ['per_order_cap', 'Per-order limit'], ['daily_cap', 'Daily limit'], ['balance_cap', 'Cumulative spending budget'],
  ] as const).map(([name, title]) => <label key={name}>{title}<input name={name} inputMode="numeric" pattern="[0-9]+" maxLength={39} required defaultValue={policy[name]} /></label>)}</div><button className="button" type="submit">Review policy changes</button></fieldset></form>;
}
