use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, env,
    ext_contract, near, require,
};

const MAX_PO_ID_BYTES: usize = 64;
const NANOS_PER_DAY: u64 = 86_400_000_000_000;
const BALANCE_QUERY_GAS: Gas = Gas::from_tgas(5);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);
const TOKEN_TRANSFER_GAS: Gas = Gas::from_tgas(15);

#[ext_contract(ext_fungible_token)]
pub trait FungibleToken {
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// The active limits for automatic same-token payment requests.
///
/// Exceeding a limit sends an otherwise valid request to human approval. It does not
/// silently raise the limit or cause the vault to transfer funds.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    pub token_id: AccountId,
    pub per_order_cap: U128,
    pub daily_cap: U128,
    pub balance_cap: U128,
}

impl Policy {
    fn validate(&self) {
        require!(
            self.per_order_cap.0 > 0 && self.daily_cap.0 > 0 && self.balance_cap.0 > 0,
            "policy caps must be greater than zero"
        );
    }

    /// Evaluate one committed purchase order against a snapshot supplied by the vault's
    /// payment flow. This is not annotated as a NEAR method, so its inputs cannot be supplied
    /// over RPC. Contract code must construct the context from its own state and a verified
    /// FT query; exposing a balance parameter as a public contract method would let callers lie.
    pub fn evaluate(
        &self,
        purchase_order: Option<&PurchaseOrder>,
        context: PolicyContext,
    ) -> PaymentDecision {
        let Some(purchase_order) = purchase_order else {
            return PaymentDecision::Blocked {
                reason: BlockReason::PurchaseOrderNotFound,
            };
        };

        if context.paused {
            return PaymentDecision::Blocked {
                reason: BlockReason::Paused,
            };
        }
        if !context.supplier_allowed {
            return PaymentDecision::Blocked {
                reason: BlockReason::SupplierNotAllowed,
            };
        }
        if context.request_id_used {
            return PaymentDecision::Blocked {
                reason: BlockReason::DuplicateRequestId,
            };
        }
        if purchase_order.amount.0 == 0 || purchase_order.token_id != self.token_id {
            return PaymentDecision::Blocked {
                reason: BlockReason::InvalidPurchaseOrder,
            };
        }
        if context.available_balance < purchase_order.amount.0 {
            return PaymentDecision::Blocked {
                reason: BlockReason::InsufficientFunds,
            };
        }

        let amount = purchase_order.amount.0;
        let mut reasons = Vec::new();
        if amount > self.per_order_cap.0 {
            reasons.push(ApprovalReason::PerOrderCap);
        }
        if exceeds_cap(context.daily_spent, amount, self.daily_cap.0) {
            reasons.push(ApprovalReason::DailyCap);
        }
        if exceeds_cap(context.total_spent, amount, self.balance_cap.0) {
            reasons.push(ApprovalReason::BalanceCap);
        }

        if reasons.is_empty() {
            PaymentDecision::AutoPay
        } else {
            PaymentDecision::PendingApproval { reasons }
        }
    }
}

fn exceeds_cap(spent: u128, requested: u128, cap: u128) -> bool {
    spent
        .checked_add(requested)
        .is_none_or(|projected| projected > cap)
}

/// A canonical purchase order commitment stored by the vault before a payment request.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PurchaseOrder {
    pub po_id: String,
    pub supplier_id: AccountId,
    pub token_id: AccountId,
    pub amount: U128,
}

