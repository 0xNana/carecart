use carecart_safety_vault::{Contract, Policy};
use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};
fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn context(who: &str, deposit: u128, day: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(id("vault.testnet"))
        .predecessor_account_id(id(who))
        .signer_account_id(id(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(30))
        .block_timestamp(day * 86_400_000_000_000);
    testing_env!(b.build());
}
fn vault() -> Contract {
    context("admin.testnet", 0, 1);
    Contract::new(
        id("admin.testnet"),
        id("guardian.testnet"),
        id("treasury.testnet"),
        id("token.testnet"),
        Policy::initial(),
    )
}
#[test]
fn guardian_can_only_pause_and_requires_one_yocto() {
    let mut v = vault();
    context("guardian.testnet", 1, 1);
    v.pause();
    assert!(v.get_state().paused);
    context("guardian.testnet", 1, 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.unpause())).is_err());
    context("admin.testnet", 1, 1);
    v.unpause();
    assert!(!v.get_state().paused);
}
#[test]
fn approved_limits_have_immutable_upper_bounds() {
    let mut v = vault();
    context("admin.testnet", 1, 1);
    for field in ["payout", "daily", "accepted"] {
        let mut policy = Policy::initial();
        match field {
            "payout" => policy.hard_payout_limit = U128(25_000_001),
            "daily" => policy.daily_dispatch_limit = U128(25_000_001),
            "accepted" => policy.accepted_deposit_ceiling = U128(50_000_001),
            _ => unreachable!(),
        }
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.set_policy(policy)))
                .is_err()
        );
    }
    assert_eq!(v.get_state().policy, Policy::initial());
}
use carecart_safety_vault::{Destination, PurchaseOrder, QuoteCommitment, Reason, Route, Status};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::storage_management::StorageBalance;
use near_sdk::json_types::U64;
use near_sdk::{PromiseError, PromiseOrValue};
fn ready(amount: u128) -> Contract {
    let mut v = vault();
    context("admin.testnet", 10u128.pow(24), 1);
    v.fund_storage();
    context("admin.testnet", 1, 1);
    let mut p = Policy::initial();
    p.accepted_deposit_ceiling = U128(50_000_000);
    v.set_policy(p);
    v.set_supplier(id("supplier.testnet"), true);
    v.set_role(id("committer.testnet"), "committer".into(), true);
    v.set_role(id("agent.testnet"), "requester".into(), true);
    v.unpause();
    context("token.testnet", 0, 1);
    assert!(matches!(
        v.ft_on_transfer(id("treasury.testnet"), U128(amount), "deposit".into()),
        PromiseOrValue::Value(U128(0))
    ));
    v
}
fn order(po: &str, amount: u128, destination: Destination) -> PurchaseOrder {
    PurchaseOrder {
        po_id: po.into(),
        profile: "testnet".into(),
        supplier: id("supplier.testnet"),
        token: id("token.testnet"),
        amount: U128(amount),
        invoice_digest: "a".repeat(64),
        destination,
    }
}
fn commit(v: &mut Contract, po: &str, amount: u128) {
    context("committer.testnet", 0, 1);
    v.commit_purchase_order(order(po, amount, Destination::Near));
}
fn approve(
    v: &mut Contract,
    po_id: String,
    expected_quote_hash: Option<String>,
) -> PromiseOrValue<carecart_safety_vault::Payment> {
    let commitment_hash = if expected_quote_hash.is_some() {
        let payment = v.get_payment(po_id.clone()).expect("payment");
        Some(
            v.get_quote(payment.attempt_id)
                .expect("quote")
                .commitment_hash(),
        )
    } else {
        None
    };
    v.approve_payment(po_id, expected_quote_hash, commitment_hash)
}
fn request(v: &mut Contract, po: &str) {
    context("agent.testnet", 0, 1);
    let _ = v.request_payment(po.into());
}
fn callback(v: &mut Contract, po: &str, day: u64, ok: bool) {
    context("vault.testnet", 0, day);
    v.on_payment(
        po.into(),
        if ok {
            Ok(())
        } else {
            Err(PromiseError::Failed)
        },
    );
}
#[test]
fn deposits_partial_refund_and_wrong_identities_never_credit_untrusted_funds() {
    let mut v = vault();
    context("token.testnet", 0, 1);
    assert!(matches!(
        v.ft_on_transfer(id("treasury.testnet"), U128(6_000_000), "deposit".into()),
        PromiseOrValue::Value(U128(1_000_000))
    ));
    assert_eq!(v.get_state().accounted_balance, U128(5_000_000));
    assert!(matches!(
        v.ft_on_transfer(id("attacker.testnet"), U128(1_000_000), "deposit".into()),
        PromiseOrValue::Value(U128(1_000_000))
    ));
    context("other-token.testnet", 0, 1);
    let _ = v.ft_on_transfer(id("treasury.testnet"), U128(1_000_000), "deposit".into());
    assert_eq!(v.get_state().accounted_balance, U128(5_000_000));
}
#[test]
fn reservations_callbacks_and_midnight_preserve_original_bucket() {
    let mut v = ready(50_000_000);
    commit(&mut v, "po-a", 10_000_000);
    request(&mut v, "po-a");
    assert_eq!(v.get_state().reserved_payment, U128(10_000_000));
    commit(&mut v, "po-b", 10_000_000);
    context("agent.testnet", 0, 2);
    let _ = v.request_payment("po-b".into());
    callback(&mut v, "po-a", 2, true);
    assert_eq!(v.get_day_usage(U64(1)).spent, U128(10_000_000));
    assert_eq!(v.get_day_usage(U64(2)).reserved, U128(10_000_000));
    callback(&mut v, "po-b", 2, false);
    assert_eq!(v.get_day_usage(U64(2)).reserved, U128(0));
    assert_eq!(v.get_day_usage(U64(2)).spent, U128(0));
    callback(&mut v, "po-b", 2, false);
    assert_eq!(v.get_state().accounted_balance, U128(40_000_000));
}
#[test]
fn approval_only_overrides_auto_threshold_not_current_daily_or_hard_payout() {
    let mut v = ready(50_000_000);
    commit(&mut v, "auto", 10_000_000);
    request(&mut v, "auto");
    callback(&mut v, "auto", 1, true);
    commit(&mut v, "above-auto", 10_000_001);
    request(&mut v, "above-auto");
    assert_eq!(
        v.get_payment("above-auto".into()).unwrap().status,
        Status::PendingApproval
    );
    context("admin.testnet", 1, 1);
    let _ = approve(&mut v, "above-auto".into(), None);
    callback(&mut v, "above-auto", 1, true);
    commit(&mut v, "daily", 5_000_000);
    request(&mut v, "daily");
    context("admin.testnet", 1, 1);
    let _ = approve(&mut v, "daily".into(), None);
    assert_eq!(
        v.get_payment("daily".into()).unwrap().reason,
        Reason::DailyCapacity
    );
    assert_eq!(v.get_state().reserved_payment, U128(0));
    context("admin.testnet", 1, 2);
    let _ = approve(&mut v, "daily".into(), None);
    assert_eq!(v.get_state().reserved_payment, U128(5_000_000));
    commit(&mut v, "too-big", 25_000_001);
    request(&mut v, "too-big");
    assert_eq!(
        v.get_payment("too-big".into()).unwrap().reason,
        Reason::OverHardLimit
    );
}
#[test]
fn withdrawal_reserves_exclude_inflight_and_failure_restores_exactly_once() {
    let mut v = ready(20_000_000);
    commit(&mut v, "po", 1_000_000);
    request(&mut v, "po");
    context("admin.testnet", 1, 1);
    let _ = v.withdraw_all();
    assert!(v.get_state().paused);
    assert_eq!(v.get_state().reserved_withdrawal, U128(19_000_000));
    assert_eq!(v.get_state().spendable, U128(0));
    let _ = v.withdraw_all();
    context("vault.testnet", 0, 1);
    v.on_withdrawal(U64(1), Err(PromiseError::Failed));
    assert_eq!(v.get_state().spendable, U128(19_000_000));
    v.on_withdrawal(U64(1), Err(PromiseError::Failed));
    assert_eq!(v.get_state().reserved_withdrawal, U128(0));
    callback(&mut v, "po", 2, true);
    context("admin.testnet", 1, 2);
    let _ = v.withdraw_all();
    context("vault.testnet", 0, 2);
    v.on_withdrawal(U64(2), Ok(()));
    assert_eq!(v.get_state().accounted_balance, U128(0));
}
#[test]
fn immutable_po_and_non_admin_cannot_rebind_or_administer() {
    let mut v = ready(5_000_000);
    commit(&mut v, "po", 1_000_000);
    context("committer.testnet", 0, 1);
    v.commit_purchase_order(order("po", 1_000_000, Destination::Near));
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || v.commit_purchase_order(order("po", 2_000_000, Destination::Near))
        ))
        .is_err()
    );
    context("agent.testnet", 0, 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.unpause())).is_err());
}
fn cross(v: &mut Contract) -> QuoteCommitment {
    cross_until(v, 2 * 86_400_000_000_000)
}
fn cross_until(v: &mut Contract, deadline_ns: u64) -> QuoteCommitment {
    context("admin.testnet", 1, 1);
    v.set_route(Route {
        route_id: "base-alpha".into(),
        version: 1,
        supplier: id("supplier.testnet"),
        recipient: format!("0x{}", "1".repeat(40)),
        asset_id: "nep141:base-reviewed-usdc".into(),
        active: true,
    });
    context("committer.testnet", 0, 1);
    v.commit_purchase_order(order(
        "cross-po",
        1_000_000,
        Destination::Base {
            route_id: "base-alpha".into(),
            version: 1,
            route_hash: v.get_route_hash("base-alpha".into()).unwrap(),
        },
    ));
    let q = QuoteCommitment {
        attempt_id: "attempt-1".into(),
        po_id: "cross-po".into(),
        route_id: "base-alpha".into(),
        route_version: 1,
        signed_quote_hash: "b".repeat(64),
        deposit_account: id(&"a".repeat(64)),
        deadline_ns: U64(deadline_ns),
        min_amount_out: U128(900_000),
        storage_deposit_yocto: U128(1_490_000_000_000_000_000_000),
    };
    v.commit_quote(q.clone());
    context("agent.testnet", 0, 1);
    v.request_crosschain("cross-po".into(), "attempt-1".into());
    q
}
#[test]
fn crosschain_always_pending_binds_review_and_never_claims_destination_settlement() {
    let mut v = ready(5_000_000);
    let q = cross(&mut v);
    assert_eq!(v.get_state().reserved_payment, U128(0));
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().status,
        Status::PendingApproval
    );
    context("admin.testnet", 1, 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| approve(
            &mut v,
            "cross-po".into(),
            Some("c".repeat(64))
        )))
        .is_err()
    );
    let _ = approve(&mut v, "cross-po".into(), Some(q.signed_quote_hash));
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().status,
        Status::Registering
    );
    context("vault.testnet", 0, 1);
    let _ = v.on_registered(
        "cross-po".into(),
        Ok(StorageBalance {
            total: NearToken::from_yoctonear(1),
            available: NearToken::from_yoctonear(0),
        }),
    );
    callback(&mut v, "cross-po", 1, true);
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().status,
        Status::Dispatched
    );
    context("agent.testnet", 0, 1);
    v.request_crosschain("cross-po".into(), "attempt-1".into());
    assert_eq!(v.get_state().reserved_payment, U128(0));
}
#[test]
fn guardian_pause_during_registration_stops_token_dispatch_and_releases_reservations() {
    let mut v = ready(5_000_000);
    let q = cross(&mut v);
    context("admin.testnet", 1, 1);
    let _ = approve(&mut v, "cross-po".into(), Some(q.signed_quote_hash));
    context("guardian.testnet", 1, 1);
    v.pause();
    context("vault.testnet", 0, 1);
    let _ = v.on_registered(
        "cross-po".into(),
        Ok(StorageBalance {
            total: NearToken::from_yoctonear(1),
            available: NearToken::from_yoctonear(0),
        }),
    );
    assert_eq!(v.get_state().reserved_payment, U128(0));
    assert_eq!(v.get_state().accounted_balance, U128(5_000_000));
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().reason,
        Reason::Paused
    );
}
#[test]
fn rejected_or_expired_crosschain_quotes_never_reserve_funds() {
    let mut v = ready(5_000_000);
    let q = cross(&mut v);
    context("admin.testnet", 1, 2);
    let _ = approve(&mut v, "cross-po".into(), Some(q.signed_quote_hash));
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().status,
        Status::Expired
    );
    assert_eq!(v.get_state().reserved_payment, U128(0));
}

