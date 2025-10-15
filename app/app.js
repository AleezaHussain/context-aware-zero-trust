
//Interaction with gpio
const Gpio = require('pigpio').Gpio; 
//var Gpio = require('onoff').Gpio; //include onoff to interact with the GPIO

var Web3 = require('web3')
var web3 = new Web3()

// Read RPC URL and contract address from environment variables for security/configurability
const RPC_URL = process.env.RPC_URL || 'http://192.168.0.38:22000';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0xa2c66ff8392b35742ecc82532f9069463c675c8e';

// Web3 provider setting
web3 = new Web3(new Web3.providers.HttpProvider(RPC_URL));

// Note: for web3 v1.x, setting defaultAccount typically requires accounts from the provider
// Keep defaultAccount unset here; callers should specify `from` in transactions or configure a managed account.
// web3.eth.defaultAccount = web3.eth.accounts[0];


//contract abi update as deployed
        var deviceControl = web3.eth.contract(

        [{
		"constant": false,
		"inputs": [
			{
				"name": "_temperature",
				"type": "uint256"
			},
			{
				"name": "_humidity",
				"type": "uint256"
			},
			{
				"name": "_totalMeterSignal",
				"type": "uint256"
			},
			{
				"name": "_totalDevicesPowerValue",
				"type": "uint256"
			},
			{
				"name": "_hour",
				"type": "uint256"
			},
			{
				"name": "_ac1Power",
				"type": "uint256"
			},
			{
				"name": "_ac2Power",
				"type": "uint256"
			},
			{
				"name": "_ac3Power",
				"type": "uint256"
			},
			{
				"name": "_carBatteryPowerStatus",
				"type": "uint256"
			}
		],
		"name": "setContextData",
		"outputs": [],
		"payable": false,
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"constant": true,
		"inputs": [],
		"name": "getContextData",
		"outputs": [
			{
				"name": "",
				"type": "uint256"
			},
			{
				"name": "",
				"type": "uint256"
			},
			{
				"name": "",
				"type": "uint256"
			},
			{
				"name": "",
				"type": "uint256"
			},
			{
				"name": "",
				"type": "uint256"
			},
			{
				"name": "",
				"type": "uint256"
			},
			{
				"name": "",
				"type": "uint256"
			},
			{
				"name": "",
				"type": "uint256"
			}
		],
		"payable": false,
		"stateMutability": "view",
		"type": "function"
	},
	{
		"constant": true,
		"inputs": [],
		"name": "ac2Power",
		"outputs": [
			{
				"name": "",
				"type": "uint256"
			}
		],
		"payable": false,
		"stateMutability": "view",
		"type": "function"
	},
	{
		"constant": true,
		"inputs": [],
		"name": "carBatteryPowerStatus",
		"outputs": [
			{
				"name": "",
				"type": "uint256"
			}
		],
		"payable": false,
		"stateMutability": "view",
		"type": "function"
	},
	{
		"constant": true,
		"inputs": [],
		"name": "ac1Power",
		"outputs": [
			{
				"name": "",
				"type": "uint256"
			}
		],
		"payable": false,
		"stateMutability": "view",
		"type": "function"
	},
	{
		"constant": true,
		"inputs": [],
		"name": "totalDevicesPowerValue",
		"outputs": [
			{
				"name": "",
				"type": "uint256"
			}
		],
		"payable": false,
		"stateMutability": "view",
		"type": "function"
	},
	{
		"constant": true,
		"inputs": [],
		"name": "humidity",
		"outputs": [
			{
				"name": "",
				"type": "uint256"
			}
		],
		"payable": false,
		"stateMutability": "view",
		"type": "function"
	},
	{
		"constant": true,
		"inputs": [],
		"name": "temperature",
		"outputs": [
			{
				"name": "",
				"type": "uint256"
			}
		],
		"payable": false,
		"stateMutability": "view",
		"type": "function"
	},
	{
		"constant": true,
		"inputs": [],
		"name": "totalMeterSignal",
		"outputs": [
			{
				"name": "",
				"type": "uint256"
			}
		],
		"payable": false,
		"stateMutability": "view",
		"type": "function"
	},
	{
		"constant": true,
		"inputs": [],
		"name": "ac3Power",
		"outputs": [
			{
				"name": "",
				"type": "uint256"
			}
		],
		"payable": false,
		"stateMutability": "view",
		"type": "function"
	}
]

		);

if (!process.env.CONTRACT_ADDRESS) {
	console.warn('Warning: using default CONTRACT_ADDRESS from source. Set CONTRACT_ADDRESS env var to override.');
}

