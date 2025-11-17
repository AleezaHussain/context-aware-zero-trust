// scripts/test_replay_chain.js
// Deploy contract, perform a gateway-submitted update, then attempt to replay the same
// device-signed payload to exercise the contract nonce replay protection.
const GanacheCore = require('ganache-core');
const Web3 = require('web3');
const FS = require('fs');
const PATH = require('path');
const SOLC = require('solc');

function log(msg, obj){ console.log(msg); if(obj) console.dir(obj,{depth:2}); }

async function compileContract(){
  const source = FS.readFileSync(PATH.resolve(__dirname,'..','contracts','ContextAwareSmartContract.sol'),'utf8');
  const input = { language: 'Solidity', sources: { 'ContextAwareSmartContract.sol': { content: source } }, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, outputSelection: { '*': { '*': ['abi','evm.bytecode'] } } } };
  const output = JSON.parse(SOLC.compile(JSON.stringify(input)));
  if(output.errors){ for(const e of output.errors) console.error(e.formattedMessage); throw new Error('compile failed'); }
  const contractName = Object.keys(output.contracts['ContextAwareSmartContract.sol'])[0];
  const abi = output.contracts['ContextAwareSmartContract.sol'][contractName].abi;
  const bytecode = output.contracts['ContextAwareSmartContract.sol'][contractName].evm.bytecode.object;
  return { abi, bytecode };
}

async function main(){
  log('\nStarting replay-chain test...');
  const server = GanacheCore.server({ wallet: { totalAccounts: 6 } });
  const PORT = 8545;
  await server.listen(PORT);
  const web3 = new Web3('http://127.0.0.1:' + PORT);
  const accounts = await web3.eth.getAccounts();
  const owner = accounts[0];
  const registrar = accounts[1];

  const { abi, bytecode } = await compileContract();
  const Contract = new web3.eth.Contract(abi);
  const deployed = await Contract.deploy({ data: '0x'+bytecode }).send({ from: owner, gas: 6000000 });
  log('Deployed', { address: deployed.options.address });

  // create device and authorize
  const device = web3.eth.accounts.create();
  await deployed.methods.grantRole(web3.utils.keccak256(web3.utils.asciiToHex('REGISTRAR_ROLE')), registrar).send({ from: owner });
  await deployed.methods.authorizeDevice(device.address).send({ from: registrar });
  log('device authorized', device.address);

  // create gateway account and fund + grant role
  const gateway = web3.eth.accounts.create();
  // fund gateway
  await web3.eth.sendTransaction({ from: owner, to: gateway.address, value: web3.utils.toWei('1','ether') });
  await deployed.methods.grantRole(web3.utils.keccak256(web3.utils.asciiToHex('GATEWAY_ROLE')), gateway.address).send({ from: owner });
  log('gateway ready', gateway.address);

  // prepare a payload and device signature
  const types = [
    'uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','bytes32'
  ];
  // our ContextPayload fields excluding contextHash for setContextDataViaGateway helper - but contract expects struct in calldata; use same encoding as gateway_flow
  const temperature = 25; const humidity = 40; const nonce = Number(await deployed.methods.nonces(device.address).call());
  const ctxHash = web3.utils.keccak256(web3.utils.asciiToHex('ctx')); 
  const vals = [temperature, humidity, 0, 0, 12, 0,0,0,0, nonce, ctxHash];
  const encoded = web3.eth.abi.encodeParameters(types, vals);
  const hash = web3.utils.keccak256(encoded);
  const sig = web3.eth.accounts.sign(hash, device.privateKey);
  log('device signed payload', { nonce, sig: sig.signature.slice(0,16)+'...' });

  // Gateway verifies off-chain then calls contract
  // Build transaction to call setContextDataViaGateway(payload, v, r, s)
  const v = sig.v; const r = sig.r; const s = sig.s;
  const payload = [temperature, humidity, 0, 0, 12, 0,0,0,0, nonce, ctxHash];
  // fifth parameter is ctMetricsBlob (opaque bytes) - pass empty bytes for tests
  const data = deployed.methods.setContextDataViaGateway(payload, v, r, s, '0x').encodeABI();
  const txCount = await web3.eth.getTransactionCount(gateway.address);
  const gasPrice = await web3.eth.getGasPrice();
  const tx = { nonce: web3.utils.toHex(txCount), to: deployed.options.address, gas: web3.utils.toHex(300000), gasPrice: web3.utils.toHex(gasPrice), data };
  const signedTx = await web3.eth.accounts.signTransaction(tx, gateway.privateKey);
  const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
  log('gateway submitted first tx', { txHash: receipt.transactionHash });

  // Attempt replay: send the same calldata again (same device signature and same nonce)
  try{
    const txCount2 = await web3.eth.getTransactionCount(gateway.address);
    const tx2 = { nonce: web3.utils.toHex(txCount2), to: deployed.options.address, gas: web3.utils.toHex(300000), gasPrice: web3.utils.toHex(gasPrice), data };
    const signedTx2 = await web3.eth.accounts.signTransaction(tx2, gateway.privateKey);
    const r2 = await web3.eth.sendSignedTransaction(signedTx2.rawTransaction);
    log('Replay accepted (unexpected)', { txHash: r2.transactionHash });
  }catch(e){
    log('Replay rejected as expected', { error: e.message });
  }

  await server.close();
  log('done');
}

main().catch(e=>{ console.error(e); process.exit(1); });
