const { ApiPromise, WsProvider, Keyring } = require('api_v1');
const { Abi, PromiseContract } = require('api_contracts');
const delay = require('delay');
const config = require('./config');
const fs = require('fs');

var BigNumber = require('bignumber.js');
BigNumber.config({ DECIMAL_PLACES: 12, ROUNDING_MODE: BigNumber.ROUND_DOWN, decimalSeparator: '.' });

const rtt = require("./runtime_types.json");
const contractAbi = require("./market_metadata.json");

const quoteId = 2; // KSM
const logFile = "./operations_log";
const asksFile = "./asks.json";

const blackList = [ 7395, 1745, 8587, 573, 4732, 3248, 6986, 7202, 6079, 1732, 6494, 7553, 6840, 4541, 2102, 3503, 6560, 4269, 2659, 3912, 3470, 6290, 5811, 5209, 8322, 1813, 7771, 2578, 2661, 2983, 2119, 3310, 1547, 1740, 3187, 8194, 4651, 6188, 2167, 3487, 3106, 6070, 3446, 2407, 5870, 3745, 6389, 3246, 9385, 9680, 6457, 8462, 2350, 3927, 2269, 8485, 6198, 6787, 2047, 2197, 2379, 2466, 2558, 2682, 2759, 2979, 4232, 4273, 8187, 8190, 2935, 2673, 5228, 7683, 2075, 9845, 1645, 3198, 7490, 3192, 7907, 3167, 858, 239, 7613, 2790, 7043, 5536, 8277, 1134, 6378, 2416, 2373, 2240, 3952, 5017, 4999, 5986, 3159, 6155, 9329, 6445, 2117, 3935, 6091, 7841, 8725, 5194, 5744, 8120, 5930, 578, 6171, 6930, 2180, 6212, 5963, 7097, 8774, 5233, 7978, 2938, 2364, 1823, 1840, 8672, 5616, 737, 6122, 8769, 615, 9729, 3489, 427, 9883, 8678, 6579, 1776, 7061, 873, 5324, 2390, 6187, 9517, 2321, 3390, 3180, 6692, 2129, 9854, 1572, 7412, 3966, 1302, 1145, 1067, 3519, 7387, 8314, 648, 219, 2055, 825, 1195
];

function getTime() {
  var a = new Date();
  var hour = a.getHours();
  var min = a.getMinutes();
  var sec = a.getSeconds();
  var time = `${hour}:${min}:${sec}`;
  return time;
}

function getDay() {
  var a = new Date();
  var year = a.getFullYear();
  var month = a.getMonth()+1;
  var date = a.getDate();
  var time = `${year}-${month}-${date}`;
  return time;
}

function log(operation, status) {
  fs.appendFileSync(`${logFile}_${getDay()}.csv`, `${getTime()},${operation},${status}\n`);
}

async function getUniqueConnection() {
  // Initialise the provider to connect to the node
  const wsProviderNft = new WsProvider(config.wsEndpointNft);

  // Create the API and wait until ready
  const api = new ApiPromise({ 
    provider: wsProviderNft,
    types: rtt
  });

  api.on('disconnected', async (value) => {
    log(`disconnected: ${value}`);
    process.exit();
  });
  api.on('error', async (value) => {
    log(`error: ${value.toString()}`);
    process.exit();
  });

  await api.isReady;

  return api;
}

function sendTransactionAsync(api, sender, transaction) {
  return new Promise(async function(resolve, reject) {

    try {
      const unsub = await transaction
        .signAndSend(sender, ({ events = [], status }) => {
      
        if (status == 'Ready') {
          // nothing to do
          console.log(`Current tx status is Ready`);
        }
        else if (JSON.parse(status).Broadcast) {
          // nothing to do
          console.log(`Current tx status is Broadcast`);
        }
        else if (status.isInBlock) {
          console.log(`Transaction included at blockHash ${status.asInBlock}`);
          log(`Transaction`, `In Block`);
          // resolve();
          // unsub();
        } else if (status.isFinalized) {
          console.log(`Transaction finalized at blockHash ${status.asFinalized}`);
          log(`Transaction`, `Finalized`);

          // Loop through Vec<EventRecord> to display all events
          let success = false;
          events.forEach(({ phase, event: { data, method, section } }) => {
            console.log(`\t' ${phase}: ${section}.${method}:: ${data}`);
            if (method == 'ExtrinsicSuccess') {
              log(`Transaction`, `Successful`);
              success = true;
            }
          });

          if (success) resolve();
          else {
            reject();
            log(`Transaction`, `FAILED`);
          }
          unsub();
        }
        else //if (status.isUsurped) 
        {
          console.log(`Something went wrong with transaction. Status: ${status}`);
          log(`Transaction`, `ERROR: ${status}`);

          reject();
          unsub();
        }
      });
    } catch (e) {
      console.log("Error: ", e);
      log(`Transaction`, `ERROR: ${e.toString()}`);
      reject(e);
    }
  });

}