// For web3 v1.x use the Contract wrapper. `deviceControl` above is the ABI array; create a Contract instance.
const deviceContract = new web3.eth.Contract(deviceControl, CONTRACT_ADDRESS);

// PRIVATE_KEY should be the hex private key (no 0x) for the account that is owner of the contract in Quorum.
// Prefer keystore-based key storage for local ZTA demo
const KEYSTORE_PATH = process.env.KEYSTORE_PATH || null;
const KEYSTORE_PASSWORD = process.env.KEYSTORE_PASSWORD || null;
let PRIVATE_KEY = process.env.PRIVATE_KEY || null;
if (KEYSTORE_PATH && KEYSTORE_PASSWORD) {
	try {
		const keystore = require('./keystore');
		PRIVATE_KEY = keystore.loadKeystore(KEYSTORE_PATH, KEYSTORE_PASSWORD);
		console.log('Loaded private key from keystore.');
	} catch (err) {
		console.error('Failed to load keystore:', err.message);
	}
}
if (!PRIVATE_KEY) {
	console.warn('No PRIVATE_KEY set in env — transactions will fail unless using an unlocked node account. For ZTA, use an HSM or KMS instead of raw keys in env.');
}

// Minimal ABI for signed entrypoint and nonce lookup
const signedAbi = [
	{
		"constant": true,
		"inputs": [ { "name": "", "type": "address" } ],
		"name": "nonces",
		"outputs": [ { "name": "", "type": "uint256" } ],
		"payable": false,
		"stateMutability": "view",
		"type": "function"
	},
	{
		"constant": false,
		"inputs": [
			{"name":"_temperature","type":"uint256"},
			{"name":"_humidity","type":"uint256"},
			{"name":"_totalMeterSignal","type":"uint256"},
			{"name":"_totalDevicesPowerValue","type":"uint256"},
			{"name":"_hour","type":"uint256"},
			{"name":"_ac1Power","type":"uint256"},
			{"name":"_ac2Power","type":"uint256"},
			{"name":"_ac3Power","type":"uint256"},
			{"name":"_carBatteryPowerStatus","type":"uint256"},
			{"name":"_nonce","type":"uint256"},
			{"name":"v","type":"uint8"},
			{"name":"r","type":"bytes32"},
			{"name":"s","type":"bytes32"}
		],
		"name": "setContextDataSigned",
		"outputs": [],
		"payable": false,
		"stateMutability": "nonpayable",
		"type": "function"
	}
];

const signedContract = new web3.eth.Contract(signedAbi, CONTRACT_ADDRESS);

// Interaction with GPIO

const servoAc1 = new Gpio(4, {mode: Gpio.OUTPUT});//0
const servoAc2 = new Gpio(18, {mode: Gpio.OUTPUT});//1
const servoAc3 = new Gpio(26, {mode: Gpio.OUTPUT});//2
const carBattery = new Gpio(19, {mode: Gpio.OUTPUT});//3

//var LED = new Gpio(4, 'out'); //use GPIO pin 4, and specify that it is output

let pulseWidth = 1000; //for 0 degree
let increment = 100;


  var ac1Power = 0; //ac1;
  var ac2Power  = 0; //ac2;
  var ac3Power  = 0; // ac3;
  var bVoltage = 0;




var sensor = require("node-dht-sensor");
//var sensor2 = require("node-dht-sensor");


var sensorType=11;
var sensorPin=16;
if (!sensor.initialize(11,16))
{
	console.warn('failed to initialize sensor');
Process.exit(1);
}