#[test]
fn boundary_grid_approval_cannot_exceed_hard_limits_and_failures_restore_invariants() {
    let mut v = ready(50_000_000);
    for (index, amount) in [
        1,
        9_999_999,
        10_000_000,
        10_000_001,
        24_999_999,
        25_000_000,
        25_000_001,
        u128::MAX,
    ]
    .into_iter()
    .enumerate()
    {
        let po = format!("boundary-{index}");
        commit(&mut v, &po, amount);
        request(&mut v, &po);
        let status = v.get_payment(po.clone()).unwrap().status;
        if amount > 25_000_000 {
            assert_eq!(status, Status::Blocked);
        } else {
            if amount > 10_000_000 {
                assert_eq!(status, Status::PendingApproval);
                context("admin.testnet", 1, 1);
                let _ = approve(&mut v, po.clone(), None);
            }
            assert_eq!(
                v.get_payment(po.clone()).unwrap().status,
                Status::Dispatching
            );
            assert_eq!(v.get_state().reserved_payment, U128(amount));
            callback(&mut v, &po, 1, false);
        }
        let state = v.get_state();
        assert_eq!(state.accounted_balance, U128(50_000_000));
        assert_eq!(state.spendable, U128(50_000_000));
        assert_eq!(state.reserved_payment, U128(0));
        assert_eq!(state.usage.spent, U128(0));
        assert_eq!(state.usage.reserved, U128(0));
    }
}

