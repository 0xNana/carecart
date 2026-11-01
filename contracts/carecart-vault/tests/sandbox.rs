use std::path::PathBuf;
use std::sync::Arc;

use carecart_vault::{PaymentRecord, PaymentState};
use near_api::{Account, AccountId, NearGas, NearToken, NetworkConfig, Signer};
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;

async fn create_account(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
) -> testresult::TestResult<Account> {
    let account_id: AccountId = name.parse().unwrap();
    sandbox
        .create_account(account_id.clone())
        .initial_balance(NearToken::from_near(20))
        .send()
        .await?;
    Ok(Account(account_id))
}

fn build_wasm(manifest_path: PathBuf) -> testresult::TestResult<Vec<u8>> {
    let manifest_path = cargo_near_build::camino::Utf8PathBuf::from_path_buf(manifest_path)
        .map_err(|path| format!("contract path is not UTF-8: {path:?}"))?;
    let build_options = cargo_near_build::BuildOpts::builder()
        .manifest_path(manifest_path)
        .build();
    let wasm_path = cargo_near_build::build_with_cli(build_options)?;
    Ok(std::fs::read(wasm_path)?)
}

async fn call(
    contract: &near_api::Contract,
    signer_id: &AccountId,
    signer: &Arc<Signer>,
    network: &NetworkConfig,
    method: &str,
    args: near_sdk::serde_json::Value,
    deposit: NearToken,
) -> testresult::TestResult<()> {
    contract
        .call_function(method, args)
        .transaction()
        .deposit(deposit)
        .gas(NearGas::from_tgas(120))
        .with_signer(signer_id.clone(), signer.clone())
        .send_to(network)
        .await?
        .assert_success();
    Ok(())
}

async fn payment_state(
    vault: &near_api::Contract,
    network: &NetworkConfig,
    po_id: &str,
) -> testresult::TestResult<PaymentRecord> {
    Ok(vault
        .call_function("get_payment_state", json!({ "request_id": po_id }))
        .read_only()
        .fetch_from(network)
        .await?
        .data)
}

async fn token_balance(
    token: &near_api::Contract,
    network: &NetworkConfig,
    account_id: &AccountId,
) -> testresult::TestResult<U128> {
    Ok(token
        .call_function("ft_balance_of", json!({ "account_id": account_id }))
        .read_only()
        .fetch_from(network)
        .await?
        .data)
}

async fn commit_po(
    vault: &near_api::Contract,
    signer: &Arc<Signer>,
    network: &NetworkConfig,
    committer: &Account,
    supplier_id: &AccountId,
    po_id: &str,
    amount: u128,
) -> testresult::TestResult<()> {
    call(
        vault,
        committer.account_id(),
        signer,
        network,
        "commit_purchase_order",
        json!({
            "po_id": po_id,
            "supplier_id": supplier_id,
            "token_id": "token.sandbox",
            "amount": amount.to_string(),
        }),
        NearToken::from_near(1),
    )
    .await
}

