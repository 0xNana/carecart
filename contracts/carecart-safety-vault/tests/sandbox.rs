use std::path::PathBuf;
use std::sync::Arc;

use carecart_safety_vault::{Payment, Policy, Status};
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

async fn view<T: near_sdk::serde::de::DeserializeOwned + Send + Sync>(
    c: &near_api::Contract,
    n: &NetworkConfig,
    method: &str,
    args: near_sdk::serde_json::Value,
) -> testresult::TestResult<T> {
    Ok(c.call_function(method, args)
        .read_only()
        .fetch_from(n)
        .await?
        .data)
}
#[tokio::test]
async fn safety_vault_real_receipts() -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let n = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY
            .parse()
            .unwrap(),
    )?;
    let mut accounts = Vec::new();
    for name in [
        "admin.testnet",
        "guardian.testnet",
        "treasury.testnet",
        "committer.testnet",
        "agent.testnet",
        "supplier.testnet",
        "vault.testnet",
        "token.testnet",
    ] {
        accounts.push(create_account(&sandbox, name).await?);
    }
    let [
        admin,
        guardian,
        treasury,
        committer,
        agent,
        supplier,
        vault_account,
        token_account,
    ] = accounts.as_slice()
    else {
        unreachable!()
    };
    let vault = vault_account.as_contract();
    let token = token_account.as_contract();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let vw = build_wasm(root.join("Cargo.toml"))?;
    let tw = build_wasm(root.join("../test-ft/Cargo.toml"))?;
    near_api::Contract::deploy(token.account_id().clone())
        .use_code(tw)
        .with_init_call(
            "new_test_usdc",
            json!({"owner_id":treasury.account_id(),"total_supply":"1000000000"}),
        )?
        .with_signer(signer.clone())
        .send_to(&n)
        .await?
        .assert_success();
    near_api::Contract::deploy(vault.account_id().clone()).use_code(vw).with_init_call("new",json!({"admin":admin.account_id(),"guardian":guardian.account_id(),"treasury":treasury.account_id(),"token":token.account_id(),"policy":Policy::initial()}))?.with_signer(signer.clone()).send_to(&n).await?.assert_success();
    let one = NearToken::from_yoctonear(1);
    let zero = NearToken::from_yoctonear(0);
    for a in [vault.account_id(), supplier.account_id()] {
        call(
            &token,
            treasury.account_id(),
            &signer,
            &n,
            "storage_deposit",
            json!({"account_id":a,"registration_only":true}),
            NearToken::from_near(1),
        )
        .await?;
    }
    call(
        &vault,
        admin.account_id(),
        &signer,
        &n,
        "fund_storage",
        json!({}),
        NearToken::from_near(1),
    )
    .await?;
    for (method, args) in [
        (
            "set_supplier",
            json!({"supplier":supplier.account_id(),"allowed":true}),
        ),
        (
            "set_role",
            json!({"account":committer.account_id(),"role":"committer","allowed":true}),
        ),
        (
            "set_role",
            json!({"account":agent.account_id(),"role":"requester","allowed":true}),
        ),
        ("unpause", json!({})),
    ] {
        call(&vault, admin.account_id(), &signer, &n, method, args, one).await?;
    }
    // Authenticated deposit accepts exactly the initial 5 USDC ceiling and refunds 1.
    call(
        &token,
        treasury.account_id(),
        &signer,
        &n,
        "ft_transfer_call",
        json!({"receiver_id":vault.account_id(),"amount":"6000000","msg":"deposit"}),
        one,
    )
    .await?;
    let balance = |account: &AccountId| json!({"account_id":account});
    assert_eq!(
        view::<U128>(&token, &n, "ft_balance_of", balance(vault.account_id()))
            .await?
            .0,
        5_000_000
    );
    assert_eq!(
        view::<U128>(&token, &n, "ft_balance_of", balance(treasury.account_id()))
            .await?
            .0,
        995_000_000
    );
    // A forced plain transfer does not increase accounted/spendable funds.
    call(
        &token,
        treasury.account_id(),
        &signer,
        &n,
        "ft_transfer",
        json!({"receiver_id":vault.account_id(),"amount":"1000000"}),
        one,
    )
    .await?;
    let state: near_sdk::serde_json::Value = view(&vault, &n, "get_state", json!({})).await?;
    assert_eq!(state["accounted_balance"], "5000000");
    call(&vault,committer.account_id(),&signer,&n,"commit_purchase_order",json!({"order":{"po_id":"paid","profile":"testnet","supplier":supplier.account_id(),"token":token.account_id(),"amount":"1000000","invoice_digest":"a".repeat(64),"destination":"Near"}}),zero).await?;
    for _ in 0..2 {
        call(
            &vault,
            agent.account_id(),
            &signer,
            &n,
            "request_payment",
            json!({"po_id":"paid"}),
            zero,
        )
        .await?;
    }
    assert_eq!(
        view::<Payment>(&vault, &n, "get_payment", json!({"po_id":"paid"}))
            .await?
            .status,
        Status::Paid
    );
    assert_eq!(
        view::<U128>(&token, &n, "ft_balance_of", balance(supplier.account_id()))
            .await?
            .0,
        1_000_000
    );
    // Wasm entrypoint privacy and one-yocto checks, not only direct Rust calls.
    for (method, args, who, deposit) in [
        ("on_payment", json!({"po_id":"paid"}), agent, zero),
        ("unpause", json!({}), guardian, one),
        (
            "set_policy",
            json!({"policy":Policy::initial()}),
            admin,
            zero,
        ),
        ("withdraw_all", json!({}), agent, one),
    ] {
        vault
            .call_function(method, args)
            .transaction()
            .deposit(deposit)
            .gas(NearGas::from_tgas(100))
            .with_signer(who.account_id().clone(), signer.clone())
            .send_to(&n)
            .await?
            .assert_failure();
    }
    call(
        &vault,
        guardian.account_id(),
        &signer,
        &n,
        "pause",
        json!({}),
        one,
    )
    .await?;
    call(
        &vault,
        admin.account_id(),
        &signer,
        &n,
        "withdraw_all",
        json!({}),
        one,
    )
    .await?;
    let state: near_sdk::serde_json::Value = view(&vault, &n, "get_state", json!({})).await?;
    assert_eq!(state["accounted_balance"], "0");
    assert_eq!(state["reserved_withdrawal"], "0");
    assert_eq!(state["paused"], true);
    assert_eq!(
        view::<U128>(&token, &n, "ft_balance_of", balance(vault.account_id()))
            .await?
            .0,
        1_000_000
    );
    assert_eq!(
        view::<U128>(&token, &n, "ft_balance_of", balance(treasury.account_id()))
            .await?
            .0,
        998_000_000
    );
    // Local Base mock: real FT registration and transfer, without an external settlement.
    call(
        &vault,
        admin.account_id(),
        &signer,
        &n,
        "unpause",
        json!({}),
        one,
    )
    .await?;
    call(
        &token,
        treasury.account_id(),
        &signer,
        &n,
        "ft_transfer_call",
        json!({"receiver_id":vault.account_id(),"amount":"5000000","msg":"deposit"}),
        one,
    )
    .await?;
    let implicit = "b".repeat(64);
    call(&vault,admin.account_id(),&signer,&n,"set_route",json!({"route":{"route_id":"base-route","version":1,"supplier":supplier.account_id(),"recipient":format!("0x{}","a".repeat(40)),"asset_id":"nep141:base-fixture.omft.near","active":true}}),one).await?;
    let route_hash: String = view(
        &vault,
        &n,
        "get_route_hash",
        json!({"route_id":"base-route"}),
    )
    .await?;
    call(&vault,committer.account_id(),&signer,&n,"commit_purchase_order",json!({"order":{"po_id":"base","profile":"testnet","supplier":supplier.account_id(),"token":token.account_id(),"amount":"1000000","invoice_digest":"c".repeat(64),"destination":{"Base":{"route_id":"base-route","version":1,"route_hash":route_hash}}}}),zero).await?;
    let deadline = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_nanos()
        + 600_000_000_000;
    call(&vault,committer.account_id(),&signer,&n,"commit_quote",json!({"quote":{"attempt_id":"base-attempt","po_id":"base","route_id":"base-route","route_version":1,"signed_quote_hash":"d".repeat(64),"deposit_account":implicit,"deadline_ns":deadline.to_string(),"min_amount_out":"980000","storage_deposit_yocto":"10000000000000000000000"}}),zero).await?;
    call(
        &vault,
        agent.account_id(),
        &signer,
        &n,
        "request_crosschain",
        json!({"po_id":"base","attempt_id":"base-attempt"}),
        zero,
    )
    .await?;
    assert_eq!(
        view::<Payment>(&vault, &n, "get_payment", json!({"po_id":"base"}))
            .await?
            .status,
        Status::PendingApproval
    );
    let commitment_hash: String = view(
        &vault,
        &n,
        "get_quote_commitment_hash",
        json!({"attempt_id":"base-attempt"}),
    )
    .await?;
    call(
        &vault,
        admin.account_id(),
        &signer,
        &n,
        "approve_payment",
        json!({"po_id":"base","expected_quote_hash":"d".repeat(64),"expected_commitment_hash":commitment_hash}),
        one,
    )
    .await?;
    assert_eq!(
        view::<Payment>(&vault, &n, "get_payment", json!({"po_id":"base"}))
            .await?
            .status,
        Status::Dispatched
    );
    let amount: U128 = view(&token, &n, "ft_balance_of", json!({"account_id":implicit})).await?;
    assert_eq!(amount.0, 1_000_000);
    // Even an admin-owned FC key cannot attach the one yocto required by privileged ABI.
    let restricted = Signer::from_secret_key(near_api::signer::generate_secret_key()?)?;
    admin
        .add_key(
            near_api::types::AccessKeyPermission::FunctionCall(
                near_api::types::transaction::actions::FunctionCallPermission {
                    allowance: Some(NearToken::from_near(1)),
                    receiver_id: vault.account_id().to_string(),
                    method_names: vec!["withdraw_all".to_string()],
                },
            ),
            restricted.get_public_key().await?,
        )
        .with_signer(signer.clone())
        .send_to(&n)
        .await?
        .assert_success();
    assert!(
        vault
            .call_function("withdraw_all", json!({}))
            .transaction()
            .deposit(one)
            .gas(NearGas::from_tgas(100))
            .with_signer(admin.account_id().clone(), restricted.clone())
            .send_to(&n)
            .await
            .is_err()
    );
    vault
        .call_function("withdraw_all", json!({}))
        .transaction()
        .deposit(zero)
        .gas(NearGas::from_tgas(100))
        .with_signer(admin.account_id().clone(), restricted)
        .send_to(&n)
        .await?
        .assert_failure();
    // MN-03 rotation and revocation use only local Sandbox identities.
    let successor = create_account(&sandbox, "successor.testnet").await?;
    let new_guardian = create_account(&sandbox, "new-guardian.testnet").await?;
    let new_committer = create_account(&sandbox, "new-committer.testnet").await?;
    call(
        &vault,
        admin.account_id(),
        &signer,
        &n,
        "pause",
        json!({}),
        one,
    )
    .await?;
    call(&vault, admin.account_id(), &signer, &n, "rotate_role", json!({
        "old_account":committer.account_id(),"new_account":new_committer.account_id(),"role":"committer"
    }), one).await?;
    let old_roles: near_sdk::serde_json::Value = view(
        &vault,
        &n,
        "get_roles",
        json!({"account":committer.account_id()}),
    )
    .await?;
    assert_eq!(old_roles["committer"], false);
    let new_roles: near_sdk::serde_json::Value = view(
        &vault,
        &n,
        "get_roles",
        json!({"account":new_committer.account_id()}),
    )
    .await?;
    assert_eq!(new_roles["committer"], true);
    call(
        &vault,
        admin.account_id(),
        &signer,
        &n,
        "set_guardian",
        json!({"guardian":new_guardian.account_id()}),
        one,
    )
    .await?;
    call(
        &vault,
        admin.account_id(),
        &signer,
        &n,
        "propose_admin",
        json!({"new_admin":successor.account_id()}),
        one,
    )
    .await?;
    call(
        &vault,
        successor.account_id(),
        &signer,
        &n,
        "accept_admin",
        json!({}),
        one,
    )
    .await?;
    for (method, args, who, deposit) in [
        ("pause", json!({}), guardian, one),
        ("withdraw_all", json!({}), admin, one),
        ("on_registered", json!({"po_id":"base"}), agent, zero),
        ("on_withdrawal", json!({"id":"1"}), agent, zero),
        ("pause", json!({}), &new_guardian, zero),
    ] {
        vault
            .call_function(method, args)
            .transaction()
            .deposit(deposit)
            .gas(NearGas::from_tgas(100))
            .with_signer(who.account_id().clone(), signer.clone())
            .send_to(&n)
            .await?
            .assert_failure();
    }
    assert!(
        view::<near_sdk::serde_json::Value>(
            &vault,
            &n,
            "get_payments",
            json!({"po_ids":vec!["paid";51]})
        )
        .await
        .is_err()
    );
    call(
        &vault,
        successor.account_id(),
        &signer,
        &n,
        "withdraw_all",
        json!({}),
        one,
    )
    .await?;
    let state: near_sdk::serde_json::Value = view(&vault, &n, "get_state", json!({})).await?;
    assert_eq!(state["treasury"], treasury.account_id().as_str());
    assert_eq!(state["accounted_balance"], "0");
    assert_eq!(state["reserved_withdrawal"], "0");
    assert_eq!(state["paused"], true);
    println!(
        "Safety Sandbox: Paid once, partial refund, forced-transfer quarantine, guardian, one-yocto, private callback, treasury-only exit verified"
    );
    Ok(())
}
