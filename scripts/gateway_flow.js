const GanacheCore = require('ganache-core');
const Web3 = require('web3');
const FS = require('fs');
const PATH = require('path');
const SOLC = require('solc');

function log(msg, obj) { console.log(msg); if (obj) console.dir(obj, { depth: 2 }); }

async function compileContract() {
  const source = FS.readFileSync(PATH.resolve(__dirname, '..', 'contracts', 'ContextAwareSmartContract.sol'), 'utf8');
  const input = { language: 'Solidity', sources: { 'ContextAwareSmartContract.sol': { content: source } }, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, outputSelection: { '*': { '*': ['abi','evm.bytecode'] } } } };
  const output = JSON.parse(SOLC.compile(JSON.stringify(input)));
  if (output.errors) {
    for (const e of output.errors) console.error(e.formattedMessage);
    throw new Error('compile failed');
  }
  const contractName = Object.keys(output.contracts['ContextAwareSmartContract.sol'])[0];
  const abi = output.contracts['ContextAwareSmartContract.sol'][contractName].abi;
  const bytecode = output.contracts['ContextAwareSmartContract.sol'][contractName].evm.bytecode.object;
  return { abi, bytecode };
}

async function main() {
  log('\nStarting gateway_flow demo...');
  const server = GanacheCore.server({ wallet: { totalAccounts: 8 } });
  const PORT = 8545;
  await server.listen(PORT);
  const web3 = new Web3('http://127.0.0.1:' + PORT);
  const accounts = await web3.eth.getAccounts();
  const owner = accounts[0];
  const registrar = accounts[1];

  const { abi, bytecode } = await compileContract();
  const Contract = new web3.eth.Contract(abi);
  const deployed = await Contract.deploy({ data: '0x' + bytecode }).send({ from: owner, gas: 6000000 });
  log('Contract deployed', { address: deployed.options.address });

  // grant registrar role (owner already has roles but keep safe)
  try { await deployed.methods.grantRole(web3.utils.keccak256(web3.utils.asciiToHex('REGISTRAR_ROLE')), registrar).send({ from: owner }); log('granted REGISTRAR_ROLE'); } catch (e) { console.warn('grant role failed', e.message); }

  // create devices and register
  const devices = [];
  for (let i=0;i<3;i++) devices.push(web3.eth.accounts.create());
  for (const d of devices) {
    await deployed.methods.authorizeDevice(d.address).send({ from: registrar });
    log('device authorized', d.address);
  }

  // create gateway account and grant GATEWAY_ROLE
  const gateway = web3.eth.accounts.create();
  // fund gateway
  await web3.eth.sendTransaction({ from: owner, to: gateway.address, value: web3.utils.toWei('1', 'ether') });
  // grant role
  await deployed.methods.grantRole(web3.utils.keccak256(web3.utils.asciiToHex('GATEWAY_ROLE')), gateway.address).send({ from: owner });
  log('gateway created and funded', gateway.address);

  // Device -> signs payload off-chain -> sends (payload + sig) to gateway
  // Gateway verifies (off-chain) and then calls setContextDataViaGateway

  const types = [
    'uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','bytes32'
  ];

  // helper to send gateway-submitted update
  async function gatewaySubmit(device, temperature, humidity) {
    const nonce = Number(await deployed.methods.nonces(device.address).call());
  const ctxHash = web3.utils.keccak256(web3.utils.asciiToHex('ctx'+nonce));
  const vals = [temperature, humidity, 0, 0, 12, 0,0,0,0, nonce, ctxHash];
  const encoded = web3.eth.abi.encodeParameters(types, vals);
    const hash = web3.utils.keccak256(encoded);
    const sig = web3.eth.accounts.sign(hash, device.privateKey);

    // Gateway verifies device signature off-chain
    const recovered = web3.eth.accounts.recover(hash, sig.signature);
    if (recovered.toLowerCase() !== device.address.toLowerCase()) throw new Error('gateway verify failed');

    // Now gateway calls contract method setContextDataViaGateway with device signature parts
    const v = sig.v; const r = sig.r; const s = sig.s;
    const gas = 300000;
  const payload = [temperature, humidity, 0, 0, 12, 0,0,0,0, nonce, ctxHash];
    // Build transaction data and have gateway sign it locally (gateway is an external account)
  // include empty ciphertext blob as fifth parameter
  const data = deployed.methods.setContextDataViaGateway(payload, v, r, s, '0x').encodeABI();
    const txCount = await web3.eth.getTransactionCount(gateway.address);
    const gasPrice = await web3.eth.getGasPrice();
    const tx = {
      nonce: web3.utils.toHex(txCount),
      to: deployed.options.address,
      gas: web3.utils.toHex(gas),
      gasPrice: web3.utils.toHex(gasPrice),
      data
    };
    const signed = await web3.eth.accounts.signTransaction(tx, gateway.privateKey);
    const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
    log('gateway submitted update on behalf of device', { device: device.address, txHash: receipt.transactionHash });
  }

  // Run updates
  for (const d of devices) {
    await gatewaySubmit(d, 22 + Math.floor(Math.random()*5), 30 + Math.floor(Math.random()*10));
  }

  // Read context after updates
  const ctx = await deployed.methods.getContextData().call();
  log('context after gateway submissions', ctx);

  await server.close();
  log('done');
}

main().catch(e=>{ console.error(e); process.exit(1); });