#[test]
fn backend_roles_are_distinct_and_admin_controls_reject_zero_deposit() {
    let mut v = ready(5_000_000);
    context("admin.testnet", 1, 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.set_role(
            id("agent.testnet"),
            "committer".into(),
            true
        )))
        .is_err()
    );
    context("admin.testnet", 0, 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || v.set_policy(Policy::initial())
        ))
        .is_err()
    );
    context("agent.testnet", 1, 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.withdraw(U128(1)))).is_err()
    );
}

#[test]
fn registration_failure_releases_original_day_reservation_once() {
    let mut v = ready(5_000_000);
    let q = cross(&mut v);
    context("admin.testnet", 1, 1);
    let _ = approve(&mut v, "cross-po".into(), Some(q.signed_quote_hash));
    context("vault.testnet", 0, 2);
    let _ = v.on_registered("cross-po".into(), Err(PromiseError::Failed));
    let _ = v.on_registered("cross-po".into(), Err(PromiseError::Failed));
    assert_eq!(v.get_state().accounted_balance, U128(5_000_000));
    assert_eq!(v.get_state().reserved_payment, U128(0));
    assert_eq!(v.get_day_usage(U64(1)).reserved, U128(0));
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().reason,
        Reason::RegistrationFailed
    );
}

#[test]
fn rejected_po_remains_terminal_without_reservations_or_callback_effects() {
    let mut v = ready(5_000_000);
    let mut quote = cross(&mut v);
    context("admin.testnet", 1, 1);
    let rejected = v.reject_payment("cross-po".into());
    assert_eq!(rejected.status, Status::Rejected);
    context("agent.testnet", 0, 2);
    assert_eq!(
        v.request_crosschain("cross-po".into(), "attempt-1".into()),
        rejected
    );
    context("committer.testnet", 0, 2);
    quote.attempt_id = "attempt-2".into();
    quote.deadline_ns = U64(4 * 86_400_000_000_000);
    v.commit_quote(quote);
    context("agent.testnet", 0, 2);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            v.request_crosschain("cross-po".into(), "attempt-2".into())
        }))
        .is_err()
    );
    context("vault.testnet", 0, 3);
    let _ = v.on_registered("cross-po".into(), Err(PromiseError::Failed));
    assert_eq!(v.on_payment("cross-po".into(), Ok(())), rejected);
    assert_eq!(v.get_state().accounted_balance, U128(5_000_000));
    assert_eq!(v.get_state().reserved_payment, U128(0));
    assert_eq!(v.get_day_usage(U64(1)).reserved, U128(0));
    assert_eq!(v.get_day_usage(U64(1)).spent, U128(0));
}

