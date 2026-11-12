# EC2 Testnet Payment Workers

These services poll the existing clinic financial authorization queue. The committer
service submits only `committer` authorizations; the requester service submits only
`requester` authorizations. They do not create or approve authorizations. Only start
them after confirming the restricted v2 role keys and the active clinic profile.

Each process runs as a separate Linux account and receives one role key through a
root-owned systemd environment file. Keep both role keys out of `/home/ubuntu/carecart/.env`.

## Install on the EC2 instance

From the repository root, copy the service files and launcher to the matching EC2
checkout, then run the commands below over SSH. The paths and clinic ID match the
current CareCart instance.

```bash
getent group carecart-payments >/dev/null || sudo groupadd --system carecart-payments
id -u carecart-committer >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin --gid carecart-payments carecart-committer
id -u carecart-requester >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin --gid carecart-payments carecart-requester
sudo usermod -aG carecart-payments ubuntu

sudo chgrp carecart-payments /home/ubuntu
sudo chmod 0710 /home/ubuntu
sudo chgrp carecart-payments /home/ubuntu/carecart/runtime-config
sudo chmod 0710 /home/ubuntu/carecart/runtime-config
sudo chgrp carecart-payments /home/ubuntu/carecart/runtime-config/testnet.payments.json
sudo chmod 0640 /home/ubuntu/carecart/runtime-config/testnet.payments.json

sudo chgrp carecart-payments /home/ubuntu/carecart/backend/data/tenancy
sudo chmod 2730 /home/ubuntu/carecart/backend/data/tenancy
sudo chgrp carecart-payments /home/ubuntu/carecart/backend/data/tenancy/registry.sqlite*
sudo chmod 0660 /home/ubuntu/carecart/backend/data/tenancy/registry.sqlite*

sudo chgrp carecart-payments /home/ubuntu/carecart/backend/data/testnet-v2
sudo chmod 0710 /home/ubuntu/carecart/backend/data/testnet-v2
sudo chgrp carecart-payments /home/ubuntu/carecart/backend/data/testnet-v2/clinics
sudo chmod 0710 /home/ubuntu/carecart/backend/data/testnet-v2/clinics
sudo chgrp carecart-payments /home/ubuntu/carecart/backend/data/testnet-v2/clinics/dfa461bd-16f8-443a-9ca7-13e9b4697940
sudo chmod 2730 /home/ubuntu/carecart/backend/data/testnet-v2/clinics/dfa461bd-16f8-443a-9ca7-13e9b4697940
sudo chgrp carecart-payments /home/ubuntu/carecart/backend/data/testnet-v2/clinics/dfa461bd-16f8-443a-9ca7-13e9b4697940/state.sqlite*
sudo chmod 0660 /home/ubuntu/carecart/backend/data/testnet-v2/clinics/dfa461bd-16f8-443a-9ca7-13e9b4697940/state.sqlite*
```

Install the units and add the shared group plus a group-readable SQLite umask to the
existing API and inventory worker. Restarting those two services is needed for the
new supplementary group to take effect.

```bash
sudo install -o root -g root -m 0644 backend/deploy/ec2/carecart-testnet-payment-committer.service /etc/systemd/system/
sudo install -o root -g root -m 0644 backend/deploy/ec2/carecart-testnet-payment-requester.service /etc/systemd/system/
sudo install -o root -g root -m 0755 backend/deploy/ec2/run-testnet-payment-worker.sh /home/ubuntu/carecart/backend/deploy/ec2/
sudo install -d -o root -g root -m 0755 /etc/systemd/system/carecart-api.service.d /etc/systemd/system/carecart-worker.service.d
sudo tee /etc/systemd/system/carecart-api.service.d/10-payment-db-access.conf >/dev/null <<'EOF'
[Service]
SupplementaryGroups=carecart-payments
UMask=0007
Environment=CARECART_SHARED_STATE_GROUP=carecart-payments
Environment=CARECART_WALLET_BINDING_ENABLED=true
Environment=CARECART_WALLET_BINDING_NETWORK=testnet
Environment=CARECART_WALLET_BINDING_RPC_URL=https://test.rpc.fastnear.com
EOF
sudo tee /etc/systemd/system/carecart-worker.service.d/10-payment-db-access.conf >/dev/null <<'EOF'
[Service]
SupplementaryGroups=carecart-payments
UMask=0007
Environment=CARECART_SHARED_STATE_GROUP=carecart-payments
EOF

sudo install -d -o root -g root -m 0700 /etc/carecart
for file in /etc/carecart/testnet-payment-common.env /etc/carecart/testnet-payment-committer.env /etc/carecart/testnet-payment-requester.env; do
  if ! sudo test -e "$file"; then sudo install -o root -g root -m 0600 /dev/null "$file"; fi
done
sudoedit /etc/carecart/testnet-payment-common.env
sudoedit /etc/carecart/testnet-payment-committer.env
sudoedit /etc/carecart/testnet-payment-requester.env

sudo systemctl daemon-reload
sudo systemctl restart carecart-api carecart-worker
```

Put the lines from `payment-common.env.example` in the common file. The payment
service accounts cannot read the main `.env`, so these common variables are set
explicitly in their protected environment. The committer
file must contain only `SAFETY_COMMITTER_PRIVATE_KEY=...`; the requester file must
contain only `SAFETY_REQUESTER_PRIVATE_KEY=...`. Enter the values directly in
`sudoedit`; never paste them into chat or a shell command. Both keys must correspond
to the public keys in the active `testnet.payments.json` profile.

Before starting the payment workers, check the API and inventory worker recovered:

```bash
sudo systemctl is-active carecart-api carecart-worker
curl -fsS http://127.0.0.1:3002/healthz
```

Then enable the two autonomous role workers:

```bash
sudo systemctl enable --now carecart-testnet-payment-committer carecart-testnet-payment-requester
sudo systemctl status carecart-testnet-payment-committer carecart-testnet-payment-requester --no-pager
```

They process only already-authorized, unexpired rows for their own role. Check their
journals with:

```bash
sudo journalctl -u carecart-testnet-payment-committer -u carecart-testnet-payment-requester -n 80 --no-pager
```
