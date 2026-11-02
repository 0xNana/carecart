use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::storage_management::StorageBalance;
use near_sdk::json_types::{U64, U128};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
    assert_one_yocto, env, ext_contract, near, require,
};

pub const UNIT: u128 = 1_000_000;
pub const ABSOLUTE_PAYOUT_MAX: u128 = 25 * UNIT;
pub const ABSOLUTE_DAILY_MAX: u128 = 25 * UNIT;
pub const ABSOLUTE_ACCEPTED_BALANCE_MAX: u128 = 50 * UNIT;
const DAY: u64 = 86_400_000_000_000;
const MAX_REGISTRATION: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR; separately reviewed per quote.
#[ext_contract(ext_ft)]
pub trait Ft {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance;
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    pub auto_per_po_limit: U128,
    pub hard_payout_limit: U128,
    pub daily_dispatch_limit: U128,
    pub accepted_deposit_ceiling: U128,
}
impl Policy {
    pub fn initial() -> Self {
        Self {
            auto_per_po_limit: U128(10 * UNIT),
            hard_payout_limit: U128(25 * UNIT),
            daily_dispatch_limit: U128(25 * UNIT),
            accepted_deposit_ceiling: U128(5 * UNIT),
        }
    }
    fn validate(&self) {
        require!(
            self.auto_per_po_limit.0 > 0 && self.auto_per_po_limit.0 <= self.hard_payout_limit.0,
            "invalid auto threshold"
        );
        require!(
            self.hard_payout_limit.0 > 0 && self.hard_payout_limit.0 <= ABSOLUTE_PAYOUT_MAX,
            "absolute payout maximum"
        );
        require!(
            self.daily_dispatch_limit.0 > 0 && self.daily_dispatch_limit.0 <= ABSOLUTE_DAILY_MAX,
            "absolute daily maximum"
        );
        require!(
            self.accepted_deposit_ceiling.0 > 0
                && self.accepted_deposit_ceiling.0 <= ABSOLUTE_ACCEPTED_BALANCE_MAX,
            "absolute accepted-balance maximum"
        );
    }
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Destination {
    Near,
    Base {
        route_id: String,
        version: u32,
        route_hash: String,
    },
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PurchaseOrder {
    pub po_id: String,
    pub profile: String,
    pub supplier: AccountId,
    pub token: AccountId,
    pub amount: U128,
    pub invoice_digest: String,
    pub destination: Destination,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Route {
    pub route_id: String,
    pub version: u32,
    pub supplier: AccountId,
    pub recipient: String,
    pub asset_id: String,
    pub active: bool,
}
impl Route {
    /// Ordered JSON array, shared with the backend; no arbitrary-object serialization.
    pub fn commitment_hash(&self) -> String {
        let bytes = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!([
            self.route_id,
            self.version,
            self.supplier,
            self.recipient,
            self.asset_id,
            self.active
        ]))
        .expect("route serialization");
        env::sha256(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuoteCommitment {
    pub attempt_id: String,
    pub po_id: String,
    pub route_id: String,
    pub route_version: u32,
    pub signed_quote_hash: String,
    pub deposit_account: AccountId,
    pub deadline_ns: U64,
    pub min_amount_out: U128,
    pub storage_deposit_yocto: U128,
}
impl QuoteCommitment {
    pub fn commitment_hash(&self) -> String {
        let bytes = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!([
            self.attempt_id,
            self.po_id,
            self.route_id,
            self.route_version,
            self.signed_quote_hash,
            self.deposit_account,
            self.deadline_ns.0.to_string(),
            self.min_amount_out.0.to_string(),
            self.storage_deposit_yocto.0.to_string()
        ]))
        .expect("quote commitment serialization");
        env::sha256(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    Committed,
    PendingApproval,
    Registering,
    Dispatching,
    Dispatched,
    Paid,
    Rejected,
    Blocked,
    Expired,
    Failed,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reason {
    None,
    Paused,
    UnknownSupplier,
    InvalidRoute,
    InvalidQuote,
    OverHardLimit,
    DailyCapacity,
    AutoThreshold,
    InsufficientFunds,
    RegistrationFailed,
    TransferFailed,
    HumanRejected,
    Expired,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payment {
    pub status: Status,
    pub reason: Reason,
    pub reserved_day: u64,
    pub attempt_id: String,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DayUsage {
    pub spent: U128,
    pub reserved: U128,
}
#[near(serializers=[json,borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Withdrawal {
    pub amount: U128,
    pub status: Status,
}
#[near(serializers=[json])]
pub struct State {
    pub profile: String,
    pub admin: AccountId,
    pub pending_admin: Option<AccountId>,
    pub guardian: AccountId,
    pub treasury: AccountId,
    pub token: AccountId,
    pub paused: bool,
    pub policy: Policy,
    pub accounted_balance: U128,
    pub reserved_payment: U128,
    pub reserved_withdrawal: U128,
    pub spendable: U128,
    pub storage_reserve: U128,
    pub day: U64,
    pub usage: DayUsage,
}
#[near(serializers=[json])]
pub struct RoleMembership {
    pub committer: bool,
    pub requester: bool,
    pub supplier: bool,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    admin: AccountId,
    pending_admin: Option<AccountId>,
    guardian: AccountId,
    treasury: AccountId,
    token: AccountId,
    profile: String,
    paused: bool,
    policy: Policy,
    accounted: u128,
    payment_reserved: u128,
    withdrawal_reserved: u128,
    storage_reserve: u128,
    next_withdrawal: u64,
    suppliers: LookupSet<AccountId>,
    committers: LookupSet<AccountId>,
    requesters: LookupSet<AccountId>,
    orders: LookupMap<String, PurchaseOrder>,
    payments: LookupMap<String, Payment>,
    routes: LookupMap<String, Route>,
    quotes: LookupMap<String, QuoteCommitment>,
    days: LookupMap<u64, DayUsage>,
    withdrawals: LookupMap<u64, Withdrawal>,
}
#[near]
impl Contract {
    #[init]
    pub fn new(
        admin: AccountId,
        guardian: AccountId,
        treasury: AccountId,
        token: AccountId,
        policy: Policy,
    ) -> Self {
        require!(
            admin != guardian && admin != treasury && guardian != treasury,
            "independent human roles required"
        );
        policy.validate();
        let profile = if env::current_account_id().as_str().ends_with(".testnet") {
            "testnet"
        } else {
            "mainnet"
        };
        if profile == "mainnet" {
            require!(
                token.as_str()
                    == "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
                "canonical native USDC required"
            );
        } else {
            require!(
                token.as_str().ends_with(".testnet"),
                "testnet token required"
            );
        }
        Self {
            admin,
            pending_admin: None,
            guardian,
            treasury,
            token,
            profile: profile.into(),
            paused: true,
            policy,
            accounted: 0,
            payment_reserved: 0,
            withdrawal_reserved: 0,
            storage_reserve: 0,
            next_withdrawal: 0,
            suppliers: LookupSet::new(b"s"),
            committers: LookupSet::new(b"c"),
            requesters: LookupSet::new(b"a"),
            orders: LookupMap::new(b"o"),
            payments: LookupMap::new(b"p"),
            routes: LookupMap::new(b"r"),
            quotes: LookupMap::new(b"q"),
            days: LookupMap::new(b"d"),
            withdrawals: LookupMap::new(b"w"),
        }
    }
    #[payable]
    pub fn pause(&mut self) {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        require!(
            caller == self.admin || caller == self.guardian,
            "only admin or guardian"
        );
        self.paused = true;
        event("paused", near_sdk::serde_json::json!({"by":caller}));
    }
    #[payable]
    pub fn unpause(&mut self) {
        self.admin();
        self.paused = false;
        event("unpaused", near_sdk::serde_json::json!({"by":self.admin}));
    }
    /// Human authority changes occur while paused; the treasury never rotates.
    #[payable]
    pub fn propose_admin(&mut self, new_admin: Option<AccountId>) {
        self.admin();
        require!(self.paused, "pause before rotating human roles");
        if let Some(account) = &new_admin {
            self.independent_human(account);
            require!(
                account != &self.admin && account != &self.guardian,
                "independent new admin required"
            );
        }
        let previous_bytes = self
            .pending_admin
            .as_ref()
            .map_or(0, |a| 4 + a.as_str().len() as u64);
        let next_bytes = new_admin
            .as_ref()
            .map_or(0, |a| 4 + a.as_str().len() as u64);
        self.charge_storage_delta(previous_bytes, next_bytes);
        self.pending_admin = new_admin;
        event(
            "admin_transfer_proposed",
            near_sdk::serde_json::json!({"by":self.admin,"pending_admin":self.pending_admin}),
        );
    }
    #[payable]
    pub fn accept_admin(&mut self) {
        assert_one_yocto();
        require!(self.paused, "pause before rotating human roles");
        let successor = self.pending_admin.clone().expect("no proposed admin");
        require!(
            env::predecessor_account_id() == successor,
            "only proposed admin"
        );
        self.independent_human(&successor);
        require!(successor != self.guardian, "guardian cannot become admin");
        self.charge_storage_delta(
            self.admin.as_str().len() as u64 + 4 + successor.as_str().len() as u64,
            successor.as_str().len() as u64,
        );
        let previous = std::mem::replace(&mut self.admin, successor);
        self.pending_admin = None;
        event(
            "admin_transferred",
            near_sdk::serde_json::json!({"previous":previous,"admin":self.admin}),
        );
    }
    #[payable]
    pub fn set_guardian(&mut self, guardian: AccountId) {
        self.admin();
        require!(self.paused, "pause before rotating human roles");
        require!(
            guardian != self.admin && self.pending_admin.as_ref() != Some(&guardian),
            "independent human roles required"
        );
        self.independent_human(&guardian);
        self.charge_storage_delta(
            self.guardian.as_str().len() as u64,
            guardian.as_str().len() as u64,
        );
        let previous = std::mem::replace(&mut self.guardian, guardian);
        event(
            "guardian_rotated",
            near_sdk::serde_json::json!({"previous":previous,"guardian":self.guardian}),
        );
    }
    #[payable]
    pub fn set_policy(&mut self, policy: Policy) {
        self.admin();
        policy.validate();
        require!(
            policy.accepted_deposit_ceiling.0 >= self.accounted,
            "withdraw before lowering accepted ceiling"
        );
        self.policy = policy;
        event(
            "policy_updated",
            near_sdk::serde_json::json!({"policy":self.policy}),
        );
    }
    #[payable]
    pub fn fund_storage(&mut self) {
        require!(env::predecessor_account_id() == self.admin, "only admin");
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "positive storage funding required");
        self.storage_reserve = self
            .storage_reserve
            .checked_add(amount)
            .expect("storage reserve overflow");
        event(
            "storage_funded",
            near_sdk::serde_json::json!({"amount":U128(amount)}),
        );
    }
    #[payable]
    pub fn set_supplier(&mut self, supplier: AccountId, allowed: bool) {
        self.admin();
        let before = env::storage_usage();
        if allowed {
            self.suppliers.insert(supplier.clone());
        } else {
            self.suppliers.remove(&supplier);
        }

        self.storage_delta(before);
        event(
            "supplier_updated",
            near_sdk::serde_json::json!({"supplier":supplier,"allowed":allowed}),
        );
    }
    #[payable]
    pub fn set_role(&mut self, account: AccountId, role: String, allowed: bool) {
        self.admin();
        require!(
            account != self.admin
                && account != self.guardian
                && account != self.treasury
                && account != self.token
                && account != env::current_account_id()
                && self.pending_admin.as_ref() != Some(&account),
            "backend role must be independent"
        );
        let before = env::storage_usage();
        match role.as_str() {
            "committer" => {
                if allowed {
                    require!(
                        !self.requesters.contains(&account),
                        "backend roles must be distinct"
                    );
                    self.committers.insert(account.clone());
                } else {
                    self.committers.remove(&account);
                }
            }
            "requester" => {
                if allowed {
                    require!(
                        !self.committers.contains(&account),
                        "backend roles must be distinct"
                    );
                    self.requesters.insert(account.clone());
                } else {
                    self.requesters.remove(&account);
                }
            }
            _ => env::panic_str("unknown role"),
        }
        self.storage_delta(before);
        event(
            "role_updated",
            near_sdk::serde_json::json!({"account":account,"role":role,"allowed":allowed}),
        );
    }
    #[payable]
    pub fn rotate_role(&mut self, old_account: AccountId, new_account: AccountId, role: String) {
        self.admin();
        require!(
            old_account != new_account,
            "distinct rotation accounts required"
        );
        let old_allowed = match role.as_str() {
            "committer" => self.committers.contains(&old_account),
            "requester" => self.requesters.contains(&old_account),
            _ => env::panic_str("unknown role"),
        };
        require!(old_allowed, "old role is not active");
        // Validate/grant the new role before revoking the old one. One receipt is atomic.
        self.set_role(new_account.clone(), role.clone(), true);
        self.set_role(old_account.clone(), role.clone(), false);
        event(
            "role_rotated",
            near_sdk::serde_json::json!({"role":role,"previous":old_account,"account":new_account}),
        );
    }
    #[payable]
    pub fn set_route(&mut self, route: Route) {
        self.admin();
        valid_id(&route.route_id);
        require!(
            self.suppliers.contains(&route.supplier),
            "supplier not allowed"
        );
        require!(
            route.recipient.len() == 42
                && route.recipient.starts_with("0x")
                && route.recipient[2..].bytes().all(|c| c.is_ascii_hexdigit()),
            "invalid Base recipient"
        );
        require!(
            route.asset_id.starts_with("nep141:base-") && route.asset_id.len() <= 256,
            "Base asset required"
        );
        if self.profile == "mainnet" {
            require!(
                route.asset_id
                    == "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
                "native Base USDC route required"
            );
        }
        if let Some(previous) = self.routes.get(&route.route_id) {
            require!(
                route.version
                    == previous
                        .version
                        .checked_add(1)
                        .expect("route version overflow"),
                "route version must advance"
            );
        } else {
            require!(route.version == 1, "first route version must be one");
        }
        let before = env::storage_usage();
        self.routes.insert(route.route_id.clone(), route.clone());
        self.routes.flush();
        self.storage_delta(before);
        event(
            "route_updated",
            near_sdk::serde_json::json!({"route":route}),
        );
    }
    pub fn commit_purchase_order(&mut self, order: PurchaseOrder) {
        self.committer();
        valid_id(&order.po_id);
        valid_hash(&order.invoice_digest);
        require!(
            order.profile == self.profile && order.token == self.token && order.amount.0 > 0,
            "invalid PO profile/token/amount"
        );
        if let Some(old) = self.orders.get(&order.po_id) {
            require!(old == &order, "immutable PO conflict");
            return;
        }
        if let Destination::Base {
            route_id,
            version,
            route_hash,
        } = &order.destination
        {
            valid_id(route_id);
            valid_hash(route_hash);
            let route = self.routes.get(route_id).expect("unknown route");
            require!(
                route.version == *version
                    && route.supplier == order.supplier
                    && route.active
                    && route.commitment_hash() == *route_hash,
                "invalid PO route"
            );
        }
        let before = env::storage_usage();
        let key = order.po_id.clone();
        self.orders.insert(key.clone(), order.clone());
        self.orders.flush();
        self.payments.insert(
            key,
            Payment {
                status: Status::Committed,
                reason: Reason::None,
                reserved_day: 0,
                attempt_id: String::new(),
            },
        );
        self.payments.flush();
        self.storage_delta(before);
        event("po_committed", near_sdk::serde_json::json!({"order":order}));
    }
    pub fn commit_quote(&mut self, quote: QuoteCommitment) {
        self.committer();
        valid_id(&quote.attempt_id);
        valid_hash(&quote.signed_quote_hash);
        let order = self.orders.get(&quote.po_id).expect("unknown PO");
        require!(
            matches!(&order.destination, Destination::Base { route_id, version, .. }
            if route_id == &quote.route_id && *version == quote.route_version),
            "quote route mismatch"
        );
        if let Some(old) = self.quotes.get(&quote.attempt_id) {
            require!(old == &quote, "immutable quote conflict");
            return;
        }
        require!(
            quote.deposit_account.as_str().len() == 64
                && quote
                    .deposit_account
                    .as_str()
                    .bytes()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
            "implicit deposit account required"
        );
        require!(
            quote.deadline_ns.0 > env::block_timestamp()
                && quote.min_amount_out.0 > 0
                && quote.storage_deposit_yocto.0 <= MAX_REGISTRATION,
            "invalid quote deadline/output/storage"
        );
        let before = env::storage_usage();
        self.quotes.insert(quote.attempt_id.clone(), quote.clone());
        self.quotes.flush();
        self.storage_delta(before);
        event(
            "quote_committed",
            near_sdk::serde_json::json!({"quote":quote}),
        );
    }
    pub fn request_payment(&mut self, po_id: String) -> PromiseOrValue<Payment> {
        self.requester();
        let order = self.orders.get(&po_id).expect("unknown PO").clone();
        require!(
            order.destination == Destination::Near,
            "same-chain PO required"
        );
        let current = self.payments.get(&po_id).unwrap().clone();
        if current.status != Status::Committed {
            return PromiseOrValue::Value(current);
        }
        if let Some(reason) = self.hard_block(&order) {
            return PromiseOrValue::Value(self.record(&po_id, Status::Blocked, reason));
        }
        if order.amount.0 > self.policy.auto_per_po_limit.0 {
            return PromiseOrValue::Value(self.record(
                &po_id,
                Status::PendingApproval,
                Reason::AutoThreshold,
            ));
        }
        if !self.daily_capacity(order.amount.0) {
            return PromiseOrValue::Value(self.record(
                &po_id,
                Status::PendingApproval,
                Reason::DailyCapacity,
            ));
        }
        self.dispatch_near(po_id, order)
    }
    pub fn request_crosschain(&mut self, po_id: String, attempt_id: String) -> Payment {
        self.requester();
        let order = self.orders.get(&po_id).expect("unknown PO").clone();
        let quote = self.quotes.get(&attempt_id).expect("unknown quote").clone();
        require!(quote.po_id == po_id, "quote PO mismatch");
        let old = self.payments.get(&po_id).unwrap().clone();
        if old.attempt_id == attempt_id && old.status != Status::Committed {
            return old;
        }
        require!(
            matches!(
                old.status,
                Status::Committed | Status::Expired | Status::Failed
            ),
            "PO cannot be requested again"
        );
        if let Some(reason) = self.hard_block(&order) {
            return self.record(&po_id, Status::Blocked, reason);
        }
        let before = env::storage_usage();
        let mut payment = old;
        payment.attempt_id = attempt_id;
        payment.status = Status::PendingApproval;
        payment.reason = Reason::None;
        self.payments.insert(po_id.clone(), payment);
        self.payments.flush();
        self.storage_delta(before);
        if let Some(reason) = self.quote_block(&order, &quote) {
            return self.record(
                &po_id,
                if reason == Reason::Expired {
                    Status::Expired
                } else {
                    Status::Blocked
                },
                reason,
            );
        }
        self.record(&po_id, Status::PendingApproval, Reason::None)
    }
    #[payable]
    pub fn approve_payment(
        &mut self,
        po_id: String,
        expected_quote_hash: Option<String>,
        expected_commitment_hash: Option<String>,
    ) -> PromiseOrValue<Payment> {
        self.admin();
        let order = self.orders.get(&po_id).expect("unknown PO").clone();
        let payment = self.payments.get(&po_id).expect("unknown payment").clone();
        require!(
            payment.status == Status::PendingApproval,
            "not pending approval"
        );
        let reviewed_quote = match &order.destination {
            Destination::Near => {
                require!(
                    expected_quote_hash.is_none() && expected_commitment_hash.is_none(),
                    "same-chain quote must be absent"
                );
                None
            }
            Destination::Base { .. } => {
                let quote = self
                    .quotes
                    .get(&payment.attempt_id)
                    .expect("quote missing")
                    .clone();
                require!(
                    expected_quote_hash.as_ref() == Some(&quote.signed_quote_hash),
                    "reviewed quote hash changed"
                );
                require!(
                    expected_commitment_hash.as_ref() == Some(&quote.commitment_hash()),
                    "reviewed attempt or commitment changed"
                );
                Some(quote)
            }
        };
        if let Some(reason) = self.hard_block(&order) {
            return PromiseOrValue::Value(self.record(&po_id, Status::Blocked, reason));
        }
        if !self.daily_capacity(order.amount.0) {
            return PromiseOrValue::Value(self.record(
                &po_id,
                Status::PendingApproval,
                Reason::DailyCapacity,
            ));
        }
        match &order.destination {
            Destination::Near => {
                event(
                    "payment_approved",
                    near_sdk::serde_json::json!({"po_id":po_id,"by":self.admin,"attempt_id":payment.attempt_id}),
                );
                self.dispatch_near(po_id, order)
            }
            Destination::Base { .. } => {
                let quote = reviewed_quote.expect("reviewed quote missing");
                if let Some(reason) = self.quote_block(&order, &quote) {
                    return PromiseOrValue::Value(self.record(
                        &po_id,
                        if reason == Reason::Expired {
                            Status::Expired
                        } else {
                            Status::Blocked
                        },
                        reason,
                    ));
                }
                let native_required = quote
                    .storage_deposit_yocto
                    .0
                    .checked_add(1)
                    .expect("native budget overflow");
                let staked = u128::from(env::storage_usage())
                    .checked_mul(env::storage_byte_cost().as_yoctonear())
                    .expect("storage cost overflow");
                require!(
                    env::account_balance()
                        .as_yoctonear()
                        .saturating_sub(staked)
                        .saturating_sub(self.storage_reserve)
                        >= native_required,
                    "insufficient unreserved native registration budget"
                );
                self.reserve(&po_id, order.amount.0);
                event(
                    "payment_approved",
                    near_sdk::serde_json::json!({"po_id":po_id,"by":self.admin,"attempt_id":payment.attempt_id,"quote_hash":quote.signed_quote_hash,"commitment_hash":quote.commitment_hash()}),
                );
                self.record(&po_id, Status::Registering, Reason::None);
                PromiseOrValue::Promise(
                    ext_ft::ext(self.token.clone())
                        .with_attached_deposit(NearToken::from_yoctonear(
                            quote.storage_deposit_yocto.0,
                        ))
                        .with_static_gas(Gas::from_tgas(10))
                        .storage_deposit(Some(quote.deposit_account), Some(true))
                        .then(
                            Self::ext(env::current_account_id())
                                .with_static_gas(Gas::from_tgas(65))
                                .on_registered(po_id),
                        ),
                )
            }
        }
    }
    #[payable]
    pub fn reject_payment(&mut self, po_id: String) -> Payment {
        self.admin();
        require!(
            self.payments.get(&po_id).expect("unknown payment").status == Status::PendingApproval,
            "not pending approval"
        );
        self.record(&po_id, Status::Rejected, Reason::HumanRejected)
    }
    #[private]
    pub fn on_registered(
        &mut self,
        po_id: String,
        #[callback_result] result: Result<StorageBalance, PromiseError>,
    ) -> PromiseOrValue<Payment> {
        self.private_callback();
        let current = self.payments.get(&po_id).expect("unknown payment").clone();
        if current.status != Status::Registering {
            return PromiseOrValue::Value(current);
        }
        let order = self.orders.get(&po_id).unwrap().clone();
        let quote = self.quotes.get(&current.attempt_id).unwrap().clone();
        let block = if result.is_err() {
            Some(Reason::RegistrationFailed)
        } else if self.paused {
            Some(Reason::Paused)
        } else if !self.suppliers.contains(&order.supplier) {
            Some(Reason::UnknownSupplier)
        } else if order.amount.0 > self.policy.hard_payout_limit.0 {
            Some(Reason::OverHardLimit)
        } else {
            self.quote_block(&order, &quote)
        };
        if let Some(reason) = block {
            self.release_payment(&po_id, order.amount.0, false);
            return PromiseOrValue::Value(self.record(
                &po_id,
                if reason == Reason::Expired {
                    Status::Expired
                } else {
                    Status::Failed
                },
                reason,
            ));
        }
        // Policy may have been lowered while registration was in flight. Include this request's
        // original-day reservation, not a fresh current-day budget, in the final dispatch check.
        let usage = self.days.get(&current.reserved_day).unwrap();
        if usage
            .spent
            .0
            .checked_add(usage.reserved.0)
            .is_none_or(|n| n > self.policy.daily_dispatch_limit.0)
        {
            self.release_payment(&po_id, order.amount.0, false);
            return PromiseOrValue::Value(self.record(
                &po_id,
                Status::Failed,
                Reason::DailyCapacity,
            ));
        }
        self.record(&po_id, Status::Dispatching, Reason::None);
        PromiseOrValue::Promise(self.transfer(po_id, quote.deposit_account, order.amount))
    }
    #[private]
    pub fn on_payment(
        &mut self,
        po_id: String,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> Payment {
        self.private_callback();
        let old = self.payments.get(&po_id).expect("unknown payment").clone();
        if old.status != Status::Dispatching {
            return old;
        }
        let order = self.orders.get(&po_id).unwrap().clone();
        let success = result.is_ok();
        self.release_payment(&po_id, order.amount.0, success);
        self.record(
            &po_id,
            if success {
                if order.destination == Destination::Near {
                    Status::Paid
                } else {
                    Status::Dispatched
                }
            } else {
                Status::Failed
            },
            if success {
                Reason::None
            } else {
                Reason::TransferFailed
            },
        )
    }
    #[payable]
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        self.admin();
        self.withdraw_to_treasury(amount.0)
    }
    #[payable]
    pub fn withdraw_all(&mut self) -> PromiseOrValue<U64> {
        self.admin();
        self.paused = true;
        event(
            "paused",
            near_sdk::serde_json::json!({"by":self.admin,"emergency":true}),
        );
        let amount = self.spendable();
        if amount == 0 {
            return PromiseOrValue::Value(U64(self.next_withdrawal));
        }
        PromiseOrValue::Promise(self.withdraw_to_treasury(amount))
    }
    #[private]
    pub fn on_withdrawal(
        &mut self,
        id: U64,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> Withdrawal {
        self.private_callback();
        let mut withdrawal = self
            .withdrawals
            .get(&id.0)
            .expect("unknown withdrawal")
            .clone();
        if withdrawal.status != Status::Dispatching {
            return withdrawal;
        }
        self.withdrawal_reserved = self
            .withdrawal_reserved
            .checked_sub(withdrawal.amount.0)
            .expect("withdrawal reservation underflow");
        if result.is_ok() {
            self.accounted = self
                .accounted
                .checked_sub(withdrawal.amount.0)
                .expect("accounted underflow");
            withdrawal.status = Status::Paid;
        } else {
            withdrawal.status = Status::Failed;
        }
        self.withdrawals.insert(id.0, withdrawal.clone());
        event(
            "withdrawal_resolved",
            near_sdk::serde_json::json!({"id":id,"withdrawal":withdrawal}),
        );
        withdrawal
    }
    pub fn get_state(&self) -> State {
        State {
            profile: self.profile.clone(),
            admin: self.admin.clone(),
            pending_admin: self.pending_admin.clone(),
            guardian: self.guardian.clone(),
            treasury: self.treasury.clone(),
            token: self.token.clone(),
            paused: self.paused,
            policy: self.policy.clone(),
            accounted_balance: U128(self.accounted),
            reserved_payment: U128(self.payment_reserved),
            reserved_withdrawal: U128(self.withdrawal_reserved),
            spendable: U128(self.spendable()),
            storage_reserve: U128(self.storage_reserve),
            day: U64(day()),
            usage: self.days.get(&day()).cloned().unwrap_or_default(),
        }
    }
    pub fn get_purchase_order(&self, po_id: String) -> Option<PurchaseOrder> {
        valid_id(&po_id);
        self.orders.get(&po_id).cloned()
    }
    pub fn get_payment(&self, po_id: String) -> Option<Payment> {
        valid_id(&po_id);
        self.payments.get(&po_id).cloned()
    }
    pub fn get_quote(&self, attempt_id: String) -> Option<QuoteCommitment> {
        valid_id(&attempt_id);
        self.quotes.get(&attempt_id).cloned()
    }
    pub fn get_quote_commitment_hash(&self, attempt_id: String) -> Option<String> {
        valid_id(&attempt_id);
        self.quotes
            .get(&attempt_id)
            .map(QuoteCommitment::commitment_hash)
    }
    pub fn get_route(&self, route_id: String) -> Option<Route> {
        valid_id(&route_id);
        self.routes.get(&route_id).cloned()
    }
    pub fn get_route_hash(&self, route_id: String) -> Option<String> {
        valid_id(&route_id);
        self.routes.get(&route_id).map(Route::commitment_hash)
    }
    pub fn get_withdrawal(&self, id: U64) -> Option<Withdrawal> {
        self.withdrawals.get(&id.0).cloned()
    }
    pub fn get_day_usage(&self, utc_day: U64) -> DayUsage {
        self.days.get(&utc_day.0).cloned().unwrap_or_default()
    }
    pub fn get_roles(&self, account: AccountId) -> RoleMembership {
        RoleMembership {
            committer: self.committers.contains(&account),
            requester: self.requesters.contains(&account),
            supplier: self.suppliers.contains(&account),
        }
    }
    pub fn get_payments(&self, po_ids: Vec<String>) -> Vec<Option<Payment>> {
        require!(po_ids.len() <= 50, "at most 50 PO lookups");
        po_ids
            .into_iter()
            .map(|po_id| self.get_payment(po_id))
            .collect()
    }
}
impl Contract {
    fn private_callback(&self) {
        require!(
            env::predecessor_account_id() == env::current_account_id()
                && env::attached_deposit().is_zero(),
            "private zero-deposit callback required"
        );
    }
    fn independent_human(&self, account: &AccountId) {
        require!(
            account != &self.treasury
                && account != &self.token
                && account != &env::current_account_id()
                && !self.committers.contains(account)
                && !self.requesters.contains(account),
            "independent human account required"
        );
    }
    fn admin(&self) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.admin, "only admin");
    }
    fn committer(&self) {
        require!(
            env::attached_deposit().is_zero()
                && self.committers.contains(&env::predecessor_account_id()),
            "only zero-deposit committer"
        );
    }
    fn requester(&self) {
        require!(
            env::attached_deposit().is_zero()
                && self.requesters.contains(&env::predecessor_account_id()),
            "only zero-deposit requester"
        );
    }
    fn spendable(&self) -> u128 {
        self.accounted
            .checked_sub(self.payment_reserved)
            .and_then(|n| n.checked_sub(self.withdrawal_reserved))
            .expect("accounted reservation underflow")
    }
    fn storage_delta(&mut self, before: u64) {
        self.charge_storage_delta(before, env::storage_usage());
    }
    fn charge_storage_delta(&mut self, before: u64, after: u64) {
        let amount = u128::from(after.abs_diff(before))
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .expect("storage delta overflow");
        if after > before {
            require!(self.storage_reserve >= amount, "prefund storage reserve");
            self.storage_reserve -= amount;
        } else {
            self.storage_reserve = self
                .storage_reserve
                .checked_add(amount)
                .expect("storage reserve overflow");
        }
    }
    fn hard_block(&self, order: &PurchaseOrder) -> Option<Reason> {
        if self.paused {
            Some(Reason::Paused)
        } else if !self.suppliers.contains(&order.supplier) {
            Some(Reason::UnknownSupplier)
        } else if order.amount.0 > self.policy.hard_payout_limit.0 {
            Some(Reason::OverHardLimit)
        } else if order.amount.0 > self.spendable() {
            Some(Reason::InsufficientFunds)
        } else {
            None
        }
    }
    fn quote_block(&self, order: &PurchaseOrder, quote: &QuoteCommitment) -> Option<Reason> {
        if quote.deadline_ns.0 <= env::block_timestamp() {
            return Some(Reason::Expired);
        }
        match &order.destination {
            Destination::Base {
                route_id,
                version,
                route_hash,
            } => match self.routes.get(route_id) {
                Some(route)
                    if route.active
                        && route.version == *version
                        && route.version == quote.route_version
                        && route.route_id == quote.route_id
                        && route.supplier == order.supplier
                        && route.commitment_hash() == *route_hash =>
                {
                    None
                }
                _ => Some(Reason::InvalidRoute),
            },
            Destination::Near => Some(Reason::InvalidRoute),
        }
    }
    fn daily_capacity(&self, amount: u128) -> bool {
        let used = self.days.get(&day()).cloned().unwrap_or_default();
        used.spent
            .0
            .checked_add(used.reserved.0)
            .and_then(|n| n.checked_add(amount))
            .is_some_and(|n| n <= self.policy.daily_dispatch_limit.0)
    }
    fn reserve(&mut self, po: &str, amount: u128) {
        require!(
            amount <= self.spendable() && self.daily_capacity(amount),
            "insufficient balance or daily capacity"
        );
        let before = env::storage_usage();
        let mut used = self.days.get(&day()).cloned().unwrap_or_default();
        used.reserved = U128(
            used.reserved
                .0
                .checked_add(amount)
                .expect("daily reserve overflow"),
        );
        self.days.insert(day(), used);
        self.days.flush();
        self.storage_delta(before);
        self.payment_reserved = self
            .payment_reserved
            .checked_add(amount)
            .expect("payment reserve overflow");
        let mut p = self.payments.get(&po.to_string()).unwrap().clone();
        p.reserved_day = day();
        self.payments.insert(po.into(), p);
    }
    fn release_payment(&mut self, po: &str, amount: u128, success: bool) {
        let d = self.payments.get(&po.to_string()).unwrap().reserved_day;
        let mut usage = self.days.get(&d).unwrap().clone();
        usage.reserved = U128(
            usage
                .reserved
                .0
                .checked_sub(amount)
                .expect("day reservation underflow"),
        );
        self.payment_reserved = self
            .payment_reserved
            .checked_sub(amount)
            .expect("payment reservation underflow");
        if success {
            usage.spent = U128(
                usage
                    .spent
                    .0
                    .checked_add(amount)
                    .expect("daily spent overflow"),
            );
            self.accounted = self
                .accounted
                .checked_sub(amount)
                .expect("accounted underflow");
        }
        self.days.insert(d, usage);
    }
    fn record(&mut self, po: &str, status: Status, reason: Reason) -> Payment {
        let mut p = self.payments.get(&po.to_string()).unwrap().clone();
        p.status = status;
        p.reason = reason;
        self.payments.insert(po.into(), p.clone());
        event(
            "payment_state",
            near_sdk::serde_json::json!({"po_id":po,"payment":p}),
        );
        let semantic = match &p.status {
            Status::PendingApproval => "payment_pending",
            Status::Registering => "registration_started",
            Status::Dispatching => "payment_dispatching",
            Status::Paid | Status::Dispatched => "payment_dispatched",
            Status::Failed => "payment_failed",
            Status::Blocked => "payment_blocked",
            Status::Expired => "payment_expired",
            Status::Rejected => "payment_rejected",
            Status::Committed => "payment_committed",
        };
        let order = self.orders.get(&po.to_string()).expect("unknown PO");
        event(
            semantic,
            near_sdk::serde_json::json!({"po_id":po,"payment":p,
            "token":order.token,"amount":order.amount,"supplier":order.supplier}),
        );
        p
    }
    fn transfer(&self, po_id: String, receiver: AccountId, amount: U128) -> Promise {
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(15))
            .ft_transfer(receiver, amount, Some(po_id.clone()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(20))
                    .on_payment(po_id),
            )
    }
    fn dispatch_near(&mut self, po_id: String, order: PurchaseOrder) -> PromiseOrValue<Payment> {
        self.reserve(&po_id, order.amount.0);
        self.record(&po_id, Status::Dispatching, Reason::None);
        PromiseOrValue::Promise(self.transfer(po_id, order.supplier, order.amount))
    }
    fn withdraw_to_treasury(&mut self, amount: u128) -> Promise {
        require!(
            amount > 0 && amount <= self.spendable(),
            "withdraw only unreserved accounted funds"
        );
        let id = self
            .next_withdrawal
            .checked_add(1)
            .expect("withdrawal id overflow");
        let before = env::storage_usage();
        self.withdrawals.insert(
            id,
            Withdrawal {
                amount: U128(amount),
                status: Status::Dispatching,
            },
        );
        self.withdrawals.flush();
        self.storage_delta(before);
        self.next_withdrawal = id;
        self.withdrawal_reserved = self
            .withdrawal_reserved
            .checked_add(amount)
            .expect("withdrawal reservation overflow");
        event(
            "withdrawal_requested",
            near_sdk::serde_json::json!({"id":U64(id),"amount":U128(amount),"treasury":self.treasury}),
        );
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(15))
            .ft_transfer(
                self.treasury.clone(),
                U128(amount),
                Some(format!("withdrawal-{id}")),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(20))
                    .on_withdrawal(U64(id)),
            )
    }
}
#[near]
impl FungibleTokenReceiver for Contract {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.token
            || sender_id != self.treasury
            || msg != "deposit"
        {
            event(
                "deposit_refund_requested",
                near_sdk::serde_json::json!({
                "token":env::predecessor_account_id(),"sender":sender_id,"unused":amount,"reason":"untrusted_token_sender_or_message"}),
            );
            return PromiseOrValue::Value(amount);
        }
        let accepted = amount.0.min(
            self.policy
                .accepted_deposit_ceiling
                .0
                .saturating_sub(self.accounted),
        );
        self.accounted = self
            .accounted
            .checked_add(accepted)
            .expect("deposit overflow");
        let unused = amount.0 - accepted;
        event(
            "deposit",
            near_sdk::serde_json::json!({"token":self.token,"sender":sender_id,"accepted":U128(accepted),"unused":U128(unused),"accounted_balance":U128(self.accounted)}),
        );
        if unused > 0 {
            event(
                "deposit_refund_requested",
                near_sdk::serde_json::json!({"token":self.token,"sender":sender_id,"unused":U128(unused),"reason":"accepted_ceiling"}),
            );
        }
        PromiseOrValue::Value(U128(unused))
    }
}
fn day() -> u64 {
    env::block_timestamp() / DAY
}
fn valid_id(value: &str) {
    require!(
        !value.is_empty()
            && value.len() <= 64
            && value
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'),
        "invalid identifier"
    );
}
fn valid_hash(value: &str) {
    require!(
        value.len() == 64
            && value
                .bytes()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
        "invalid digest"
    );
}
fn event(name: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({"standard":"carecart_safety_vault","version":"1.0.0","event":name,"data":[data]})
    ));
}