#[test]
fn late_successful_payment_cannot_be_reversed_or_debited_twice() {
    let mut v = ready(50_000_000);
    commit(&mut v, "late", 10_000_000);
    request(&mut v, "late");
    callback(&mut v, "late", 2, true);
    callback(&mut v, "late", 3, false);
    callback(&mut v, "late", 3, true);
    assert_eq!(v.get_payment("late".into()).unwrap().status, Status::Paid);
    assert_eq!(v.get_state().accounted_balance, U128(40_000_000));
    assert_eq!(v.get_state().reserved_payment, U128(0));
    assert_eq!(v.get_day_usage(U64(1)).spent, U128(10_000_000));
    assert_eq!(v.get_day_usage(U64(1)).reserved, U128(0));
    assert_eq!(v.get_day_usage(U64(2)).spent, U128(0));
    assert_eq!(v.get_day_usage(U64(3)).spent, U128(0));
}

#[test]
fn failed_base_transfer_after_expiry_releases_once_without_claiming_a_refund() {
    let mut v = ready(5_000_000);
    let quote = cross(&mut v);
    context("admin.testnet", 1, 1);
    let _ = approve(&mut v, "cross-po".into(), Some(quote.signed_quote_hash));
    context("vault.testnet", 0, 1);
    let _ = v.on_registered(
        "cross-po".into(),
        Ok(StorageBalance {
            total: NearToken::from_yoctonear(1),
            available: NearToken::from_yoctonear(0),
        }),
    );
    callback(&mut v, "cross-po", 3, false);
    callback(&mut v, "cross-po", 4, true);
    callback(&mut v, "cross-po", 4, false);
    let payment = v.get_payment("cross-po".into()).unwrap();
    assert_eq!(payment.status, Status::Failed);
    assert_eq!(payment.reason, Reason::TransferFailed);
    assert_eq!(v.get_state().accounted_balance, U128(5_000_000));
    assert_eq!(v.get_state().spendable, U128(5_000_000));
    assert_eq!(v.get_day_usage(U64(1)).reserved, U128(0));
    assert_eq!(v.get_day_usage(U64(1)).spent, U128(0));
    assert_eq!(v.get_day_usage(U64(3)).spent, U128(0));
}

