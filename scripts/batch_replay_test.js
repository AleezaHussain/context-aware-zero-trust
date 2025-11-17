const GanacheCore = require('ganache-core');
const Web3 = require('web3');
const FS = require('fs');
const PATH = require('path');
const SOLC = require('solc');

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
  console.log('Starting batch replay test (18 attempts expected to FAIL - invalid nonce)');
  const server = GanacheCore.server({ wallet: { totalAccounts: 6 } });
  await server.listen(8545);
  const web3 = new Web3('http://127.0.0.1:8545');
  const accounts = await web3.eth.getAccounts();
  const owner = accounts[0];
  const registrar = accounts[1];

  const { abi, bytecode } = await compileContract();
  const Contract = new web3.eth.Contract(abi);
  const deployed = await Contract.deploy({ data: '0x'+bytecode }).send({ from: owner, gas: 6000000 });
  console.log('Deployed', deployed.options.address);

  // authorize a device and a gateway
  const device = web3.eth.accounts.create();
  await deployed.methods.grantRole(web3.utils.keccak256(web3.utils.asciiToHex('REGISTRAR_ROLE')), registrar).send({ from: owner });
  await deployed.methods.authorizeDevice(device.address).send({ from: registrar });
  const gateway = web3.eth.accounts.create();
  await web3.eth.sendTransaction({ from: owner, to: gateway.address, value: web3.utils.toWei('1','ether') });
  await deployed.methods.grantRole(web3.utils.keccak256(web3.utils.asciiToHex('GATEWAY_ROLE')), gateway.address).send({ from: owner });

  let attempts = 18; let success = 0; let failed = 0;
  // craft a payload signed by device but with an incorrect nonce to force contract reject
  for(let i=0;i<attempts;i++){
    const temperature = 20 + (i%5);
    const humidity = 30 + (i%10);
    // deliberately use a bad nonce far from current (likely 0)
    const badNonce = 9999;
    const ctxHash = web3.utils.keccak256(web3.utils.asciiToHex('batch'+i));
    const vals = [temperature, humidity, 0, 0, 12, 0,0,0,0, badNonce, ctxHash];
    const types = ['uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256','bytes32'];
    const encoded = web3.eth.abi.encodeParameters(types, vals);
    const hash = web3.utils.keccak256(encoded);
    const sig = web3.eth.accounts.sign(hash, device.privateKey);

    const v = sig.v, r = sig.r, s = sig.s;
    const payload = vals; // includes ctxHash
    const data = deployed.methods.setContextDataViaGateway(payload, v, r, s, '0x').encodeABI();
    const txCount = await web3.eth.getTransactionCount(gateway.address);
    const gasPrice = await web3.eth.getGasPrice();
    const tx = { nonce: web3.utils.toHex(txCount), to: deployed.options.address, gas: web3.utils.toHex(300000), gasPrice: web3.utils.toHex(gasPrice), data };
    const signedTx = await web3.eth.accounts.signTransaction(tx, gateway.privateKey);
    try{
      const rec = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
      console.log('Attempt', i+1, 'unexpected success', rec.transactionHash);
      success++;
    }catch(e){
      console.log('Attempt', i+1, 'failed as expected:', e.message.split('\n')[0]);
      failed++;
    }
  }

  console.log('Summary:', { attempts, success, failed });
  FS.writeFileSync('runs/attacks_results_batch_replay.json', JSON.stringify({ attempts, success, failed }, null, 2));
  await server.close();
}

main().catch(e=>{ console.error(e); process.exit(1); });
