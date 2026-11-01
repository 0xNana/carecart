use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::store::LazyOption;
use near_sdk::{AccountId, NearToken, PanicOnDefault, PromiseOrValue, env, near, require};

/// Test-only NEP-141 token. It has no mainnet deployment or production configuration.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestFt {
    owner_id: AccountId,
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    transfers_paused: bool,
}

#[near]
impl TestFt {
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128) -> Self {
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "CareCart Local Test Token".to_string(),
            symbol: "CCTEST".to_string(),
            icon: None,
            reference: None,
            reference_hash: None::<Base64VecU8>,
            decimals: 0,
        };
        metadata.assert_valid();

        let mut contract = Self {
            owner_id: owner_id.clone(),
            token: FungibleToken::new(&b"carecart-test-ft:accounts"[..]),
            metadata: LazyOption::new(&b"carecart-test-ft:metadata"[..], Some(metadata)),
            transfers_paused: false,
        };
        contract.token.internal_register_account(&owner_id);
        contract.token.internal_deposit(&owner_id, total_supply.0);
        FtMint {
            owner_id: &owner_id,
            amount: total_supply,
            memo: Some("test-only initial supply"),
        }
        .emit();
        contract
    }

    /// Failure switch used only by Sandbox tests to exercise the vault callback.
    pub fn set_transfers_paused(&mut self, paused: bool) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "only the test token owner can change transfer behavior"
        );
        self.transfers_paused = paused;
    }
}

#[near]
impl FungibleTokenCore for TestFt {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(
            !self.transfers_paused,
            "test token transfer failure enabled"
        );
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            !self.transfers_paused,
            "test token transfer failure enabled"
        );
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for TestFt {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, _) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used_amount.into()
    }
}

#[near]
impl StorageManagement for TestFt {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for TestFt {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata
            .get()
            .as_ref()
            .cloned()
            .unwrap_or_else(|| env::panic_str("test token metadata missing"))
    }
}