#[test]
fn successful_base_transfer_after_expiry_is_dispatched_in_its_original_day() {
    let mut v = ready(5_000_000);
    let quote = cross(&mut v);
    context("admin.testnet", 1, 1);
    let _ = approve(&mut v, "cross-po".into(), Some(quote.signed_quote_hash));
    context("vault.testnet", 0, 1);
    let _ = v.on_registered(
        "cross-po".into(),
        Ok(StorageBalance {
            total: NearToken::from_yoctonear(1),
            available: NearToken::from_yoctonear(0),
        }),
    );
    callback(&mut v, "cross-po", 3, true);
    callback(&mut v, "cross-po", 4, false);
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().status,
        Status::Dispatched
    );
    assert_eq!(v.get_state().accounted_balance, U128(4_000_000));
    assert_eq!(v.get_state().reserved_payment, U128(0));
    assert_eq!(v.get_day_usage(U64(1)).spent, U128(1_000_000));
    assert_eq!(v.get_day_usage(U64(1)).reserved, U128(0));
    assert_eq!(v.get_day_usage(U64(3)).spent, U128(0));
}

#[test]
fn expired_registration_releases_original_day_without_dispatch_or_duplicate_release() {
    let mut v = ready(5_000_000);
    let quote = cross(&mut v);
    context("admin.testnet", 1, 1);
    let _ = approve(&mut v, "cross-po".into(), Some(quote.signed_quote_hash));
    context("vault.testnet", 0, 2);
    let _ = v.on_registered(
        "cross-po".into(),
        Ok(StorageBalance {
            total: NearToken::from_yoctonear(1),
            available: NearToken::from_yoctonear(0),
        }),
    );
    let _ = v.on_registered("cross-po".into(), Err(PromiseError::Failed));
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().status,
        Status::Expired
    );
    assert_eq!(v.get_state().accounted_balance, U128(5_000_000));
    assert_eq!(v.get_state().reserved_payment, U128(0));
    assert_eq!(v.get_day_usage(U64(1)).reserved, U128(0));
    assert_eq!(v.get_day_usage(U64(1)).spent, U128(0));
    assert_eq!(v.get_day_usage(U64(2)).reserved, U128(0));
}

#[test]
fn late_withdrawal_cannot_consume_or_release_an_unresolved_payment_reservation() {
    let mut v = ready(5_000_000);
    commit(&mut v, "unresolved", 1_000_000);
    request(&mut v, "unresolved");
    context("admin.testnet", 1, 2);
    let _ = v.withdraw_all();
    assert_eq!(v.get_state().reserved_payment, U128(1_000_000));
    assert_eq!(v.get_state().reserved_withdrawal, U128(4_000_000));
    assert_eq!(v.get_state().spendable, U128(0));
    context("vault.testnet", 0, 3);
    v.on_withdrawal(U64(1), Ok(()));
    v.on_withdrawal(U64(1), Err(PromiseError::Failed));
    assert_eq!(v.get_state().accounted_balance, U128(1_000_000));
    assert_eq!(v.get_state().reserved_payment, U128(1_000_000));
    assert_eq!(v.get_state().reserved_withdrawal, U128(0));
    assert_eq!(v.get_state().spendable, U128(0));
    assert_eq!(v.get_day_usage(U64(1)).reserved, U128(1_000_000));
    assert_eq!(
        v.get_payment("unresolved".into()).unwrap().status,
        Status::Dispatching
    );
    callback(&mut v, "unresolved", 4, false);
    callback(&mut v, "unresolved", 4, true);
    assert_eq!(v.get_state().accounted_balance, U128(1_000_000));
    assert_eq!(v.get_state().spendable, U128(1_000_000));
    assert_eq!(v.get_day_usage(U64(1)).reserved, U128(0));
    assert_eq!(v.get_day_usage(U64(4)).spent, U128(0));
}

