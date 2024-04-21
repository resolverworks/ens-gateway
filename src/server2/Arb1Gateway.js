import {ethers} from 'ethers';
import {EZCCIP} from '@resolverworks/ezccip';
import {SmartCache} from '../SmartCache.js';

const ABI_CODER = ethers.AbiCoder.defaultAbiCoder();

// newer
// https://github.com/OffchainLabs/arbitrum-classic/blob/551a39b381dcea81e03e7599fcb01fddff4fe96c/packages/arb-bridge-eth/contracts/rollup/RollupCore.sol#L175
// https://github.com/OffchainLabs/arbitrum-classic/blob/551a39b381dcea81e03e7599fcb01fddff4fe96c/packages/arb-bridge-eth/contracts/rollup/IRollupCore.sol#L42	

/*
RollupLib.Assertion: 
    struct Assertion {
        ExecutionState beforeState;
        ExecutionState afterState;
        uint64 numBlocks;
    }
    struct ExecutionState {
        GlobalState globalState;
        MachineStatus machineStatus;
    }
	struct GlobalState {
		bytes32[2] bytes32Vals;
		uint64[2] u64Vals;
	}
	enum MachineStatus {
		RUNNING,
		FINISHED,
		ERRORED,
		TOO_FAR
	}
*/


export class Arb1Gateway extends EZCCIP {
	static mainnet({provider1, provider2, expander}) {
		// https://docs.arbitrum.io/build-decentralized-apps/reference/useful-addresses
		if (!provider1) {
			provider1 = new ethers.CloudflareProvider();
		}
		if (!provider2) {
			provider2 = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc', 42161, {staticNetwork: true});
		}
		return new this({
			provider1, 
			provider2,
			L2Rollup: '0x5eF0D09d1E6204141B4d37530808eD19f60FBa35',
			expander
		});
	}
	constructor({provider1, provider2, L2Rollup, expander}) {
		super();
		this.provider1 = provider1;
		this.provider2 = provider2;
		this.L2Rollup = new ethers.Contract(L2Rollup, [	
			'function latestNodeCreated() external view returns (uint64)',
			`event NodeCreated(
				uint64 indexed nodeNum,
				bytes32 indexed parentNodeHash,
				bytes32 indexed nodeHash,
				bytes32 executionHash,
				tuple(
					tuple(tuple(bytes32[2] bytes32Vals, uint64[2] u64Vals) globalState, uint8 machineStatus) beforeState, 
					tuple(tuple(bytes32[2] bytes32Vals, uint64[2] u64Vals) globalState, uint8 machineStatus) afterState, 
					uint64 numBlocks
				) assertion, 
				bytes32 afterInboxBatchAcc, 
				bytes32 wasmModuleRoot, 
				uint256 inboxMaxCount
			)`,
		], provider1);
		this.cache = new SmartCache();
		this.register(`getStorageSlots(bytes context, address target, bytes32[] commands, bytes[] constants) external view returns (bytes)`, async ([node, target, commands, constants], context, history) => {	
			let hash = ethers.keccak256(context.calldata);
			history.show = [hash];
			return this.cache.get(hash, async () => {
				let cached = await this.cache.get(BigInt(node), x => this.fetch_node(x), 60000 * 60);
				let slots = await expander(this.provider2, cached.block, target, commands, constants);
				let proof = await this.provider2.send('eth_getProof', [target, slots.map(x => ethers.toBeHex(x, 32)), cached.block]);
				let witness = ABI_CODER.encode(
					['bytes32', 'bytes', 'tuple(bytes[], bytes[][])'],
					[cached.sendRoot, cached.rlpEncodedBlock, [proof.accountProof, proof.storageProof.map(x => x.proof)]]
				);
				return ABI_CODER.encode(['bytes'], [witness]);
			});
		});
	}
	async fetch_node(node) {
		let events = await this.L2Rollup.queryFilter(this.L2Rollup.filters.NodeCreated(node));
		if (events.length != 1) throw new Error(`unknown node: ${node}`);
		let [blockHash, sendRoot] = events[0].args[4][1][0][0]; //events[0].args.afterState.globalState.bytes32Vals;
		let block = await this.provider2.send('eth_getBlockByHash', [blockHash, false]);
		let rlpEncodedBlock = ethers.encodeRlp([
			block.parentHash,
			block.sha3Uncles,
			block.miner,
			block.stateRoot,
			block.transactionsRoot,
			block.receiptsRoot,
			block.logsBloom,
			ethers.toBeHex(block.difficulty),
			ethers.toBeHex(block.number),
			ethers.toBeHex(block.gasLimit),
			ethers.toBeHex(block.gasUsed),
			ethers.toBeHex(block.timestamp),
			block.extraData,
			block.mixHash,
			block.nonce,
			ethers.toBeHex(block.baseFeePerGas)
		]);
		return {
			node,
			block: block.number,
			blockHash,
			sendRoot,
			rlpEncodedBlock,
		};
	}
}