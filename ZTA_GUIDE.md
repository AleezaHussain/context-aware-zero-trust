# Zero Trust Architecture (ZTA) guide — Context-aware Smart Contract project

This document provides an implementation-oriented checklist and recommended changes to adopt Zero Trust principles in this repository.

## Short answer
Yes — you can implement Zero Trust principles for this project, but some limitations exist because of the blockchain and IoT environment. The main work is on device identity, key management, access control, network segmentation, and telemetry. The smart contract and DApp currently have minimal access controls and hard-coded secrets; these are the first fixes.

## Where to focus (components)
- On-chain: `contracts/ContextAwareSmartContract.sol` (access control, events, signature verification)
- Off-chain gateway app: `app/app.js`, `app/motor.js` (RPC URL, contract address, key handling, sensor data signing)
- Runtime/host: OS hardening on IoT gateway (Raspberry Pi), firewall, process isolation
- Blockchain network: Quorum privacy groups or private transactions, RPC/TLS configuration

## Key recommendations (prioritized)
1. Prevent hard-coded secrets and endpoints
   - Move RPC endpoint and contract address to environment variables or secure config store.
   - Do not commit private keys or keystore passwords.
   - Files changed: `app/app.js` (done: now reads env variables). See `.env.example`.

2. Add on-chain access control
   - Restrict who can call `setContextData`. Use role-based access control (OpenZeppelin `Ownable` or `AccessControl`) or implement `onlyOwner` modifier.
   - Optionally require that payloads include a signature from the device or gateway and verify it in the contract (use `ecrecover`). This prevents arbitrary parties from injecting context.
   - Files to change: `contracts/ContextAwareSmartContract.sol` (add events + modifiers).

3. Use secure signing and key management
   - Do not store raw private keys on the device. Use an HSM/KMS, TPM, or secure element, or at least an encrypted keystore with password stored outside the repo.
   - For development, use ephemeral keys and a local KMS (e.g., HashiCorp Vault) or cloud KMS if available.
   - For Quorum, use private transaction manager securely.

4. Encrypt sensitive data & minimize on-chain footprint
   - Avoid writing raw sensor data to the chain. Store hashes on-chain and store encrypted payloads off-chain (IPFS/S3) if confidentiality is needed.
   - Alternatively, use Quorum private transactions or transaction-level encryption.

5. Network and device segmentation
   - Microsegment the IoT network from other corporate networks. Only the gateway should talk to blockchain nodes on a dedicated interface.
   - Use mTLS for RPC endpoints between gateway and blockchain nodes (if supported).

6. Device identity and posture
   - Provision each gateway with unique X.509 or TPM-backed key. Authenticate devices before they can push data.
   - Implement periodic attestation (remote attestation or simple software posture checks) before allowing writes.

7. Logging, telemetry, and alerting
   - Emit events from the smart contract for important state changes and actions, and capture them with an off-chain monitor.
   - Stream logs to a SIEM and configure alerts for abnormal write patterns or repeated failures.

8. Least privilege & testing
   - Restrict contract role for actuation decisions and admin tasks.
   - Add unit tests for auth flows and signature verification.

## Short implementation plan (concrete tasks)
1. Immediate (1–2 days)
   - Remove hard-coded RPC and contract address (done).
   - Add `.env.example` and update README to show secure configuration (done).
   - Add events to contracts and simple `onlyOwner` modifier.
2. Short-term (2–7 days)
   - Implement secure signing of sensor payloads in `app/app.js` and verify signatures in the contract (or off-chain before calling contract).
   - Add a role-based system (OpenZeppelin `AccessControl`) to the Solidity contract.
3. Medium-term (1–3 weeks)
   - Integrate KMS/HSM or TPM-backed key storage for signing.
   - Configure Quorum private transactions / privacy groups and use TLS for RPC endpoints.
   - Add monitoring pipeline for contract events and gateway logs.
4. Long-term (ongoing)
   - Device provisioning automation with unique certs/TMP keys.
   - Continuous attestation and posture enforcement.

## Limitations / Caveats
- Smart contracts are immutable: fixing auth after deployment requires redeployment or upgrade pattern (proxy). Plan for upgradeability if you need on-chain fixes.
- Verifying complex device posture on-chain is impractical and expensive; off-chain attestation with on-chain proof (signed claims) is a practical compromise.
- Quorum/private transactions can hide payloads from public nodes, but you'll still need endpoint security for RPC.

## Next steps I can take for you

If you'd like, I can implement the next low-risk commits now: add an `.env.example` (done) and show how to switch `app/app.js` to use environment variables (already applied). Tell me which of the medium-term items you want me to implement next and I will continue.

## How to run a local Ganache test (B on local Ganache)

These steps run a quick local test that deploys the updated contract, grants a registrar role, authorizes a device, and submits a signed payload.

1. Install Node.js (14 or 16) and npm.
2. From PowerShell in the repo root run:

```powershell
npm install
npm test
```

If `npm install` fails because of registry restrictions, install packages manually:

```powershell
# install common versions
npm install web3@1.10.0 ganache-core@2.13.2 solc@0.5.17
npm test
```

The script `scripts/deploy_and_test.js` will start Ganache in-process, deploy the contract, authorize a generated device address, then sign and submit a context payload. Check the terminal output for `Context after update:` to verify the flow.

Notes: this is a development demo. For production, run Ganache replacement (Geth/Quorum), use KMS for keys, and secure RPC endpoints.

### Local keystore (dev) example

To avoid putting raw private keys in env variables, you can create a simple local keystore (dev only):

1. Create a keystore file using Node REPL or a short script:

```powershell
node -e "const ks=require('./app/keystore'); const k=require('web3').eth.accounts.create(); ks.saveKeystore('./mykeystore', k.privateKey, 'your-password'); console.log('device address:', k.address);"
```

2. Set env vars before running the app:

```powershell
$env:KEYSTORE_PATH = 'D:\path\to\repo\mykeystore'
$env:KEYSTORE_PASSWORD = 'your-password'
node app/app.js
```

This demonstrates encrypted-at-rest private key usage for local testing. For production, replace with HSM/KMS.