fn check_late_registration_daily_policy(daily_limit: u128) {
    let mut v = ready(5_000_000);
    let quote = cross_until(&mut v, 4 * 86_400_000_000_000);
    context("admin.testnet", 1, 1);
    let _ = approve(&mut v, "cross-po".into(), Some(quote.signed_quote_hash));
    commit(&mut v, "new-day", 1_000_000);
    context("agent.testnet", 0, 2);
    let _ = v.request_payment("new-day".into());
    context("admin.testnet", 1, 2);
    let mut policy = v.get_state().policy;
    policy.daily_dispatch_limit = U128(daily_limit);
    v.set_policy(policy);
    context("vault.testnet", 0, 2);
    let _ = v.on_registered(
        "cross-po".into(),
        Ok(StorageBalance {
            total: NearToken::from_yoctonear(1),
            available: NearToken::from_yoctonear(0),
        }),
    );
    let payment = v.get_payment("cross-po".into()).unwrap();
    if daily_limit < 1_000_000 {
        assert_eq!(payment.status, Status::Failed);
        assert_eq!(payment.reason, Reason::DailyCapacity);
        assert_eq!(v.get_day_usage(U64(1)).reserved, U128(0));
        assert_eq!(v.get_state().accounted_balance, U128(5_000_000));
    } else {
        assert_eq!(payment.status, Status::Dispatching);
        assert_eq!(v.get_day_usage(U64(1)).reserved, U128(1_000_000));
        callback(&mut v, "cross-po", 3, true);
        assert_eq!(v.get_day_usage(U64(1)).spent, U128(1_000_000));
        assert_eq!(v.get_state().accounted_balance, U128(4_000_000));
    }
    assert_eq!(v.get_day_usage(U64(2)).reserved, U128(1_000_000));
    callback(&mut v, "new-day", 3, false);
    assert_eq!(v.get_day_usage(U64(2)).reserved, U128(0));
    assert_eq!(v.get_day_usage(U64(2)).spent, U128(0));
    assert_eq!(v.get_state().reserved_payment, U128(0));
    assert_eq!(v.get_state().spendable, v.get_state().accounted_balance);
}

#[test]
fn late_registration_rejects_a_lowered_policy_and_releases_only_its_original_day() {
    check_late_registration_daily_policy(500_000);
}

#[test]
fn late_registration_does_not_borrow_or_reserve_against_the_new_day_budget() {
    check_late_registration_daily_policy(1_500_000);
}

#[test]
fn human_rotation_requires_pause_and_successor_acceptance_and_keeps_treasury_fixed() {
    let mut v = ready(5_000_000);
    context("admin.testnet", 1, 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || v.propose_admin(Some(id("successor.testnet")))
        ))
        .is_err()
    );
    v.pause();
    v.propose_admin(Some(id("successor.testnet")));
    context("attacker.testnet", 1, 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.accept_admin())).is_err());
    context("successor.testnet", 0, 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.accept_admin())).is_err());
    context("successor.testnet", 1, 1);
    v.accept_admin();
    assert_eq!(v.get_state().admin, id("successor.testnet"));
    assert_eq!(v.get_state().treasury, id("treasury.testnet"));
    assert!(v.get_state().paused);
    v.set_guardian(id("new-guardian.testnet"));
    context("guardian.testnet", 1, 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.pause())).is_err());
    context("new-guardian.testnet", 1, 1);
    v.pause();
    context("admin.testnet", 1, 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.unpause())).is_err());
}

#[test]
fn backend_rotation_revokes_old_role_without_rebinding_existing_orders() {
    let mut v = ready(5_000_000);
    commit(&mut v, "old-order", 1_000_000);
    context("admin.testnet", 1, 1);
    v.rotate_role(
        id("committer.testnet"),
        id("new-committer.testnet"),
        "committer".into(),
    );
    assert!(!v.get_roles(id("committer.testnet")).committer);
    assert!(v.get_roles(id("new-committer.testnet")).committer);
    context("committer.testnet", 0, 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || v.commit_purchase_order(order("new-order", 1_000_000, Destination::Near))
        ))
        .is_err()
    );
    context("new-committer.testnet", 0, 1);
    v.commit_purchase_order(order("old-order", 1_000_000, Destination::Near));
    request(&mut v, "old-order");
    assert_eq!(
        v.get_payment("old-order".into()).unwrap().status,
        Status::Dispatching
    );
}

#[test]
fn guardian_and_backend_cannot_approve_withdraw_rotate_or_forge_callbacks() {
    let mut v = ready(5_000_000);
    for who in ["guardian.testnet", "agent.testnet", "committer.testnet"] {
        context(who, 1, 1);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| approve(
                &mut v,
                "absent".into(),
                None
            )))
            .is_err()
        );
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.withdraw_all())).is_err()
        );
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                || v.set_guardian(id("attacker.testnet"))
            ))
            .is_err()
        );
        context(who, 0, 1);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                || v.on_withdrawal(U64(1), Ok(()))
            ))
            .is_err()
        );
    }
    assert_eq!(v.get_state().accounted_balance, U128(5_000_000));
}