async function registerQuoteDepositAsync(api, sender, depositorAddress, amount) {
  console.log(`${depositorAddress} deposited ${amount} in ${quoteId} currency`);

  // Apply 0.01 KSM fee == 1e10 femto
  let amountBN = new BigNumber(amount);
  let fee = amountBN.multipliedBy(0.02);
  if (fee < 1e10) fee = 1e10;
  amountBN = amountBN.minus(fee);

  const abi = new Abi(api.registry, contractAbi);

  const value = 0;
  const maxgas = 1000000000000;

  const tx = api.tx.contracts
        .call(config.marketContractAddress, value, maxgas, abi.messages.registerDeposit(quoteId, amountBN.toString(), depositorAddress));
  await sendTransactionAsync(api, sender, tx);
}

async function registerNftDepositAsync(api, sender, depositorAddress, collection_id, token_id) {
  console.log(`${depositorAddress} deposited ${collection_id}, ${token_id}`);
  const abi = new Abi(api.registry, contractAbi);

  const value = 0;
  const maxgas = 1000000000000;

  if (blackList.includes(token_id)) {
    console.log(`Blacklisted NFT received. Silently returning.`);
    log(`Blacklisted NFT received. Silently returning.`, "WARNING");
    return;
  }

  const tx = api.tx.contracts
    .call(config.marketContractAddress, value, maxgas, abi.messages.registerNftDeposit(collection_id, token_id, depositorAddress))
  await sendTransactionAsync(api, sender, tx);
}

async function scanNftBlock(api, admin, blockNum) {

  if (blockNum % 100 == 0) console.log(`Scanning Block #${blockNum}`);
  const blockHash = await api.rpc.chain.getBlockHash(blockNum);

  // Memo: If it fails here, check custom types
  const signedBlock = await api.rpc.chain.getBlock(blockHash);

  // console.log(`Reading Block Transactions`);
  for (const ex of signedBlock.block.extrinsics) {
    const { _isSigned, _meta, method: { args, method, section } } = ex;
    if ((section == "nft") && (method == "transfer") && (args[0] == config.adminAddressNft)) {

      // Check that transfer was actually successful:
      let { Owner } = await api.query.nft.nftItemList(args[1], args[2]);
      if (Owner == config.adminAddressNft) {
        console.log(`NFT Transfer: ${args[0]} received (${args[1]}, ${args[2]})`);
        log(`NFT deposit from ${ex.signer.toString()} id (${args[1]}, ${args[2]})`, "RECEIVED");
  
        // Register NFT Deposit
        const deposit = {
          address: ex.signer.toString(),
          collectionId: args[1],
          tokenId: args[2]
        };

        try {
          await registerNftDepositAsync(api, admin, deposit.address, deposit.collectionId, deposit.tokenId);
          console.log(`NFT deposit from ${deposit.address} id (${deposit.collectionId}, ${deposit.tokenId}) REGISTERED`);
          log(`NFT deposit from ${deposit.address} id (${deposit.collectionId}, ${deposit.tokenId})`, "REGISTERED");
        } catch (e) {
          console.log(`NFT deposit from ${deposit.address} id (${deposit.collectionId}, ${deposit.tokenId}) FAILED TO REGISTER`);
          log(`NFT deposit from ${deposit.address} id (${deposit.collectionId}, ${deposit.tokenId})`, "FAILED TO REGISTER");
        }

      }
      else {
        console.log(`NFT Transfer: ${args[0]} received (${args[1]}, ${args[2]}) - FAILED TX (owner = ${Owner})`);
        log(`NFT deposit from ${ex.signer.toString()} id (${args[1]}, ${args[2]})`, "FAILED TX");
      }

    }
  }



}

