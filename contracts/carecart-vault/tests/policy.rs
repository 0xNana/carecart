use carecart_vault::{
    ApprovalReason, BlockReason, Contract, PaymentDecision, Policy, PolicyContext, PurchaseOrder,
};
use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn policy() -> Policy {
    Policy {
        token_id: account("test-token.testnet"),
        per_order_cap: U128(100),
        daily_cap: U128(200),
        balance_cap: U128(500),
    }
}

fn context(predecessor: &AccountId) {
    context_with_deposit(predecessor, NearToken::from_near(1));
}

fn context_with_deposit(predecessor: &AccountId, deposit: NearToken) {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(account("vault.testnet"))
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor.clone())
        .attached_deposit(deposit);
    testing_env!(builder.build());
}

fn setup() -> (Contract, AccountId, AccountId, AccountId) {
    let admin = account("admin.testnet");
    let supplier = account("supplier.testnet");
    let committer = account("procurement.testnet");
    context(&admin);
    (
        Contract::new(admin.clone(), policy()),
        admin,
        supplier,
        committer,
    )
}

fn order(supplier: &AccountId, amount: u128) -> PurchaseOrder {
    PurchaseOrder {
        po_id: "po-0001".to_string(),
        supplier_id: supplier.clone(),
        token_id: account("test-token.testnet"),
        amount: U128(amount),
    }
}

fn decision_context() -> PolicyContext {
    PolicyContext {
        paused: false,
        supplier_allowed: true,
        request_id_used: false,
        available_balance: 1_000,
        daily_spent: 0,
        total_spent: 0,
    }
}

#[test]
fn initializes_with_admin_and_valid_policy() {
    let (contract, admin, _, _) = setup();
    assert_eq!(contract.get_admin(), admin);
    assert_eq!(contract.get_policy(), policy());
    assert!(!contract.is_paused());
}

#[test]
#[should_panic(expected = "policy caps must be greater than zero")]
fn initializer_rejects_zero_caps() {
    let mut invalid = policy();
    invalid.daily_cap = U128(0);
    let _ = Contract::new(account("admin.testnet"), invalid);
}

#[test]
fn only_admin_can_change_policy() {
    let (mut contract, admin, _, _) = setup();
    let mut updated = policy();
    updated.per_order_cap = U128(75);

    context(&account("attacker.testnet"));
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.set_policy(updated.clone());
    }));
    assert!(result.is_err());
    assert_eq!(contract.get_policy(), policy());

    context(&admin);
    contract.set_policy(updated.clone());
    assert_eq!(contract.get_policy(), updated);
}

#[test]
#[should_panic(expected = "policy caps must be greater than zero")]
fn admin_cannot_install_invalid_policy() {
    let (mut contract, admin, _, _) = setup();
    let mut invalid = policy();
    invalid.balance_cap = U128(0);
    context(&admin);
    contract.set_policy(invalid);
}

#[test]
fn only_admin_can_change_supplier_allowlist_and_pause_state() {
    let (mut contract, admin, supplier, _) = setup();

    context(&account("attacker.testnet"));
    let unauthorized = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.set_supplier_allowed(supplier.clone(), true);
    }));
    assert!(unauthorized.is_err());
    let unauthorized_pause = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.set_paused(true);
    }));
    assert!(unauthorized_pause.is_err());
    assert!(!contract.is_paused());

    context(&admin);
    contract.set_supplier_allowed(supplier.clone(), true);
    assert!(contract.is_supplier_allowed(supplier.clone()));
    contract.set_paused(true);
    assert!(contract.is_paused());
    contract.set_supplier_allowed(supplier.clone(), false);
    assert!(!contract.is_supplier_allowed(supplier));
    contract.set_paused(false);
    assert!(!contract.is_paused());
}