#[test]
fn bounded_views_and_nep297_refund_events_do_not_claim_refund_settlement() {
    let mut v = ready(5_000_000);
    commit(&mut v, "view-po", 1_000_000);
    assert_eq!(
        v.get_payments(vec!["view-po".into(), "absent".into()])
            .len(),
        2
    );
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || v.get_payments(vec!["view-po".into(); 51])
        ))
        .is_err()
    );
    context("other-token.testnet", 0, 1);
    let _ = v.ft_on_transfer(id("treasury.testnet"), U128(1_000_000), "deposit".into());
    let events: Vec<near_sdk::serde_json::Value> = near_sdk::test_utils::get_logs()
        .iter()
        .map(|s| near_sdk::serde_json::from_str(s.strip_prefix("EVENT_JSON:").unwrap()).unwrap())
        .collect();
    assert!(
        events
            .iter()
            .any(|e| e["event"] == "deposit_refund_requested")
    );
    for e in events {
        assert_eq!(e["standard"], "carecart_safety_vault");
        assert_eq!(e["version"], "1.0.0");
        assert!(e["data"].is_array());
        assert!(e["data"][0].get("refunded").is_none());
    }
}

#[test]
fn route_hash_changes_and_every_po_field_rebinding_fail_closed() {
    let mut v = ready(5_000_000);
    let _ = cross(&mut v);
    let original = v.get_purchase_order("cross-po".into()).unwrap();
    let mut variants = Vec::new();
    let mut changed = original.clone();
    changed.supplier = id("other.testnet");
    variants.push(changed);
    let mut changed = original.clone();
    changed.token = id("other-token.testnet");
    variants.push(changed);
    let mut changed = original.clone();
    changed.profile = "mainnet".into();
    variants.push(changed);
    let mut changed = original.clone();
    changed.amount = U128(2_000_000);
    variants.push(changed);
    let mut changed = original.clone();
    changed.invoice_digest = "e".repeat(64);
    variants.push(changed);
    let mut changed = original.clone();
    changed.destination = Destination::Near;
    variants.push(changed);
    for changed in variants {
        context("committer.testnet", 0, 1);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                || v.commit_purchase_order(changed)
            ))
            .is_err()
        );
        assert_eq!(v.get_purchase_order("cross-po".into()).unwrap(), original);
    }
    context("admin.testnet", 1, 1);
    let mut route = v.get_route("base-alpha".into()).unwrap();
    route.version = 2;
    route.recipient = format!("0x{}", "2".repeat(40));
    v.set_route(route);
    let quote = v.get_quote("attempt-1".into()).unwrap();
    let _ = approve(&mut v, "cross-po".into(), Some(quote.signed_quote_hash));
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().reason,
        Reason::InvalidRoute
    );
    assert_eq!(v.get_state().reserved_payment, U128(0));
}

#[test]
fn quote_refresh_is_a_new_attempt_of_the_same_immutable_po() {
    let mut v = ready(5_000_000);
    let mut quote = cross(&mut v);
    let original = v.get_purchase_order("cross-po".into()).unwrap();
    context("admin.testnet", 1, 2);
    let _ = approve(
        &mut v,
        "cross-po".into(),
        Some(quote.signed_quote_hash.clone()),
    );
    context("committer.testnet", 0, 2);
    v.commit_quote(quote.clone()); // Identical expired commitments remain idempotent.
    quote.attempt_id = "attempt-2".into();
    quote.deadline_ns = U64(3 * 86_400_000_000_000);
    quote.signed_quote_hash = "c".repeat(64);
    v.commit_quote(quote);
    context("agent.testnet", 0, 2);
    v.request_crosschain("cross-po".into(), "attempt-2".into());
    assert_eq!(v.get_purchase_order("cross-po".into()).unwrap(), original);
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().attempt_id,
        "attempt-2"
    );
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().status,
        Status::PendingApproval
    );
    assert_eq!(v.get_state().reserved_payment, U128(0));
}

#[test]
fn pause_requires_one_yocto_even_for_guardian() {
    let mut v = ready(5_000_000);
    context("guardian.testnet", 0, 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.pause())).is_err());
    assert!(!v.get_state().paused);
}

#[test]
fn route_hash_matches_the_backend_canonical_vector() {
    context("admin.testnet", 0, 1);
    let route = Route {
        route_id: "base-1".into(),
        version: 1,
        supplier: id("supplier.testnet"),
        recipient: format!("0x{}", "a".repeat(40)),
        asset_id: "nep141:base-usdc".into(),
        active: true,
    };
    assert_eq!(
        route.commitment_hash(),
        "c61075e2b135c6246075a5184a1ff93255f9e8451e411d0197bfaea5edc54333"
    );
}

