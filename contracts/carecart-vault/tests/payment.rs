use carecart_vault::{BlockReason, Contract, PaymentDecision, PaymentRecord, PaymentState, Policy};
use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, PromiseError, PromiseOrValue, testing_env};

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn set_context(predecessor: &AccountId, attached: NearToken) {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(account("vault.testnet"))
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor.clone())
        .attached_deposit(attached);
    testing_env!(builder.build());
}

fn context(predecessor: &AccountId) {
    set_context(predecessor, NearToken::from_near(1));
}

fn setup() -> (Contract, AccountId, AccountId, AccountId, AccountId) {
    let admin = account("admin.testnet");
    let committer = account("procurement.testnet");
    let requester = account("agent.testnet");
    let supplier = account("supplier.testnet");
    let policy = Policy {
        token_id: account("test-token.testnet"),
        per_order_cap: U128(100),
        daily_cap: U128(200),
        balance_cap: U128(500),
    };
    context(&admin);
    let mut contract = Contract::new(admin.clone(), policy);
    contract.set_supplier_allowed(supplier.clone(), true);
    contract.set_po_committer(committer.clone(), true);
    contract.set_payment_requester(requester.clone(), true);
    context(&committer);
    contract.commit_purchase_order(
        "po-0001".to_string(),
        supplier.clone(),
        account("test-token.testnet"),
        U128(40),
    );
    (contract, admin, committer, requester, supplier)
}

fn request(contract: &mut Contract, requester: &AccountId, po_id: &str) -> PaymentRecord {
    context(requester);
    match contract.request_payment(po_id.to_string()) {
        PromiseOrValue::Value(record) => record,
        PromiseOrValue::Promise(_) => contract.get_payment_state(po_id.to_string()).unwrap(),
    }
}

#[test]
fn missing_po_is_blocked_without_creating_unbounded_state() {
    let (mut contract, _, _, requester, _) = setup();
    let record = request(&mut contract, &requester, "po-missing");
    assert_eq!(record.state, PaymentState::Blocked);
    assert_eq!(record.reason, Some(BlockReason::PurchaseOrderNotFound));
    assert_eq!(contract.get_payment_state("po-missing".to_string()), None);
}

#[test]
fn successful_callback_settles_reserved_balance_and_is_idempotent() {
    let (mut contract, _, _, requester, _) = setup();
    let record = request(&mut contract, &requester, "po-0001");
    assert_eq!(record.state, PaymentState::CheckingBalance);

    // A retry with the same PO ID returns the stored state and does not start another call.
    let duplicate = request(&mut contract, &requester, "po-0001");
    assert_eq!(duplicate.state, PaymentState::CheckingBalance);

    context(&account("vault.testnet"));
    let transfer = contract.on_balance_checked("po-0001".to_string(), Ok(U128(100)));
    assert!(matches!(transfer, PromiseOrValue::Promise(_)));
    assert_eq!(
        contract
            .get_payment_state("po-0001".to_string())
            .unwrap()
            .state,
        PaymentState::Processing
    );
    assert_eq!(contract.get_usage_state().total_reserved, U128(40));

    context(&account("vault.testnet"));
    let paid = contract.on_transfer_result("po-0001".to_string(), Ok(()));
    assert_eq!(paid.state, PaymentState::Paid);
    assert_eq!(contract.get_usage_state().total_spent, U128(40));
    assert_eq!(contract.get_usage_state().total_reserved, U128(0));
}

#[test]
fn failed_transfer_releases_reserved_capacity_and_records_failure() {
    let (mut contract, _, _, requester, _) = setup();
    let record = request(&mut contract, &requester, "po-0001");
    assert_eq!(record.state, PaymentState::CheckingBalance);

    context(&account("vault.testnet"));
    let _ = contract.on_balance_checked("po-0001".to_string(), Ok(U128(100)));
    let failed = contract.on_transfer_result("po-0001".to_string(), Err(PromiseError::Failed));
    assert_eq!(failed.state, PaymentState::Failed);
    assert_eq!(failed.reason, Some(BlockReason::TransferFailed));
    assert_eq!(contract.get_usage_state().total_spent, U128(0));
    assert_eq!(contract.get_usage_state().total_reserved, U128(0));
}

#[test]
fn balance_query_failure_records_failure_without_reserving() {
    let (mut contract, _, _, requester, _) = setup();
    let _ = request(&mut contract, &requester, "po-0001");

    context(&account("vault.testnet"));
    let failed = contract.on_balance_checked("po-0001".to_string(), Err(PromiseError::Failed));
    assert!(matches!(failed, PromiseOrValue::Value(_)));
    let record = contract.get_payment_state("po-0001".to_string()).unwrap();
    assert_eq!(record.state, PaymentState::Failed);
    assert_eq!(record.reason, Some(BlockReason::BalanceQueryFailed));
    assert_eq!(contract.get_usage_state().total_reserved, U128(0));
}