#[test]
#[should_panic(expected = "attached deposit does not cover storage growth")]
fn supplier_allowlist_growth_requires_storage_deposit() {
    let (mut contract, admin, supplier, _) = setup();
    context_with_deposit(&admin, NearToken::from_yoctonear(0));
    contract.set_supplier_allowed(supplier, true);
}

#[test]
#[should_panic(expected = "attached deposit does not cover storage growth")]
fn purchase_order_map_growth_requires_storage_deposit() {
    let (mut contract, admin, supplier, committer) = setup();
    context(&admin);
    contract.set_supplier_allowed(supplier.clone(), true);
    contract.set_po_committer(committer.clone(), true);

    context_with_deposit(&committer, NearToken::from_yoctonear(0));
    contract.commit_purchase_order(
        "po-0001".to_string(),
        supplier,
        account("test-token.testnet"),
        U128(42),
    );
}

#[test]
#[should_panic(expected = "attached deposit does not cover storage growth")]
fn growing_policy_token_id_requires_storage_deposit() {
    let (mut contract, admin, _, _) = setup();
    let mut updated = policy();
    updated.token_id = account("longer-test-token-contract.testnet");
    context_with_deposit(&admin, NearToken::from_yoctonear(0));
    contract.set_policy(updated);
}

#[test]
fn only_admin_can_grant_or_revoke_po_committers() {
    let (mut contract, admin, _, committer) = setup();

    context(&account("attacker.testnet"));
    let unauthorized = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.set_po_committer(committer.clone(), true);
    }));
    assert!(unauthorized.is_err());
    assert!(!contract.is_po_committer(committer.clone()));

    context(&admin);
    contract.set_po_committer(committer.clone(), true);
    assert!(contract.is_po_committer(committer.clone()));
    contract.set_po_committer(committer.clone(), false);
    assert!(!contract.is_po_committer(committer));
}

#[test]
fn authorized_committer_can_commit_a_canonical_purchase_order() {
    let (mut contract, admin, supplier, committer) = setup();
    context(&admin);
    contract.set_supplier_allowed(supplier.clone(), true);
    contract.set_po_committer(committer.clone(), true);

    context(&committer);
    let expected = order(&supplier, 42);
    contract.commit_purchase_order(
        expected.po_id.clone(),
        expected.supplier_id.clone(),
        expected.token_id.clone(),
        expected.amount,
    );
    assert_eq!(
        contract.get_purchase_order(expected.po_id.clone()),
        Some(expected)
    );
}

#[test]
#[should_panic(expected = "caller is not an authorized PO committer")]
fn unauthorized_account_cannot_commit_a_purchase_order() {
    let (mut contract, admin, supplier, _) = setup();
    context(&admin);
    contract.set_supplier_allowed(supplier.clone(), true);
    context(&account("agent.testnet"));
    contract.commit_purchase_order(
        "po-0001".to_string(),
        supplier,
        account("test-token.testnet"),
        U128(42),
    );
}

#[test]
fn purchase_order_commitment_cannot_be_rebound() {
    let (mut contract, admin, supplier, committer) = setup();
    context(&admin);
    contract.set_supplier_allowed(supplier.clone(), true);
    contract.set_po_committer(committer.clone(), true);
    context(&committer);
    contract.commit_purchase_order(
        "po-0001".to_string(),
        supplier.clone(),
        account("test-token.testnet"),
        U128(42),
    );

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.commit_purchase_order(
            "po-0001".to_string(),
            supplier.clone(),
            account("test-token.testnet"),
            U128(43),
        );
    }));
    assert!(result.is_err());
    assert_eq!(
        contract
            .get_purchase_order("po-0001".to_string())
            .unwrap()
            .amount,
        U128(42)
    );
}