#[test]
fn canceled_admin_proposal_cannot_be_accepted_or_overlap_a_backend_role() {
    let mut v = ready(5_000_000);
    context("admin.testnet", 1, 1);
    v.pause();
    for account in [
        "guardian.testnet",
        "agent.testnet",
        "treasury.testnet",
        "vault.testnet",
    ] {
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                || v.propose_admin(Some(id(account)))
            ))
            .is_err()
        );
    }
    v.propose_admin(Some(id("successor.testnet")));
    v.propose_admin(None);
    context("successor.testnet", 1, 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.accept_admin())).is_err());
    assert_eq!(v.get_state().admin, id("admin.testnet"));
    assert_eq!(v.get_state().pending_admin, None);
}

#[test]
fn stale_wallet_approval_cannot_approve_a_replacement_attempt_with_the_same_signed_quote() {
    let mut v = ready(5_000_000);
    let first = cross(&mut v);
    let reviewed_hash = first.commitment_hash();
    context("admin.testnet", 1, 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.approve_payment(
            "cross-po".into(),
            Some(first.signed_quote_hash.clone()),
            None
        )))
        .is_err()
    );
    assert_eq!(v.get_state().reserved_payment, U128(0));
    let _ = v.approve_payment(
        "cross-po".into(),
        Some(first.signed_quote_hash.clone()),
        Some(reviewed_hash.clone()),
    );
    context("vault.testnet", 0, 1);
    let _ = v.on_registered("cross-po".into(), Err(PromiseError::Failed));
    let mut second = first.clone();
    second.attempt_id = "attempt-2".into();
    second.storage_deposit_yocto = U128(2_000_000_000_000_000_000_000);
    context("committer.testnet", 0, 1);
    v.commit_quote(second.clone());
    context("agent.testnet", 0, 1);
    v.request_crosschain("cross-po".into(), second.attempt_id.clone());
    context("admin.testnet", 1, 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.approve_payment(
            "cross-po".into(),
            Some(first.signed_quote_hash.clone()),
            Some(reviewed_hash)
        )))
        .is_err()
    );
    assert_eq!(v.get_state().reserved_payment, U128(0));
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().status,
        Status::PendingApproval
    );
    let _ = v.approve_payment(
        "cross-po".into(),
        Some(second.signed_quote_hash.clone()),
        Some(second.commitment_hash()),
    );
    assert_eq!(
        v.get_payment("cross-po".into()).unwrap().status,
        Status::Registering
    );
}

#[test]
fn quote_commitment_hash_matches_the_backend_vector() {
    context("admin.testnet", 0, 1);
    let quote = QuoteCommitment {
        attempt_id: "attempt-1".into(),
        po_id: "po-1".into(),
        route_id: "base-1".into(),
        route_version: 1,
        signed_quote_hash: "b".repeat(64),
        deposit_account: id(&"a".repeat(64)),
        deadline_ns: U64(200_000_000_000_000),
        min_amount_out: U128(980_000),
        storage_deposit_yocto: U128(1_250_000_000_000_000_000_000),
    };
    assert_eq!(
        quote.commitment_hash(),
        "0669e734b6288e5873074d1e7e6a5a46d29ac3fa41f6e4fb31c4904884db7c50"
    );
}

#[test]
fn four_usdc_unknown_supplier_is_blocked_with_sufficient_initial_funds_and_no_limit_excess() {
    let mut v = ready(5_000_000);
    context("admin.testnet", 1, 1);
    let mut policy = v.get_state().policy;
    policy.accepted_deposit_ceiling = U128(5_000_000);
    v.set_policy(policy);
    let mut unknown = order("unknown-four", 4_000_000, Destination::Near);
    unknown.supplier = id("unknown-supplier.testnet");
    context("committer.testnet", 0, 1);
    v.commit_purchase_order(unknown);
    context("agent.testnet", 0, 1);
    let _ = v.request_payment("unknown-four".into());
    let payment = v.get_payment("unknown-four".into()).unwrap();
    assert_eq!(payment.status, Status::Blocked);
    assert_eq!(payment.reason, Reason::UnknownSupplier);
    assert_eq!(v.get_state().accounted_balance, U128(5_000_000));
    assert_eq!(
        v.get_state().policy.accepted_deposit_ceiling,
        U128(5_000_000)
    );
    assert_eq!(v.get_state().reserved_payment, U128(0));
    assert_eq!(v.get_day_usage(U64(1)).spent, U128(0));
    assert_eq!(v.get_day_usage(U64(1)).reserved, U128(0));
}