#[test]
fn insufficient_balance_is_blocked_and_cap_overage_waits_for_approval() {
    let (mut contract, _, _, requester, _) = setup();
    context(&account("procurement.testnet"));
    contract.commit_purchase_order(
        "po-large".to_string(),
        account("supplier.testnet"),
        account("test-token.testnet"),
        U128(120),
    );

    let _ = request(&mut contract, &requester, "po-0001");
    context(&account("vault.testnet"));
    let insufficient = contract.on_balance_checked("po-0001".to_string(), Ok(U128(39)));
    assert!(matches!(insufficient, PromiseOrValue::Value(_)));
    let blocked = contract.get_payment_state("po-0001".to_string()).unwrap();
    assert_eq!(blocked.state, PaymentState::Blocked);
    assert_eq!(blocked.reason, Some(BlockReason::InsufficientFunds));

    let _ = request(&mut contract, &requester, "po-large");
    context(&account("vault.testnet"));
    let pending = contract.on_balance_checked("po-large".to_string(), Ok(U128(500)));
    assert!(matches!(pending, PromiseOrValue::Value(_)));
    let pending_record = contract.get_payment_state("po-large".to_string()).unwrap();
    assert_eq!(pending_record.state, PaymentState::PendingApproval);
    assert_eq!(
        pending_record.approval_reasons,
        vec![carecart_vault::ApprovalReason::PerOrderCap]
    );
    assert_eq!(contract.get_usage_state().total_reserved, U128(0));

    context(&account("admin.testnet"));
    let approval = contract.approve_payment("po-large".to_string());
    assert!(matches!(approval, PromiseOrValue::Promise(_)));
    context(&account("vault.testnet"));
    let transfer = contract.on_balance_checked("po-large".to_string(), Ok(U128(500)));
    assert!(matches!(transfer, PromiseOrValue::Promise(_)));
    assert_eq!(contract.get_usage_state().total_reserved, U128(120));
    let paid = contract.on_transfer_result("po-large".to_string(), Ok(()));
    assert_eq!(paid.state, PaymentState::Paid);
}

#[test]
fn admin_rejection_is_recorded_for_a_pending_request() {
    let (mut contract, admin, _, requester, _) = setup();
    context(&account("procurement.testnet"));
    contract.commit_purchase_order(
        "po-pending-reject".to_string(),
        account("supplier.testnet"),
        account("test-token.testnet"),
        U128(120),
    );

    let _ = request(&mut contract, &requester, "po-pending-reject");
    context(&account("vault.testnet"));
    let pending = contract.on_balance_checked("po-pending-reject".to_string(), Ok(U128(500)));
    assert!(matches!(pending, PromiseOrValue::Value(_)));
    assert_eq!(
        contract
            .get_payment_state("po-pending-reject".to_string())
            .unwrap()
            .state,
        PaymentState::PendingApproval
    );

    context(&admin);
    let rejected = contract.reject_payment("po-pending-reject".to_string());
    assert_eq!(rejected.state, PaymentState::Rejected);
    assert_eq!(rejected.reason, Some(BlockReason::HumanRejected));
}

#[test]
fn non_requester_cannot_start_a_payment() {
    let (mut contract, _, _, _, _) = setup();
    context(&account("attacker.testnet"));
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = contract.request_payment("po-0001".to_string());
    }));
    assert!(result.is_err());
}

#[test]
fn decision_logic_still_identifies_policy_rejection() {
    let (contract, _, _, _, supplier) = setup();
    let mut policy_context = carecart_vault::PolicyContext {
        paused: true,
        supplier_allowed: true,
        request_id_used: false,
        available_balance: 100,
        daily_spent: 0,
        total_spent: 0,
    };
    let po = contract.get_purchase_order("po-0001".to_string()).unwrap();
    let decision = contract
        .get_policy()
        .evaluate(Some(&po), policy_context.clone());
    assert_eq!(
        decision,
        PaymentDecision::Blocked {
            reason: BlockReason::Paused,
        }
    );
    policy_context.paused = false;
    policy_context.supplier_allowed = false;
    assert_eq!(
        contract.get_policy().evaluate(Some(&po), policy_context),
        PaymentDecision::Blocked {
            reason: BlockReason::SupplierNotAllowed,
        }
    );
    assert_eq!(supplier, account("supplier.testnet"));
}
