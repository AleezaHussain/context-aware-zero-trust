const Ganache = require('ganache-core');
const Web3 = require('web3');
const fs = require('fs');
const path = require('path');
const solc = require('solc');

async function main() {
  // Start Ganache in-memory
  const server = Ganache.server({ wallet: { totalAccounts: 5 } });
  const PORT = 8545;
  await server.listen(PORT);
  console.log('Ganache started on', PORT);

  const web3 = new Web3('http://127.0.0.1:' + PORT);
  const accounts = await web3.eth.getAccounts();
  console.log('Accounts:', accounts.slice(0, 3));

  // Compile contract
  const contractPath = path.resolve(__dirname, '..', 'contracts', 'ContextAwareSmartContract.sol');
  const source = fs.readFileSync(contractPath, 'utf8');
  const input = {
    language: 'Solidity',
    sources: {
      'ContextAwareSmartContract.sol': { content: source },
    },
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors) {
    for (const err of output.errors) console.error(err.formattedMessage);
    process.exit(1);
  }

  const contractName = Object.keys(output.contracts['ContextAwareSmartContract.sol'])[0];
  const abi = output.contracts['ContextAwareSmartContract.sol'][contractName].abi;
  const bytecode = output.contracts['ContextAwareSmartContract.sol'][contractName].evm.bytecode.object;

  const deployer = accounts[0];
  const registrar = accounts[1];
  const device = web3.eth.accounts.create();
  console.log('Device address (to authorize):', device.address);

  // Deploy
  const Contract = new web3.eth.Contract(abi);
  const deployed = await Contract.deploy({ data: '0x' + bytecode })
    .send({ from: deployer, gas: 6000000 });
  console.log('Deployed at', deployed.options.address);

  // Compute role hashes
  const ADMIN_ROLE = web3.utils.keccak256(web3.utils.asciiToHex('ADMIN_ROLE'));
  const REGISTRAR_ROLE = web3.utils.keccak256(web3.utils.asciiToHex('REGISTRAR_ROLE'));

  // Grant registrar role to accounts[1]
  await deployed.methods.grantRole(REGISTRAR_ROLE, registrar)
    .send({ from: deployer, gas: 200000 });
  console.log('Granted registrar role to', registrar);

  // Authorize the device using registrar account
  await deployed.methods.authorizeDevice(device.address)
    .send({ from: registrar, gas: 100000 });
  console.log('Authorized device', device.address);

  // Prepare signed payload from device and submit
  const payload = {
    temperature: 25,
    humidity: 40,
    totalMeterSignal: 0,
    totalDevicesPowerValue: 10,
    hour: 14,
    ac1Power: 3,
    ac2Power: 4,
    ac3Power: 3,
    carBatteryPowerStatus: 80,
    nonce: Number(await deployed.methods.nonces(device.address).call()),
  };

  // Create ABI-encoded parameters (exactly as Solidity abi.encode(...)) and hash
  const types = [
    'uint256','uint256','uint256','uint256','uint256',
    'uint256','uint256','uint256','uint256','uint256','address'
  ];
  const values = [
    payload.temperature,
    payload.humidity,
    payload.totalMeterSignal,
    payload.totalDevicesPowerValue,
    payload.hour,
    payload.ac1Power,
    payload.ac2Power,
    payload.ac3Power,
    payload.carBatteryPowerStatus,
    payload.nonce,
    deployed.options.address
  ];

  const encoded = web3.eth.abi.encodeParameters(types, values);
  const hash = web3.utils.keccak256(encoded);

  // Sign the hash using the device private key (web3 prefixes the message)
  const signature = web3.eth.accounts.sign(hash, device.privateKey);
  const { v, r, s } = signature;

  console.log('Recovered signer:', web3.eth.accounts.recover(hash, signature.signature));

  console.log('Submitting signed payload...');
  const receipt = await deployed.methods
    .setContextDataSigned([
      payload.temperature,
      payload.humidity,
      payload.totalMeterSignal,
      payload.totalDevicesPowerValue,
      payload.hour,
      payload.ac1Power,
      payload.ac2Power,
      payload.ac3Power,
      payload.carBatteryPowerStatus,
      payload.nonce
    ], v, r, s)
    .send({ from: deployer, gas: 400000 });
  console.log('Transaction hash:', receipt.transactionHash);

  // Verify context updated
  const ctx = await deployed.methods.getContextData().call();
  console.log('Context after update:', ctx);

  await server.close();
  console.log('Ganache stopped.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
