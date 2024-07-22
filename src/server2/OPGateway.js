import {ethers} from 'ethers';
import {EZCCIP} from '@resolverworks/ezccip';
import {SmartCache} from '../SmartCache.js';
import {Expander} from '../evm-storage.js';

const ABI_CODER = ethers.AbiCoder.defaultAbiCoder();

function decodeFetcher(index, target, commands, constants, proof) {
    const cmdhash = ethers.solidityPackedKeccak256(['address', 'bytes[]'], [target, commands]);
    console.log('cmdhash', cmdhash);
    console.log('index', index);
    console.log('target', target);
    console.log('commands', commands);
    console.log('constants', constants);
    console.log('proof', proof);
}

export class OPGateway extends EZCCIP {
	static base_mainnet(a) {
		return new this({
			// https://docs.base.org/docs/base-contracts
			L2OutputOracle: '0x56315b90c40730925ec5485cf004d835058518A0',
			L2ToL1MessagePasser: '0x4200000000000000000000000000000000000016',
			...a
		});
	}
	constructor({provider1, provider2, L2OutputOracle, L2ToL1MessagePasser}) {
		super();
		this.provider1 = provider1;
		this.provider2 = provider2;
		this.L2ToL1MessagePasser = L2ToL1MessagePasser;
		this.L2OutputOracle = new ethers.Contract(L2OutputOracle, [
			'function latestOutputIndex() external view returns (uint256)',
			'function getL2Output(uint256 outputIndex) external view returns (tuple(bytes32 outputRoot, uint128 t, uint128 block))',
		], provider1);
		this.call_cache = new SmartCache({max_cached: 100});
		this.output_cache = new SmartCache({ms: 60*60000, max_cached: 10});
		this.register(`getStorageSlots(bytes context, address target, bytes32[] commands, bytes[] constants) external view returns (bytes)`, async ([index, target, commands, constants], context, history) => {
			let hash = ethers.keccak256(context.calldata);
			history.show = [hash];
			return this.call_cache.get(hash, async () => {
				index = parseInt(index);
				let latest = await this.output_cache.get('LATEST', () => this.L2OutputOracle.latestOutputIndex().then(Number));
				if (index < latest - this.output_cache.max_cached) throw new Error('too old');
				let output = await this.output_cache.get(index, x => this.fetch_output(x));
				let slots = await new Expander(this.provider2, target, output.block, output.slot_cache).expand(commands, constants);
				let proof = await this.provider2.send('eth_getProof', [target, slots.map(x => ethers.toBeHex(x)), output.block]);
				decodeFetcher(index, target, commands, constants, proof);
				let witness = ABI_CODER.encode(
					[
						'tuple(bytes32 version, bytes32 stateRoot, bytes32 messagePasserStorageRoot, bytes32 latestBlockhash)',
						'tuple(bytes[] stateTrieWitness, bytes[][] storageProofs)',
					],
					[
						{
							version: ethers.ZeroHash,
							stateRoot: output.stateRoot,
							messagePasserStorageRoot: output.passerRoot,
							latestBlockhash: output.blockHash,
						},
						{
							stateTrieWitness: proof.accountProof,
							storageProofs: proof.storageProof.map(x => x.proof),
						}
					]
				);
				return ABI_CODER.encode(['bytes'], [witness]);
			});
		});
	}
	async fetch_output(index) {
		let {outputRoot, block} = await this.L2OutputOracle.getL2Output(index);
		block = '0x' + block.toString(16);
		let {storageHash: passerRoot} = await this.provider2.send('eth_getProof', [this.L2ToL1MessagePasser, [], block]);
		let {stateRoot, hash: blockHash} = await this.provider2.getBlock(block);
		return {
			index,
			block,
			outputRoot,
			passerRoot,
			stateRoot,
			blockHash,
			slot_cache: new SmartCache({max_cached: 512})
		};
	}
	shutdown() {
		this.provider1.destroy();
		this.provider2.destroy();
	}
}