#[tokio::test]
async fn test_vault_payment_lifecycle_with_test_only_ft() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY
            .parse()
            .unwrap(),
    )?;

    let admin = create_account(&sandbox, "admin.sandbox").await?;
    let committer = create_account(&sandbox, "procurement.sandbox").await?;
    let requester = create_account(&sandbox, "agent.sandbox").await?;
    let supplier = create_account(&sandbox, "supplier.sandbox").await?;
    let vault_account = create_account(&sandbox, "vault.sandbox").await?;
    let token_account = create_account(&sandbox, "token.sandbox").await?;
    let vault = vault_account.as_contract();
    let token = token_account.as_contract();

    let repository_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let vault_wasm = build_wasm(repository_root.join("Cargo.toml"))?;
    let test_ft_wasm = build_wasm(repository_root.join("../test-ft/Cargo.toml"))?;

    near_api::Contract::deploy(token.account_id().clone())
        .use_code(test_ft_wasm)
        .with_init_call(
            "new",
            json!({
                "owner_id": admin.account_id(),
                "total_supply": "1000000",
            }),
        )?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    near_api::Contract::deploy(vault.account_id().clone())
        .use_code(vault_wasm)
        .with_init_call(
            "new",
            json!({
                "admin": admin.account_id(),
                "policy": {
                    "token_id": token.account_id(),
                    "per_order_cap": "100",
                    "daily_cap": "10000",
                    "balance_cap": "500",
                }
            }),
        )?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    for account_id in [vault.account_id(), supplier.account_id()] {
        call(
            &token,
            admin.account_id(),
            &signer,
            &network,
            "storage_deposit",
            json!({ "account_id": account_id, "registration_only": true }),
            NearToken::from_near(1),
        )
        .await?;
    }

    call(
        &token,
        admin.account_id(),
        &signer,
        &network,
        "ft_transfer",
        json!({
            "receiver_id": vault.account_id(),
            "amount": "1000",
            "memo": "local Sandbox funding",
        }),
        NearToken::from_yoctonear(1),
    )
    .await?;
    assert_eq!(
        token_balance(&token, &network, vault.account_id()).await?.0,
        1_000
    );

    for (method, args) in [
        (
            "set_supplier_allowed",
            json!({ "supplier_id": supplier.account_id(), "allowed": true }),
        ),
        (
            "set_po_committer",
            json!({ "committer": committer.account_id(), "allowed": true }),
        ),
        (
            "set_payment_requester",
            json!({ "requester": requester.account_id(), "allowed": true }),
        ),
    ] {
        call(
            &vault,
            admin.account_id(),
            &signer,
            &network,
            method,
            args,
            NearToken::from_near(1),
        )
        .await?;
    }

    commit_po(
        &vault,
        &signer,
        &network,
        &committer,
        supplier.account_id(),
        "po-success",
        40,
    )
    .await?;
    call(
        &vault,
        requester.account_id(),
        &signer,
        &network,
        "request_payment",
        json!({ "po_id": "po-success" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert_eq!(
        payment_state(&vault, &network, "po-success").await?.state,
        PaymentState::Paid
    );
    assert_eq!(
        token_balance(&token, &network, supplier.account_id())
            .await?
            .0,
        40
    );

    // A duplicate request is idempotent and cannot send the same PO twice.
    call(
        &vault,
        requester.account_id(),
        &signer,
        &network,
        "request_payment",
        json!({ "po_id": "po-success" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert_eq!(
        token_balance(&token, &network, supplier.account_id())
            .await?
            .0,
        40
    );

    commit_po(
        &vault,
        &signer,
        &network,
        &committer,
        supplier.account_id(),
        "po-pending",
        120,
    )
    .await?;
    call(
        &vault,
        requester.account_id(),
        &signer,
        &network,
        "request_payment",
        json!({ "po_id": "po-pending" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert_eq!(
        payment_state(&vault, &network, "po-pending").await?.state,
        PaymentState::PendingApproval
    );
    assert_eq!(
        token_balance(&token, &network, supplier.account_id())
            .await?
            .0,
        40
    );
    call(
        &vault,
        admin.account_id(),
        &signer,
        &network,
        "approve_payment",
        json!({ "po_id": "po-pending" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    assert_eq!(
        payment_state(&vault, &network, "po-pending").await?.state,
        PaymentState::Paid
    );
    assert_eq!(
        token_balance(&token, &network, supplier.account_id())
            .await?
            .0,
        160
    );

    commit_po(
        &vault,
        &signer,
        &network,
        &committer,
        supplier.account_id(),
        "po-blocked",
        10,
    )
    .await?;
    call(
        &vault,
        admin.account_id(),
        &signer,
        &network,
        "set_supplier_allowed",
        json!({ "supplier_id": supplier.account_id(), "allowed": false }),
        NearToken::from_near(1),
    )
    .await?;
    call(
        &vault,
        requester.account_id(),
        &signer,
        &network,
        "request_payment",
        json!({ "po_id": "po-blocked" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    let blocked = payment_state(&vault, &network, "po-blocked").await?;
    assert_eq!(blocked.state, PaymentState::Blocked);
    assert_eq!(
        blocked.reason,
        Some(carecart_vault::BlockReason::SupplierNotAllowed)
    );

    call(
        &vault,
        admin.account_id(),
        &signer,
        &network,
        "set_supplier_allowed",
        json!({ "supplier_id": supplier.account_id(), "allowed": true }),
        NearToken::from_near(1),
    )
    .await?;
    commit_po(
        &vault,
        &signer,
        &network,
        &committer,
        supplier.account_id(),
        "po-insufficient",
        1_000,
    )
    .await?;
    call(
        &vault,
        requester.account_id(),
        &signer,
        &network,
        "request_payment",
        json!({ "po_id": "po-insufficient" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    let insufficient = payment_state(&vault, &network, "po-insufficient").await?;
    assert_eq!(insufficient.state, PaymentState::Blocked);
    assert_eq!(
        insufficient.reason,
        Some(carecart_vault::BlockReason::InsufficientFunds)
    );

    commit_po(
        &vault,
        &signer,
        &network,
        &committer,
        supplier.account_id(),
        "po-failed-transfer",
        20,
    )
    .await?;
    call(
        &token,
        admin.account_id(),
        &signer,
        &network,
        "set_transfers_paused",
        json!({ "paused": true }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    call(
        &vault,
        requester.account_id(),
        &signer,
        &network,
        "request_payment",
        json!({ "po_id": "po-failed-transfer" }),
        NearToken::from_yoctonear(0),
    )
    .await?;
    let failed = payment_state(&vault, &network, "po-failed-transfer").await?;
    assert_eq!(failed.state, PaymentState::Failed);
    assert_eq!(
        failed.reason,
        Some(carecart_vault::BlockReason::TransferFailed)
    );

    // A callback method is not callable by an external account.
    vault
        .call_function("on_transfer_result", json!({ "po_id": "po-success" }))
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(requester.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();

    Ok(())
}
