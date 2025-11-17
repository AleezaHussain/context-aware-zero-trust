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

async function run() {
  log('\nRunning gateway failure scenario demo...');
  const server = GanacheCore.server({ wallet: { totalAccounts: 6 } });
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

  // grant registrar role
  try { await deployed.methods.grantRole(web3.utils.keccak256(web3.utils.asciiToHex('REGISTRAR_ROLE')), registrar).send({ from: owner }); } catch (e) { console.warn('grant role failed', e.message); }

  // create a device and authorize it
  const device = web3.eth.accounts.create();
  await deployed.methods.authorizeDevice(device.address).send({ from: registrar });
  log('device authorized', device.address);

  // create gateway and fund it, grant GATEWAY_ROLE
  const gateway = web3.eth.accounts.create();
  await web3.eth.sendTransaction({ from: owner, to: gateway.address, value: web3.utils.toWei('1', 'ether') });
  await deployed.methods.grantRole(web3.utils.keccak256(web3.utils.asciiToHex('GATEWAY_ROLE')), gateway.address).send({ from: owner });
  log('gateway ready', gateway.address);

  const types = ['uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','bytes32'];

  async function gatewaySubmitWithSig(deviceObj, valsArray, sigObj, expectReject=false) {
    const v = sigObj.v; const r = sigObj.r; const s = sigObj.s;
  // include empty ciphertext blob as fifth parameter
  const data = deployed.methods.setContextDataViaGateway(valsArray, v, r, s, '0x').encodeABI();
    const txCount = await web3.eth.getTransactionCount(gateway.address);
    const gasPrice = await web3.eth.getGasPrice();
    const tx = { nonce: web3.utils.toHex(txCount), to: deployed.options.address, gas: web3.utils.toHex(300000), gasPrice: web3.utils.toHex(gasPrice), data };
    const signed = await web3.eth.accounts.signTransaction(tx, gateway.privateKey);
    try {
      const receipt = await web3.eth.sendSignedTransaction(signed.rawTransaction);
      log('Gateway submitted tx', { txHash: receipt.transactionHash });
      if (expectReject) log('ERROR: expected reject but tx succeeded');
    } catch (err) {
      log('Gateway submission reverted as expected', { error: err.message });
      if (!expectReject) log('ERROR: unexpected revert');
    }
  }

  // 1) Out-of-range temperature -> should be rejected by contract (range check)
  log('\nScenario 1: Out-of-range temperature (expect contract revert)');
  let nonce = Number(await deployed.methods.nonces(device.address).call());
  // include a bytes32 contextHash placeholder
  const ctxHash1 = web3.utils.keccak256(web3.utils.asciiToHex('ctx1'));
  let vals = [2000, 50, 0, 0, 12, 0,0,0,0, nonce, ctxHash1];
  const encoded = web3.eth.abi.encodeParameters(types, vals);
  const hash = web3.utils.keccak256(encoded);
  const sig = web3.eth.accounts.sign(hash, device.privateKey);
  await gatewaySubmitWithSig(device, vals, sig, true);

  // 2) Invalid device signature (tampered) -> should be rejected as invalid signature
  log('\nScenario 2: Invalid/tampered device signature (expect contract revert)');
  nonce = Number(await deployed.methods.nonces(device.address).call());
  const ctxHash2 = web3.utils.keccak256(web3.utils.asciiToHex('ctx2'));
  vals = [25, 40, 0, 0, 12, 0,0,0,0, nonce, ctxHash2];
  const encoded2 = web3.eth.abi.encodeParameters(types, vals);
  const hash2 = web3.utils.keccak256(encoded2);
  const sig2 = web3.eth.accounts.sign(hash2, device.privateKey);
  // tamper with signature by altering r
  const badSig = { v: sig2.v, r: '0x' + '11'.repeat(32), s: sig2.s };
  await gatewaySubmitWithSig(device, vals, badSig, true);

  // 3) Nonce replay: submit a valid update, then re-submit same nonce (second should revert)
  log('\nScenario 3: Nonce replay (first should succeed, second should revert)');
  nonce = Number(await deployed.methods.nonces(device.address).call());
  const ctxHash3 = web3.utils.keccak256(web3.utils.asciiToHex('ctx3'));
  vals = [26, 41, 0, 0, 12, 0,0,0,0, nonce, ctxHash3];
  const enc3 = web3.eth.abi.encodeParameters(types, vals);
  const hash3 = web3.utils.keccak256(enc3);
  const sig3 = web3.eth.accounts.sign(hash3, device.privateKey);
  // first submission (expected to succeed)
  await gatewaySubmitWithSig(device, vals, sig3, false);
  // second submission with same nonce and same signature: should revert due to invalid nonce
  await gatewaySubmitWithSig(device, vals, sig3, true);

  // read context
  const ctx = await deployed.methods.getContextData().call();
  log('\nContext after tests', ctx);

  await server.close();
  log('\nDone.');
}

run().catch(e=>{ console.error(e); process.exit(1); });