#[test]
fn commitment_rejects_unknown_supplier_wrong_token_and_zero_amount() {
    let (mut contract, admin, supplier, committer) = setup();
    context(&admin);
    contract.set_po_committer(committer.clone(), true);
    context(&committer);

    let unknown_supplier = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.commit_purchase_order(
            "po-unknown".to_string(),
            supplier.clone(),
            account("test-token.testnet"),
            U128(1),
        );
    }));
    assert!(unknown_supplier.is_err());

    context(&admin);
    contract.set_supplier_allowed(supplier.clone(), true);
    context(&committer);
    let unsupported_token = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.commit_purchase_order(
            "po-token".to_string(),
            supplier.clone(),
            account("other-token.testnet"),
            U128(1),
        );
    }));
    assert!(unsupported_token.is_err());

    let zero_amount = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.commit_purchase_order(
            "po-zero".to_string(),
            supplier,
            account("test-token.testnet"),
            U128(0),
        );
    }));
    assert!(zero_amount.is_err());
}

#[test]
fn policy_decision_blocks_paused_and_unlisted_supplier_requests() {
    let policy = policy();
    let supplier = account("supplier.testnet");
    let po = order(&supplier, 10);

    let mut paused = decision_context();
    paused.paused = true;
    assert_eq!(
        policy.evaluate(Some(&po), paused),
        PaymentDecision::Blocked {
            reason: BlockReason::Paused,
        }
    );

    let mut unlisted = decision_context();
    unlisted.supplier_allowed = false;
    assert_eq!(
        policy.evaluate(Some(&po), unlisted),
        PaymentDecision::Blocked {
            reason: BlockReason::SupplierNotAllowed,
        }
    );
}

#[test]
fn per_order_daily_and_balance_caps_require_pending_approval() {
    let policy = policy();
    let supplier = account("supplier.testnet");

    let per_order = policy.evaluate(Some(&order(&supplier, 101)), decision_context());
    assert_eq!(
        per_order,
        PaymentDecision::PendingApproval {
            reasons: vec![ApprovalReason::PerOrderCap],
        }
    );

    let mut daily_context = decision_context();
    daily_context.daily_spent = 195;
    let daily = policy.evaluate(Some(&order(&supplier, 10)), daily_context);
    assert_eq!(
        daily,
        PaymentDecision::PendingApproval {
            reasons: vec![ApprovalReason::DailyCap],
        }
    );

    let mut balance_context = decision_context();
    balance_context.total_spent = 495;
    let balance = policy.evaluate(Some(&order(&supplier, 10)), balance_context);
    assert_eq!(
        balance,
        PaymentDecision::PendingApproval {
            reasons: vec![ApprovalReason::BalanceCap],
        }
    );
}

#[test]
fn in_policy_order_is_eligible_for_automatic_payment() {
    let po = order(&account("supplier.testnet"), 10);
    assert_eq!(
        policy().evaluate(Some(&po), decision_context()),
        PaymentDecision::AutoPay
    );
}

#[test]
fn duplicate_request_id_is_blocked() {
    let po = order(&account("supplier.testnet"), 10);
    let mut context = decision_context();
    context.request_id_used = true;
    assert_eq!(
        policy().evaluate(Some(&po), context),
        PaymentDecision::Blocked {
            reason: BlockReason::DuplicateRequestId,
        }
    );
}

#[test]
fn rejected_missing_po_and_insufficient_funds_requests_are_blocked() {
    assert_eq!(
        policy().evaluate(None, decision_context()),
        PaymentDecision::Blocked {
            reason: BlockReason::PurchaseOrderNotFound,
        }
    );

    let po = order(&account("supplier.testnet"), 10);
    let mut poor_vault = decision_context();
    poor_vault.available_balance = 9;
    assert_eq!(
        policy().evaluate(Some(&po), poor_vault),
        PaymentDecision::Blocked {
            reason: BlockReason::InsufficientFunds,
        }
    );
}

#[test]
fn payment_state_view_returns_no_record_for_unknown_request() {
    let (contract, _, _, _) = setup();
    assert_eq!(contract.get_payment_state("request-0001".to_string()), None);
}
