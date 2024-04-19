import {Foundry, Resolver, Node} from '@adraffy/blocksmith';
import {ethers} from 'ethers';

let foundry = await Foundry.launch({fork: 'https://cloudflare-eth.com'});

let root = Node.root();
let ens = await foundry.deploy({import: '@ensdomains/ens-contracts/contracts/registry/ENSRegistry.sol'});
Object.assign(ens, {
	async $register(node, {owner, resolver} = {}) {
		let w = foundry.requireWallet(await this.owner(node.parent.namehash));
		owner = foundry.requireWallet(owner, w);
		await foundry.confirm(this.connect(w).setSubnodeRecord(node.parent.namehash, node.labelhash, owner, resolver ?? ethers.ZeroAddress, 0), {name: node.name});
		return node;
	}
});

const L1_VERIFIER = '0x...';

let resolver = await foundry.deploy({file: 'TeamNick2Baseless', args: [ens, L1_VERIFIER]});

let eth = await ens.$register(root.create('eth'));
let basename = await ens.$register(eth.create('teamchonk'), {resolver});

function get_resolver(node) {
	let r = new Resolver(node, new ethers.Contract(resolver, Resolver.ABI, foundry.provider));
	r.wild = true;
	return r;
}

async function dump(node) {
	console.log(node.name, await get_resolver(node).profile([
		{type: 'text', arg: 'name'},
		{type: 'text', arg: 'avatar'},
		{type: 'addr', arg: 60},
		{type: 'addr'}
	]));
}

await dump(basename.create('raffy'));
await dump(basename.create('slobo'));

console.log(await get_resolver(basename).profile([
	{type: 'addr', arg: 0x80000000n + 8453n},
	{type: 'text', arg: 'url'},
	{type: 'text', arg: 'description'}
]));

foundry.shutdown();