/// A snapshot of policy inputs used by the internal decision function.
/// This is a Rust type, not a contract-call argument.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicyContext {
    pub paused: bool,
    pub supplier_allowed: bool,
    pub request_id_used: bool,
    pub available_balance: u128,
    pub daily_spent: u128,
    pub total_spent: u128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PaymentDecision {
    AutoPay,
    PendingApproval { reasons: Vec<ApprovalReason> },
    Blocked { reason: BlockReason },
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ApprovalReason {
    PerOrderCap,
    DailyCap,
    BalanceCap,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BlockReason {
    PurchaseOrderNotFound,
    SupplierNotAllowed,
    Paused,
    DuplicateRequestId,
    InvalidPurchaseOrder,
    InsufficientFunds,
    BalanceQueryFailed,
    TransferFailed,
    AccountingOverflow,
    HumanRejected,
}

/// Payment lifecycle data returned by a read-only view.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PaymentRecord {
    pub request_id: String,
    pub po_id: String,
    pub amount: U128,
    pub state: PaymentState,
    pub reason: Option<BlockReason>,
    pub approval_reasons: Vec<ApprovalReason>,
    pub human_approved: bool,
    pub reserved_day: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
struct PaymentEntry {
    state: PaymentState,
    reason: Option<BlockReason>,
    approval_flags: u8,
    human_approved: bool,
    reserved_day: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UsageState {
    pub day: U64,
    pub daily_spent: U128,
    pub daily_reserved: U128,
    pub total_spent: U128,
    pub total_reserved: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PaymentState {
    NotRequested,
    CheckingBalance,
    PendingApproval,
    Blocked,
    Processing,
    Paid,
    Failed,
    Rejected,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    admin: AccountId,
    policy: Policy,
    paused: bool,
    suppliers: LookupSet<AccountId>,
    po_committers: LookupSet<AccountId>,
    payment_requesters: LookupSet<AccountId>,
    purchase_orders: LookupMap<String, PurchaseOrder>,
    payment_states: LookupMap<String, PaymentEntry>,
    daily_day: u64,
    daily_spent: u128,
    daily_reserved: u128,
    total_spent: u128,
    total_reserved: u128,
    commit_storage_reserve: u128,
}

#[near]
impl Contract {
    /// Initialize the vault with its administrator and first payment policy.
    #[init]
    pub fn new(admin: AccountId, policy: Policy) -> Self {
        policy.validate();
        Self {
            admin,
            policy,
            paused: false,
            suppliers: LookupSet::new(&b"carecart:suppliers"[..]),
            po_committers: LookupSet::new(&b"carecart:po-committers"[..]),
            payment_requesters: LookupSet::new(&b"carecart:payment-requesters"[..]),
            purchase_orders: LookupMap::new(&b"carecart:purchase-orders"[..]),
            payment_states: LookupMap::new(&b"carecart:payment-states"[..]),
            daily_day: current_day(),
            daily_spent: 0,
            daily_reserved: 0,
            total_spent: 0,
            total_reserved: 0,
            commit_storage_reserve: 0,
        }
    }

    /// Replace all active policy values. Only the configured administrator may call this.
    #[payable]
    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_admin();
        policy.validate();
        let storage_before = env::storage_usage();
        let policy_size_delta =
            policy.token_id.as_str().len() as i64 - self.policy.token_id.as_str().len() as i64;
        self.policy = policy;
        self.settle_storage_delta(storage_before, policy_size_delta);
    }

    /// Add or remove a supplier from the payment allowlist. Storage changes are funded by
    /// this call's attached deposit; excess deposit is returned to the administrator.
    #[payable]
    pub fn set_supplier_allowed(&mut self, supplier_id: AccountId, allowed: bool) {
        self.assert_admin();
        let storage_before = env::storage_usage();
        if allowed {
            self.suppliers.insert(supplier_id);
        } else {
            self.suppliers.remove(&supplier_id);
        }
        self.settle_storage_delta(storage_before, 0);
    }

    /// Grant or revoke permission to create immutable PO commitments.
    #[payable]
    pub fn set_po_committer(&mut self, committer: AccountId, allowed: bool) {
        self.assert_admin();
        let storage_before = env::storage_usage();
        if allowed {
            self.po_committers.insert(committer);
        } else {
            self.po_committers.remove(&committer);
        }
        self.settle_storage_delta(storage_before, 0);
    }

    /// Grant or revoke permission to request payment for committed POs.
    #[payable]
    pub fn set_payment_requester(&mut self, requester: AccountId, allowed: bool) {
        self.assert_admin();
        let storage_before = env::storage_usage();
        if allowed {
            self.payment_requesters.insert(requester);
        } else {
            self.payment_requesters.remove(&requester);
        }
        self.settle_storage_delta(storage_before, 0);
    }

    /// Stop or resume payment processing. Only the configured administrator may call this.
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_admin();
        self.paused = paused;
    }

    /// Human-controlled funding for zero-deposit, function-call-key PO commitments.
    #[payable]
    pub fn fund_commit_storage(&mut self) {
        self.assert_admin();
        self.commit_storage_reserve = self
            .commit_storage_reserve
            .checked_add(env::attached_deposit().as_yoctonear())
            .expect("storage reserve overflow");
    }

    pub fn get_commit_storage_reserve(&self) -> U128 {
        U128(self.commit_storage_reserve)
    }

    /// Store the canonical payee, token, and smallest-unit amount for one PO ID.
    /// A PO ID can be committed exactly once. Later requests will resolve their payment
    /// details from this record rather than caller-provided values.
    #[payable]
    pub fn commit_purchase_order(
        &mut self,
        po_id: String,
        supplier_id: AccountId,
        token_id: AccountId,
        amount: U128,
    ) {
        require!(
            self.po_committers.contains(&env::predecessor_account_id()),
            "caller is not an authorized PO committer"
        );
        require!(
            !po_id.is_empty()
                && po_id.len() <= MAX_PO_ID_BYTES
                && po_id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'),
            "invalid purchase order id"
        );
        require!(
            amount.0 > 0,
            "purchase order amount must be greater than zero"
        );
        require!(
            self.suppliers.contains(&supplier_id),
            "supplier is not allowlisted"
        );
        require!(
            token_id == self.policy.token_id,
            "purchase order token is not configured"
        );
        require!(
            !self.purchase_orders.contains_key(&po_id),
            "purchase order id is already committed"
        );

        let storage_before = env::storage_usage();
        let purchase_order = PurchaseOrder {
            po_id: po_id.clone(),
            supplier_id,
            token_id,
            amount,
        };
        self.purchase_orders.insert(po_id.clone(), purchase_order);
        self.payment_states.insert(
            po_id,
            PaymentEntry {
                state: PaymentState::NotRequested,
                reason: None,
                approval_flags: 0,
                human_approved: false,
                reserved_day: 0,
            },
        );
        if env::attached_deposit().is_zero() {
            self.purchase_orders.flush();
            self.payment_states.flush();
            let required = u128::from(env::storage_usage().saturating_sub(storage_before))
                .checked_mul(env::storage_byte_cost().as_yoctonear())
                .expect("storage charge overflow");
            self.commit_storage_reserve = self
                .commit_storage_reserve
                .checked_sub(required)
                .expect("PO storage reserve is insufficient");
        } else {
            self.settle_storage_delta(storage_before, 0);
        }
    }

    /// Return the configured administrator.
    pub fn get_admin(&self) -> AccountId {
        self.admin.clone()
    }

    /// Return current limits and the configured test/payment token contract.
    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    /// Check supplier allowlist membership.
    pub fn is_supplier_allowed(&self, supplier_id: AccountId) -> bool {
        self.suppliers.contains(&supplier_id)
    }

    /// Check whether an account can commit PO records.
    pub fn is_po_committer(&self, account_id: AccountId) -> bool {
        self.po_committers.contains(&account_id)
    }

    /// Return whether payment processing is paused.
    pub fn is_paused(&self) -> bool {
        self.paused
    }

    /// Read a canonical PO commitment by ID.
    pub fn get_purchase_order(&self, po_id: String) -> Option<PurchaseOrder> {
        self.purchase_orders.get(&po_id).cloned()
    }

    /// Request payment for one committed PO. The PO ID is also the idempotency key, so a
    /// repeated call returns the existing state and can never start a second transfer.
    pub fn request_payment(&mut self, po_id: String) -> PromiseOrValue<PaymentRecord> {
        let requester = env::predecessor_account_id();
        require!(
            self.payment_requesters.contains(&requester),
            "caller is not an authorized payment requester"
        );

        if !valid_po_id(&po_id) {
            let record = blocked_record(po_id.clone(), BlockReason::InvalidPurchaseOrder);
            self.emit_payment_state(&record);
            return PromiseOrValue::Value(record);
        }

        let Some(purchase_order) = self.purchase_orders.get(&po_id).cloned() else {
            let record = blocked_record(po_id.clone(), BlockReason::PurchaseOrderNotFound);
            self.emit_payment_state(&record);
            return PromiseOrValue::Value(record);
        };
        let Some(mut entry) = self.payment_states.get(&po_id).cloned() else {
            let record = blocked_record(po_id.clone(), BlockReason::PurchaseOrderNotFound);
            self.emit_payment_state(&record);
            return PromiseOrValue::Value(record);
        };

        if entry.state != PaymentState::NotRequested {
            return PromiseOrValue::Value(self.payment_record(&purchase_order, &entry));
        }

        self.roll_daily_period();
        let preflight = self.evaluate_request(&purchase_order, u128::MAX);
        if let PaymentDecision::Blocked { reason } = preflight {
            entry.state = PaymentState::Blocked;
            entry.reason = Some(reason);
            self.payment_states.insert(po_id.clone(), entry.clone());
            let record = self.payment_record(&purchase_order, &entry);
            self.emit_payment_state(&record);
            return PromiseOrValue::Value(record);
        }

        entry.state = PaymentState::CheckingBalance;
        entry.reason = None;
        entry.approval_flags = 0;
        entry.human_approved = false;
        entry.reserved_day = 0;
        self.payment_states.insert(po_id.clone(), entry);
        self.emit_payment_state(
            &self.payment_record_from_state(&po_id).unwrap_or_else(|| {
                blocked_record(po_id.clone(), BlockReason::PurchaseOrderNotFound)
            }),
        );
        PromiseOrValue::Promise(self.query_token_balance(po_id))
    }

    /// Approve a cap-exceeding request and recheck token balance and current hard blocks.
    pub fn approve_payment(&mut self, po_id: String) -> PromiseOrValue<PaymentRecord> {
        self.assert_admin();
        if !self.purchase_orders.contains_key(&po_id) {
            return PromiseOrValue::Value(blocked_record(
                po_id,
                BlockReason::PurchaseOrderNotFound,
            ));
        }
        let Some(mut entry) = self.payment_states.get(&po_id).cloned() else {
            return PromiseOrValue::Value(blocked_record(
                po_id,
                BlockReason::PurchaseOrderNotFound,
            ));
        };
        require!(
            entry.state == PaymentState::PendingApproval,
            "payment is not pending approval"
        );
        entry.human_approved = true;
        entry.state = PaymentState::CheckingBalance;
        entry.reason = None;
        self.payment_states.insert(po_id.clone(), entry);
        let record = self
            .payment_record_from_state(&po_id)
            .unwrap_or_else(|| blocked_record(po_id.clone(), BlockReason::PurchaseOrderNotFound));
        self.emit_payment_state(&record);
        PromiseOrValue::Promise(self.query_token_balance(po_id))
    }

    /// Reject a cap-exceeding request. Only the configured administrator may do so.
    pub fn reject_payment(&mut self, po_id: String) -> PaymentRecord {
        self.assert_admin();
        let Some(purchase_order) = self.purchase_orders.get(&po_id).cloned() else {
            return blocked_record(po_id, BlockReason::PurchaseOrderNotFound);
        };
        let Some(mut entry) = self.payment_states.get(&po_id).cloned() else {
            return blocked_record(po_id, BlockReason::PurchaseOrderNotFound);
        };
        require!(
            entry.state == PaymentState::PendingApproval,
            "payment is not pending approval"
        );
        entry.state = PaymentState::Rejected;
        entry.reason = Some(BlockReason::HumanRejected);
        self.payment_states.insert(po_id, entry.clone());
        let record = self.payment_record(&purchase_order, &entry);
        self.emit_payment_state(&record);
        record
    }

    /// Private callback after querying the configured token's actual vault balance.
    #[private]
    pub fn on_balance_checked(
        &mut self,
        po_id: String,
        #[callback_result] balance_result: Result<U128, PromiseError>,
    ) -> PromiseOrValue<PaymentRecord> {
        let Some(purchase_order) = self.purchase_orders.get(&po_id).cloned() else {
            return PromiseOrValue::Value(blocked_record(
                po_id,
                BlockReason::PurchaseOrderNotFound,
            ));
        };
        let Some(mut entry) = self.payment_states.get(&po_id).cloned() else {
            return PromiseOrValue::Value(blocked_record(
                po_id,
                BlockReason::PurchaseOrderNotFound,
            ));
        };
        if entry.state != PaymentState::CheckingBalance {
            return PromiseOrValue::Value(self.payment_record(&purchase_order, &entry));
        }

        self.roll_daily_period();
        let balance = match balance_result {
            Ok(balance) => balance.0,
            Err(_) => {
                entry.state = PaymentState::Failed;
                entry.reason = Some(BlockReason::BalanceQueryFailed);
                self.payment_states.insert(po_id.clone(), entry.clone());
                let record = self.payment_record(&purchase_order, &entry);
                self.emit_payment_state(&record);
                return PromiseOrValue::Value(record);
            }
        };

        let available = balance.saturating_sub(self.total_reserved);
        match self.evaluate_request(&purchase_order, available) {
            PaymentDecision::Blocked { reason } => {
                entry.state = PaymentState::Blocked;
                entry.reason = Some(reason);
                self.payment_states.insert(po_id.clone(), entry.clone());
                let record = self.payment_record(&purchase_order, &entry);
                self.emit_payment_state(&record);
                PromiseOrValue::Value(record)
            }
            PaymentDecision::PendingApproval { reasons } if !entry.human_approved => {
                entry.state = PaymentState::PendingApproval;
                entry.reason = None;
                entry.approval_flags = approval_flags(&reasons);
                self.payment_states.insert(po_id.clone(), entry.clone());
                let record = self.payment_record(&purchase_order, &entry);
                self.emit_payment_state(&record);
                PromiseOrValue::Value(record)
            }
            PaymentDecision::PendingApproval { reasons } => {
                entry.approval_flags = approval_flags(&reasons);
                self.reserve_and_transfer(po_id, purchase_order, entry)
            }
            PaymentDecision::AutoPay => {
                entry.approval_flags = 0;
                self.reserve_and_transfer(po_id, purchase_order, entry)
            }
        }
    }

    /// Private callback after the NEP-141 transfer succeeds or fails.
    #[private]
    pub fn on_transfer_result(
        &mut self,
        po_id: String,
        #[callback_result] transfer_result: Result<(), PromiseError>,
    ) -> PaymentRecord {
        let Some(purchase_order) = self.purchase_orders.get(&po_id).cloned() else {
            return blocked_record(po_id, BlockReason::PurchaseOrderNotFound);
        };
        let Some(mut entry) = self.payment_states.get(&po_id).cloned() else {
            return blocked_record(po_id, BlockReason::PurchaseOrderNotFound);
        };
        if entry.state != PaymentState::Processing {
            return self.payment_record(&purchase_order, &entry);
        }

        self.roll_daily_period();
        self.total_reserved = self.total_reserved.saturating_sub(purchase_order.amount.0);
        if entry.reserved_day == self.daily_day {
            self.daily_reserved = self.daily_reserved.saturating_sub(purchase_order.amount.0);
        }

        match transfer_result {
            Ok(()) => {
                self.total_spent = self.total_spent.saturating_add(purchase_order.amount.0);
                if entry.reserved_day == self.daily_day {
                    self.daily_spent = self.daily_spent.saturating_add(purchase_order.amount.0);
                }
                entry.state = PaymentState::Paid;
                entry.reason = None;
            }
            Err(_) => {
                entry.state = PaymentState::Failed;
                entry.reason = Some(BlockReason::TransferFailed);
            }
        }

        self.payment_states.insert(po_id, entry.clone());
        let record = self.payment_record(&purchase_order, &entry);
        self.emit_payment_state(&record);
        record
    }

    /// Read payment lifecycle state without exposing signer keys or secrets.
    pub fn get_payment_state(&self, request_id: String) -> Option<PaymentRecord> {
        self.payment_record_from_state(&request_id)
    }

    /// Read cumulative and currently reserved policy capacity.
    pub fn get_usage_state(&self) -> UsageState {
        UsageState {
            day: U64(self.daily_day),
            daily_spent: U128(self.daily_spent),
            daily_reserved: U128(self.daily_reserved),
            total_spent: U128(self.total_spent),
            total_reserved: U128(self.total_reserved),
        }
    }
}

impl Contract {
    fn evaluate_request(
        &self,
        purchase_order: &PurchaseOrder,
        available_balance: u128,
    ) -> PaymentDecision {
        self.policy.evaluate(
            Some(purchase_order),
            PolicyContext {
                paused: self.paused,
                supplier_allowed: self.suppliers.contains(&purchase_order.supplier_id),
                request_id_used: false,
                available_balance,
                daily_spent: self.daily_spent.saturating_add(self.daily_reserved),
                total_spent: self.total_spent.saturating_add(self.total_reserved),
            },
        )
    }

    fn roll_daily_period(&mut self) {
        let day = current_day();
        if day > self.daily_day {
            self.daily_day = day;
            self.daily_spent = 0;
            self.daily_reserved = 0;
        }
    }

    fn query_token_balance(&self, po_id: String) -> Promise {
        ext_fungible_token::ext(self.policy.token_id.clone())
            .with_static_gas(BALANCE_QUERY_GAS)
            .ft_balance_of(env::current_account_id())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_balance_checked(po_id),
            )
    }

    fn reserve_and_transfer(
        &mut self,
        po_id: String,
        purchase_order: PurchaseOrder,
        mut entry: PaymentEntry,
    ) -> PromiseOrValue<PaymentRecord> {
        let amount = purchase_order.amount.0;
        let daily_total_fits = self
            .daily_spent
            .checked_add(self.daily_reserved)
            .and_then(|used| used.checked_add(amount))
            .is_some();
        let total_fits = self
            .total_spent
            .checked_add(self.total_reserved)
            .and_then(|used| used.checked_add(amount))
            .is_some();
        let Some(new_daily_reserved) = self.daily_reserved.checked_add(amount) else {
            return self.block_accounting_overflow(po_id, purchase_order, entry);
        };
        let Some(new_total_reserved) = self.total_reserved.checked_add(amount) else {
            return self.block_accounting_overflow(po_id, purchase_order, entry);
        };
        if !daily_total_fits || !total_fits {
            return self.block_accounting_overflow(po_id, purchase_order, entry);
        }

        self.daily_reserved = new_daily_reserved;
        self.total_reserved = new_total_reserved;
        entry.state = PaymentState::Processing;
        entry.reason = None;
        entry.reserved_day = self.daily_day;
        self.payment_states.insert(po_id.clone(), entry.clone());
        let record = self.payment_record(&purchase_order, &entry);
        self.emit_payment_state(&record);

        let memo = Some(format!("CareCart PO {}", po_id));
        let transfer = ext_fungible_token::ext(purchase_order.token_id)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(TOKEN_TRANSFER_GAS)
            .ft_transfer(purchase_order.supplier_id, purchase_order.amount, memo)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_transfer_result(po_id),
            );
        PromiseOrValue::Promise(transfer)
    }

    fn block_accounting_overflow(
        &mut self,
        po_id: String,
        purchase_order: PurchaseOrder,
        mut entry: PaymentEntry,
    ) -> PromiseOrValue<PaymentRecord> {
        entry.state = PaymentState::Blocked;
        entry.reason = Some(BlockReason::AccountingOverflow);
        self.payment_states.insert(po_id, entry.clone());
        let record = self.payment_record(&purchase_order, &entry);
        self.emit_payment_state(&record);
        PromiseOrValue::Value(record)
    }

    fn payment_record(
        &self,
        purchase_order: &PurchaseOrder,
        entry: &PaymentEntry,
    ) -> PaymentRecord {
        PaymentRecord {
            request_id: purchase_order.po_id.clone(),
            po_id: purchase_order.po_id.clone(),
            amount: purchase_order.amount,
            state: entry.state.clone(),
            reason: entry.reason.clone(),
            approval_reasons: approval_reasons(entry.approval_flags),
            human_approved: entry.human_approved,
            reserved_day: U64(entry.reserved_day),
        }
    }

    fn payment_record_from_state(&self, po_id: &str) -> Option<PaymentRecord> {
        let purchase_order = self.purchase_orders.get(po_id)?;
        let entry = self.payment_states.get(po_id)?;
        Some(self.payment_record(purchase_order, entry))
    }

    fn emit_payment_state(&self, record: &PaymentRecord) {
        let event = serde_json::json!({
            "standard": "carecart",
            "version": "1.0.0",
            "event": "payment_state",
            "data": [record],
        });
        env::log_str(&format!("EVENT_JSON:{event}"));
    }

    fn assert_admin(&self) {
        require!(
            env::predecessor_account_id() == self.admin,
            "only the configured admin may perform this action"
        );
    }

    /// Charge positive storage growth to the attached deposit and return unused funds.
    /// This is called only after a state mutation; a panic on insufficient deposit reverts
    /// the transaction on chain.
    fn settle_storage_delta(&mut self, storage_before: u64, known_state_delta: i64) {
        // LookupMap buffers writes. Flush before reading storage_usage or an underfunded call
        // can consume vault balance without charging the caller. LookupSet writes directly.
        self.purchase_orders.flush();
        self.payment_states.flush();

        let storage_after = env::storage_usage();
        let attached = env::attached_deposit().as_yoctonear();
        let byte_cost = env::storage_byte_cost().as_yoctonear();
        let measured_delta = storage_after as i128 - storage_before as i128;
        let storage_delta = measured_delta + i128::from(known_state_delta);

        let refund = if storage_delta >= 0 {
            let growth = storage_delta as u128;
            let required = growth
                .checked_mul(byte_cost)
                .expect("storage deposit calculation overflow");
            require!(
                attached >= required,
                "attached deposit does not cover storage growth"
            );
            attached - required
        } else {
            let released = storage_delta.unsigned_abs();
            let released_value = released
                .checked_mul(byte_cost)
                .expect("storage refund calculation overflow");
            attached
                .checked_add(released_value)
                .expect("storage refund calculation overflow")
        };

        if refund > 0 {
            Promise::new(env::predecessor_account_id())
                .transfer(NearToken::from_yoctonear(refund))
                .detach();
        }
    }
}

