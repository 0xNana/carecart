# CareCart vault scaffold

This crate was generated from the NEAR auction example. Its Rust source is still that example; it is not the CareCart payment vault and must be replaced before any deployment.

The repository uses a Cargo workspace rooted at `contracts/`. To verify the current toolchain and build this sample only:

```sh
cargo near build non-reproducible-wasm --manifest-path contracts/carecart-vault/Cargo.toml --locked
```

No deployment command is provided here. CareCart's first implementation targets testnet, and any transaction signing requires the human's explicit confirmation.