async function sendNftTxAsync(api, sender, recipient, collection_id, token_id) {
  const tx = api.tx.nft
    .transfer(recipient, collection_id, token_id, 0);
  await sendTransactionAsync(api, sender, tx);
}

async function scanContract(api, admin) {
  const abi = new Abi(api.registry, contractAbi);
  const contractInstance = new PromiseContract(api, abi, config.marketContractAddress);
  const result = await contractInstance.call('rpc', 'get_last_withdraw_id', 0, 1000000000000).send(admin.address);
  const lastContractQuoteWithdrawId = result.output.toNumber();

  const result2 = await contractInstance.call('rpc', 'get_last_nft_withdraw_id', 0, 1000000000000).send(admin.address);
  const lastContractNftWithdrawId = result2.output.toNumber();

  let { lastQuoteWithdraw, lastNftWithdraw } = JSON.parse(fs.readFileSync("./withdrawal_id.json"));
  const keyring = new Keyring({ type: 'sr25519' });
  log(`Checking withdrawals. Last/handled quote withdraw id: ${lastContractQuoteWithdrawId}/${lastQuoteWithdraw} last/handled nft withdraw id: ${lastContractNftWithdrawId}/${lastNftWithdraw}`, "OK");

  // Process Quote withdraws
  let quoteWithdrawals = [];
  while (lastContractQuoteWithdrawId > lastQuoteWithdraw) {
    // Get the withdraw amount and address
    const result3 = await contractInstance.call('rpc', 'get_withdraw_by_id', 0, 1000000000000, lastQuoteWithdraw+1).send(admin.address);
    const [pubKey, amount] = result3.output;
    const address = keyring.encodeAddress(pubKey); 
    console.log(`${address.toString()} withdrawing amount ${amount.toNumber()}`);
    log(`Quote withdraw #${lastQuoteWithdraw+1}: ${address.toString()} withdrawing amount ${amount.toNumber()}`, "START");

    let amountBN = new BigNumber(amount);

    // Send KSM withdraw transaction
    if (amountBN.isGreaterThanOrEqualTo(0)) {
      const withdrawal = {
        number: lastQuoteWithdraw+1,
        address: address,
        amount: amountBN.toString()
      };
      quoteWithdrawals.push(withdrawal);
      fs.writeFileSync("./quoteWithdrawals.json", JSON.stringify(quoteWithdrawals));
    }

    lastQuoteWithdraw++;
    fs.writeFileSync("./withdrawal_id.json", JSON.stringify({ lastQuoteWithdraw, lastNftWithdraw }));
  }

  // Process NFT withdraws
  while (lastContractNftWithdrawId > lastNftWithdraw) {
    // Get the withdraw amount and address
    const result4 = await contractInstance.call('rpc', 'get_nft_withdraw_by_id', 0, 1000000000000, lastNftWithdraw+1).send(admin.address);
    const [pubKey, collection_id, token_id] = result4.output;
    const address = keyring.encodeAddress(pubKey); 
    console.log(`${address.toString()} withdrawing NFT (${collection_id.toNumber()}, ${token_id.toNumber()})`);
    log(`NFT withdraw #${lastNftWithdraw+1}: ${address.toString()} withdrawing ${collection_id.toNumber()}-${token_id.toNumber()}`, "START");

    // Send withdraw transaction
    try {
      // Update before sending
      lastNftWithdraw++;
      fs.writeFileSync("./withdrawal_id.json", JSON.stringify({ lastQuoteWithdraw, lastNftWithdraw }));

      await sendNftTxAsync(api, admin, address, collection_id, token_id);
    } catch (e) {
      log(`NFT withdraw #${lastNftWithdraw+1}: ${address.toString()} withdrawing ${collection_id.toNumber()}-${token_id.toNumber()}`, "FAILED");
    }
    log(`NFT withdraw #${lastNftWithdraw+1}: ${address.toString()} withdrawing ${collection_id.toNumber()}-${token_id.toNumber()}`, "END");

  }

}

function ksmToFixed(amount) {
  const ksmDecimals = 12;
  const ksmexp = BigNumber(10).pow(ksmDecimals);
  const balance = new BigNumber(amount);
  return balance.div(ksmexp).toFixed();
}

