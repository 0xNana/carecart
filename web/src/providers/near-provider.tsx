'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { NearConnector, NearWalletBase } from '@hot-labs/near-connect';
import { api } from '@/lib/procurement';
import { NETWORK, RPC_URL, type AdminAction, type CanonicalPayment, type VaultState } from '@/lib/near';
import { createReview, submitReviewed, waitForWallet, WalletResponsePendingError, type Review, type WalletOutcome } from '@/lib/wallet-transactions';

function useWalletState() {
  const [vault, setVault] = useState<VaultState>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [account, setAccount] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [walletUncertain, setWalletUncertain] = useState(false);
  const [walletStatus, setWalletStatus] = useState('');
  const [review, setReview] = useState<Review>();
  const [result, setResult] = useState<{ message: string; hash?: string }>();
  const [revision, setRevision] = useState(0);
  const connector = useRef<NearConnector | null>(null);
  const wallet = useRef<NearWalletBase | null>(null);
  const locked = useRef(false);
  const readState = useCallback(() => api<VaultState>('vault'), []);
  useEffect(() => {
    const controller = new AbortController();
    api<VaultState>('vault', undefined, controller.signal).then(setVault).catch((cause: Error) => {
      if (!controller.signal.aborted) setError(cause.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const current = await readState(); setVault(current); return current; }
    catch (cause) { setVault(undefined); setError(message(cause)); throw cause; }
    finally { setLoading(false); setRevision((value) => value + 1); }
  }, [readState]);

  async function connect() {
    if (locked.current) return;
    locked.current = true; setWalletBusy(true); setWalletError(''); setReview(undefined);
    try {
      if (!connector.current) {
        const { NearConnector } = await waitForWallet(import('@hot-labs/near-connect'), 15000,
          () => new Error('Wallet connector could not load. Check your connection and try again.'));
        // No sign-in key or contract authorization is requested on connection.
        connector.current = new NearConnector({ network: NETWORK, autoConnect: false,
          providers: { testnet: [RPC_URL] }, features: { testnet: true, signInWithoutAddKey: true } });
        // Update identity only from this completed connect attempt, never a late sign-in event.
        connector.current.on('wallet:signOut', () => { wallet.current = null; setAccount(''); setReview(undefined); });
      }
      const connected = await waitForWallet(connector.current.connect(), 45000,
        () => new Error('Wallet connection timed out. Close its prompt before connecting again; no transaction was requested.'));
      const accounts = await waitForWallet(connected.getAccounts({ network: NETWORK }), 15000,
        () => new Error('Wallet account check timed out. No transaction was requested.'));
      wallet.current = connected;
      setAccount(accounts.find((entry) => entry.accountId === vault?.adminId)?.accountId ?? accounts[0]?.accountId ?? '');
    } catch (cause) { setWalletError(message(cause)); }
    finally { locked.current = false; setWalletBusy(false); }
  }
  async function disconnect() {
    if (locked.current) return;
    locked.current = true; setWalletBusy(true); setWalletError('');
    try { if (connector.current && wallet.current) await waitForWallet(connector.current.disconnect(wallet.current), 15000,
      () => new Error('Wallet disconnect timed out. Close the wallet prompt and refresh this page.')); setAccount(''); wallet.current = null; setReview(undefined); }
    catch (cause) { setWalletError(message(cause)); }
    finally { locked.current = false; setWalletBusy(false); }
  }
  function prepare(action: AdminAction, payment?: CanonicalPayment) {
    if (!vault || locked.current) return;
    setWalletError(''); setResult(undefined);
    try { setReview(createReview(vault, account, action, payment)); }
    catch (cause) { setWalletError(message(cause)); }
  }
  async function submit() {
    if (!review || !wallet.current || !connector.current || locked.current) return;
    const submittedReview = review;
    locked.current = true; setWalletBusy(true); setWalletError(''); setWalletStatus('Checking the vault and wallet account before signing…');
    // A native modal makes body-mounted wallet overlays inert. Release it after the human's
    // Continue click, before any adapter calls (getAccounts can also open a wallet overlay).
    setReview(undefined);
    let unresolved = false;
    const report = (outcome: WalletOutcome) => setResult({ message: outcome.confirmed
      ? 'Transaction executed. Vault state refreshed below; check payment status to verify settlement.'
      : 'Wallet request sent. Check on-chain status; settlement is not yet confirmed.', hash: outcome.hash });
    try {
      if (connector.current.network !== NETWORK || !wallet.current.manifest.features?.testnet) throw new Error('The connected wallet is not on testnet. Reconnect.');
      const outcome = await submitReviewed(submittedReview, wallet.current, readState,
        (poId) => api<CanonicalPayment>(`vault/payments/${poId}`), { onSigning: () => setWalletStatus('Waiting for your testnet wallet. Check its window or approval panel.') });
      report(outcome);
    } catch (cause) {
      setWalletError(message(cause));
      if (cause instanceof WalletResponsePendingError) {
        unresolved = true; setWalletUncertain(true);
        cause.completion.then((outcome) => { setWalletError(''); report(outcome); }, (error) => setWalletError(message(error)))
          .finally(() => { locked.current = false; setWalletUncertain(false); void refresh().catch(() => {}); });
      }
    }
    finally {
      if (!unresolved) locked.current = false;
      setWalletBusy(false); setWalletStatus('');
      await refresh().catch(() => {});
    }
  }
  return { vault, loading, error, refresh, account, walletBusy, walletUncertain, walletStatus, walletError, connect, disconnect, prepare,
    review, submit, cancel: () => { if (!locked.current) setReview(undefined); }, result, revision,
    canAdmin: !!vault && vault.deployment === 'ready' && account === vault.adminId && !loading && !walletBusy && !walletUncertain };
}
const NearContext = createContext<ReturnType<typeof useWalletState> | null>(null);
export function NearProvider({ children }: { children: ReactNode }) {
  const value = useWalletState();
  return <NearContext.Provider value={value}>{children}</NearContext.Provider>;
}
export function useNear() {
  const value = useContext(NearContext);
  if (!value) throw new Error('NearProvider is required.');
  return value;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'The wallet action could not be completed.'; }