fn current_day() -> u64 {
    env::block_timestamp() / NANOS_PER_DAY
}

fn valid_po_id(po_id: &str) -> bool {
    !po_id.is_empty()
        && po_id.len() <= MAX_PO_ID_BYTES
        && po_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn approval_flags(reasons: &[ApprovalReason]) -> u8 {
    reasons.iter().fold(0, |flags, reason| {
        flags
            | match reason {
                ApprovalReason::PerOrderCap => 1,
                ApprovalReason::DailyCap => 2,
                ApprovalReason::BalanceCap => 4,
            }
    })
}

fn approval_reasons(flags: u8) -> Vec<ApprovalReason> {
    let mut reasons = Vec::new();
    if flags & 1 != 0 {
        reasons.push(ApprovalReason::PerOrderCap);
    }
    if flags & 2 != 0 {
        reasons.push(ApprovalReason::DailyCap);
    }
    if flags & 4 != 0 {
        reasons.push(ApprovalReason::BalanceCap);
    }
    reasons
}

fn blocked_record(po_id: String, reason: BlockReason) -> PaymentRecord {
    PaymentRecord {
        request_id: po_id.clone(),
        po_id,
        amount: U128(0),
        state: PaymentState::Blocked,
        reason: Some(reason),
        approval_reasons: Vec::new(),
        human_approved: false,
        reserved_day: U64(current_day()),
    }
}