async function loadAsks(api) {

  const abi = new Abi(api.registry, contractAbi);
  const contractInstance = new PromiseContract(api, abi, config.marketContractAddress);
  const keyring = new Keyring({ type: 'sr25519' });

  // TODO: Make this a dynamic list.
  const collectionId = 4;

  const nfts = await api.query.nft.addressTokens(collectionId, config.adminAddressNft);

  //////////////////////////////////////////////////////
  // Get price for each token (if available yet)

  // First, get the saved file. If price is saved there, it did not change if token is still available.
  let cachedasks = {};
  try {
    cachedasks = JSON.parse(fs.readFileSync(asksFile));
  }
  catch (e) {
    console.log("No asks file, starting asks cache over");
  }
  
  let asks = {};
  for (let i=0; i<nfts.length; i++) {
    const tokenId = nfts[i].toString();
    const key = `${collectionId}-${tokenId}`;
    if (cachedasks[key]) {
      let {price, address} = cachedasks[key];
      asks[key] = {
        price: price,
        address: address
      }
    }
    else {
      // process.stdout.write(`Retrieving price for ${key}... `);

      const askIdResult = await contractInstance.call('rpc', 'get_ask_id_by_token', 0, 1000000000000, collectionId, tokenId).send(config.adminAddressNft);
      if (askIdResult && askIdResult.output) {
        const askId = askIdResult.output;
        const askResult = await contractInstance.call('rpc', 'get_ask_by_id', 0, 1000000000000, askId).send(config.adminAddressNft);
        if (askResult && askResult.output) {
          const [_colId, _tokId, _quote, priceBN, address] = askResult.output;
          price = ksmToFixed(priceBN);
          console.log(`Price set: ${price}, sold by ${keyring.encodeAddress(address.toString())}`);
          asks[key] = {
            price: price,
            address: keyring.encodeAddress(address.toString())
          }
        }
        else {
          // console.log("no price yet");
        }
      }
      else {
        // console.log("no ask yet");
      }
    }
  }

  // Save asks cache
  fs.writeFileSync(asksFile, JSON.stringify(asks));
}

async function handleUnique() {

  // Get the start block
  let { lastKusamaBlock, lastNftBlock } = JSON.parse(fs.readFileSync("./block.json"));

  const api = await getUniqueConnection();
  const keyring = new Keyring({ type: 'sr25519' });
  const admin = keyring.addFromUri(config.adminSeed);

  const finalizedHashNft = await api.rpc.chain.getFinalizedHead();
  const signedFinalizedBlockNft = await api.rpc.chain.getBlock(finalizedHashNft);

  while (true) {
    try {
      if (lastNftBlock + 1 <= signedFinalizedBlockNft.block.header.number) {

        // Handle NFT Deposits (by analysing block transactions)
        lastNftBlock++;
        fs.writeFileSync("./block.json", JSON.stringify({ lastKusamaBlock: lastKusamaBlock, lastNftBlock: lastNftBlock }));
        log(`Handling nft block ${lastNftBlock}`, "START");
        await scanNftBlock(api, admin, lastNftBlock);
        log(`Handling nft block ${lastNftBlock}`, "END");
      } else break;

    } catch (ex) {
      console.log(ex);
      await delay(1000);
    }
  }

  // Handle Withdrawals (by getting them from market contracts)
  await scanContract(api, admin);

  // Handle queued KSM deposits
  let quoteDeposits = [];
  try {
    quoteDeposits = JSON.parse(fs.readFileSync("./quoteDeposits.json"));
  } catch (e) {}
  for (let i=0; i<quoteDeposits.length; i++) {
    try {
      await registerQuoteDepositAsync(api, admin, quoteDeposits[i].address, quoteDeposits[i].amount);
      log(`Quote deposit from ${quoteDeposits[i].address} amount ${quoteDeposits[i].amount}`, "REGISTERED");
    } catch (e) {
      log(`Quote deposit from ${quoteDeposits[i].address} amount ${quoteDeposits[i].amount}`, "FAILED");
    }
  }
  fs.writeFileSync("./quoteDeposits.json", "[]")

  // Prepare JSON file with asks for IPNS publishing
  await loadAsks(api);

  api.disconnect();
}

// Should not run longer than 30 seconds
function killTimer() {
  setTimeout(() => { 
    process.exit();
  }, 240000);
}

async function main() {
  killTimer();

  await handleUnique();
}

main().catch(console.error).finally(() => process.exit());
