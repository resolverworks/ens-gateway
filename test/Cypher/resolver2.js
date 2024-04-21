import {Foundry, Resolver, Node} from '@adraffy/blocksmith';
import {serve} from '@resolverworks/ezccip';
import {Arb1Gateway} from '../../src/server2/Arb1Gateway.js';
import {expand_slots} from '../../src/evm-storage.js';
import {deploy_ens} from '../ens.js';
import {ethers} from 'ethers';

const INFURA = 'eb26e787c3a14cc3bd74d3ee3c5b704d';

let foundry = await Foundry.launch({fork: `https://mainnet.infura.io/v3/${INFURA}`});

let prover = Arb1Gateway.mainnet({	
	provider1: new ethers.InfuraProvider(1, INFURA),
	provider2: new ethers.InfuraProvider(42161, INFURA),
	expander: expand_slots
});

let ccip = await serve(prover, {protocol: 'raw'});

let verifier = await foundry.deploy({file: 'evm-verifier2/Arb1Verifier', args: [[ccip.endpoint], prover.L2Rollup]});

let ens = await deploy_ens(foundry);
let root = Node.root();

let cypher_resolver = await foundry.deploy({file: 'XCTENS2', args: [ens, verifier, '0xEC2244b547BD782FC7DeefC6d45E0B3a3cbD488d', 42161]});

let owned_resolver = await foundry.deploy({import: '@ensdomains/ens-contracts/contracts/resolvers/OwnedResolver.sol'});

let basename = await ens.$register(root.create('cypher'), {resolver: cypher_resolver});

let slobo = await Resolver.get(ens, basename.create('slobo'));

console.log(await slobo.profile([
	{type: 'text', arg: 'owner'},
	{type: 'text', arg: 'com.twitter'},
	{type: 'text', arg: 'avatar'},
	{type: 'addr', arg: 60},
	{type: 'addr'},
	{type: 'addr', arg: 0x8000000A}
]));

foundry.shutdown();
ccip.http.close();