setInterval(function() {
 var readout=sensor.read();



 const mcpadc = require('mcp-spi-adc');

 const ac = mcpadc.open(0, {speedHz: 1350000}, err => {
   if (err) throw err;



   setInterval(_ => {
	 ac.read((err, reading) => {
	   if (err) throw err;
 var accPower= 0;
	   console.log('Bit value for AC',reading);
	   var acbitvalue= reading.rawValue;
	   var acvoltage = (acbitvalue*5)/(1023);
	   var accurrent = (acvoltage-2.5)*0.185;
	   console.log('volatge AC is', acvoltage);
	   console.log('current  AC is', accurrent);
	   console.log('bitvalue is', reading.rawValue);
	  accPower = (5*accurrent).toFixed(1);
	  ac1Power=accPower;

	   console.log('Power for Ac is', 5*accurrent.toFixed(1), '\n');
	   //console.log(device.setContextAttributesData( acPower));
	 });




   },5000);
 });



 const heater = mcpadc.open(1, {speedHz: 1350000}, err => {
	 if (err) throw err;



	 setInterval(_ => {
	   heater.read((err, reading) => {
		 if (err) throw err;
   var hhPower=0;
		 console.log('Bit value for Heater', reading);
		 var hbitvalue= reading.rawValue;
		 var hvoltage = (hbitvalue*5)/(1023);
		 var hcurrent = (hvoltage-2.5)*0.185;
		 console.log('volatge for heater is', hvoltage);
		 console.log('current for heater is', hcurrent);
		 console.log('bitvalue is', reading.rawValue);
		 hhPower = (5*hcurrent).toFixed(1)
		 ac2Power=hhPower;
		 console.log('Power for Heater is', 5*hcurrent.toFixed(1) , '\n');
		 //console.log(device.setContextAttributesData(hPower));

	   });




	 }, 5000);
   });


   const washing = mcpadc.open(2, {speedHz: 1350000}, err => {
	 if (err) throw err;



	 setInterval(_ => {
	   washing.read((err, reading) => {
		 if (err) throw err;
   var wwPower=0;
		 console.log('Bit value for Washing',reading);
		 var wbitvalue= reading.rawValue;
		 var wvoltage = (wbitvalue*5)/(1023);
		 var wcurrent = (wvoltage-2.5)*0.185;
		 console.log('volatge  w is', wvoltage);
		 console.log('current w is', wcurrent);
		 console.log('bitvalue is', reading.rawValue);
		 wwPower = (5*wcurrent).toFixed(1);
		 ac3Power=wwPower;
		console.log('Power for washing is', 5*wcurrent.toFixed(1) , '\n');
		//console.log(device.setContextAttributesData( wPower));

	   });




	 }, 5000);
   });


   const carBattery = mcpadc.open(3, {speedHz: 1350000}, err => {
	if (err) throw err;



	setInterval(_ => {
	  carBattery.read((err, reading) => {
		if (err) throw err;
  var bbVoltage=0;
		console.log('Bit value for battery',reading);
		var bbitvalue= reading.rawValue;
		var bCarvoltage = (bbitvalue*5)/(1023);
		var bcurrent = (bCarvoltage-2.5)*0.185;  //subtracting the zero current voltage and multiplying by the sensitivity (0.185, 0.1, 0.066) along the lines
		console.log('volatge  w is', bCarvoltage);
		console.log('current w is', bcurrent);
		console.log('bitvalue for bvattery is', reading.rawValue);
		bbVoltage = (11.1*bbitvalue).toFixed(1);
		bVoltage= bbVoltage;
	   console.log('Battery Level in % is ', bbVoltage);
	   //console.log(device.setContextAttributesData( wPower));

	  });




	}, 5000);
  });






//sending data and time to blckchain

var now = new Date();
var minutes = now.getMinutes();
var hour = now.getHours();

console.log('Weather Conditions::'+'temperature: ' + readout.temperature.toFixed(1) + '°C,   ' + 'humidity: ' + readout.humidity.toFixed(1) + '%');

// Build and send signed transaction to setContextData (if PRIVATE_KEY provided). Uses web3.eth.accounts.signTransaction
async function sendContextToChain() {
	try {
		const fromAccount = PRIVATE_KEY ? web3.eth.accounts.privateKeyToAccount('0x' + PRIVATE_KEY).address : (process.env.DEFAULT_ACCOUNT || null);
		if (!fromAccount) {
			console.error('No from account available. Set PRIVATE_KEY or DEFAULT_ACCOUNT in env.');
			return;
		}

		// Prepare numeric values
		const t = Math.round(readout.temperature.toFixed(0));
		const h = Math.round(readout.humidity.toFixed(0));
		const totalMeter = 0; // placeholder
		const totalDevices = Math.round((Number(ac1Power) + Number(ac2Power) + Number(ac3Power)) || 0);
		const hr = hour;
		const a1 = Math.round(ac1Power || 0);
		const a2 = Math.round(ac2Power || 0);
		const a3 = Math.round(ac3Power || 0);
		const bv = Math.round(bVoltage || 0);

		// Fetch nonce from contract for this signer
		const nonce = await signedContract.methods.nonces(fromAccount).call();

		// Create the packed hash matching the contract's abi.encodePacked(...) then keccak256
		const payloadHash = web3.utils.soliditySha3(
			{type: 'uint256', value: t},
			{type: 'uint256', value: h},
			{type: 'uint256', value: totalMeter},
			{type: 'uint256', value: totalDevices},
			{type: 'uint256', value: hr},
			{type: 'uint256', value: a1},
			{type: 'uint256', value: a2},
			{type: 'uint256', value: a3},
			{type: 'uint256', value: bv},
			{type: 'uint256', value: nonce},
			{type: 'address', value: CONTRACT_ADDRESS}
		);

		let sig;
		if (PRIVATE_KEY) {
			sig = web3.eth.accounts.sign(payloadHash, '0x' + PRIVATE_KEY);
		} else {
			// ask node to sign (requires unlocked account)
			sig = await web3.eth.sign(payloadHash, fromAccount);
			// web3.eth.sign returns a signature string, normalize to r,s,v
			const sigStr = sig;
			sig = {
				signature: sigStr,
				v: parseInt(sigStr.slice(130, 132), 16),
				r: '0x' + sigStr.slice(2, 66),
				s: '0x' + sigStr.slice(66, 130)
			};
		}

		const v = typeof sig.v === 'string' ? parseInt(sig.v, 10) : sig.v;
		const r = sig.r;
		const s = sig.s;

		// Build transaction data for setContextDataSigned
		const txData = signedContract.methods.setContextDataSigned(
			t, h, totalMeter, totalDevices, hr, a1, a2, a3, bv, Number(nonce), v, r, s
		).encodeABI();

		const txCount = await web3.eth.getTransactionCount(fromAccount);
		const tx = {
			to: CONTRACT_ADDRESS,
			data: txData,
			gas: 400000,
			gasPrice: '0x0',
			nonce: web3.utils.toHex(txCount)
		};

		if (PRIVATE_KEY) {
			const signedTx = await web3.eth.accounts.signTransaction(tx, '0x' + PRIVATE_KEY);
			const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
			console.log('Signed payload tx receipt', receipt.transactionHash);
		} else {
			// send via unlocked node account
			const receipt = await web3.eth.sendTransaction(tx);
			console.log('Signed payload tx receipt (node-sent)', receipt.transactionHash || receipt.transactionHash === undefined ? receipt : receipt.transactionHash);
		}

	} catch (err) {
		console.error('Failed to send signed context to chain', err);
	}
}

sendContextToChain();

console.log('those we want to send', ac1Power, ac2Power, ac3Power, bVoltage);
console.log('the time is', hour);

var a = 0;





//let headers = ["Ac","Heater","Washing","Hour"].join("\t");
const fs = require('fs');

const array = [

  {Device: "AC",
  usage:ac1Power},
  {Device:"Heater",
  usage: ac2Power},
  {Device: "Washing", usage: ac3Power},
  {Time: "time",
	H:hour},
	{M:minutes}
];

const dataToSave = array.map(item => {
    return JSON.stringify(item)
      .replace(/\"/gi, '""');
  })
  .map(item => `"${item}"`)
  .join('\n');

fs.appendFile('js/export1.csv',  dataToSave, (err) => { //////fs.writeFile('js/export1.csv', dataToSave, (err) => {
    if (err) throw err;
    console.log('The file has been saved!');
});

}, 12000);
		// Automatically update sensor value every 12 seconds

//output data and devices

setInterval(async function(){

	//let angle=0;
	//let increment=1;
	// call contract read-only methods
	let result1 = await deviceContract.methods.getAcActionAttributes().call();
	let result2 = await deviceContract.methods.getAc2ActionAttributes().call();
	let result3 = await deviceContract.methods.getAc3ActionAttributes().call();
	let result4 = await deviceContract.methods.getBatteryActionAttributes().call();

	var a = Number(result1); //Ac1
	var b = Number(result2); //Ac2
	var c = Number(result3); //Ac3
	var d = Number(result4); //battery

	console.log('ac1 result is',a);
	console.log('ac2 result is',b);
	console.log('ac3 result is',c);
	console.log('battery result is', d);

if (a== 0) {
setInterval(() => {
	servoAc1.servoWrite(pulseWidth);

	pulseWidth += increment;
	if (pulseWidth >= 2000) {
	  increment = -100;
	} else if (pulseWidth <= 1000) {
	  increment = 100;
	}
  }, 1000);
  }


  if (b== 0) {
  setInterval(() => {
	servoac2.servoWrite(pulseWidth);

	pulseWidth += increment;
	if (pulseWidth >= 2000) {
	  increment = -100;
	} else if (pulseWidth <= 1000) {
	  increment = 100;
	}
  }, 1000);

  }

  if (c== 0) {

  setInterval(() => {
	  servoAc3.servoWrite(pulseWidth);

	  pulseWidth += increment;
	  if (pulseWidth >= 2000) {
		increment = -100;
	  } else if (pulseWidth <= 1000) {
		increment = 100;
	  }
	}, 1000);
}

if (c== 0) {

function chargeBattery() { //function to start
	if (carBattery.readSync() === 0) { //check the pin state, if the state is 0 (or off)
	  carBattery.writeSync(1); //set pin state to 1 (turn on)
	} else {
	  carBattery.writeSync(0); //set pin state to 0 (turn off)
	}
  }
}


	 // calling the function every 20 seconds

	},20000);
