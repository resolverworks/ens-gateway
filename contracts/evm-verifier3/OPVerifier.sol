// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {GatewayRequest} from "./GatewayRequest.sol";
import {IEVMVerifier} from "./IEVMVerifier.sol";
import {EVMProofHelper, StateProof} from "./EVMProofHelper.sol";
import {RLPReader} from "@eth-optimism/contracts-bedrock/src/libraries/rlp/RLPReader.sol";
import {Types} from "@eth-optimism/contracts-bedrock/src/libraries/Types.sol";
import {Hashing} from "../forge-import-bug/Hashing.sol";

interface IL2OutputOracle {
	function latestOutputIndex() external view returns (uint256);
	function getL2Output(uint256 _l2OutputIndex) external view returns (Types.OutputProposal memory);
}

contract OPVerifier is IEVMVerifier {

	error OutputRootMismatch(uint256 l2OutputIndex, bytes32 expected, bytes32 actual);
	error OutputsMismatch(uint256 expected, uint256 actual);

	string[] public gatewayURLs;
	IL2OutputOracle immutable oracle;
	uint256 delay;

	constructor(string[] memory _urls, IL2OutputOracle _oracle, uint256 _delay) {
		gatewayURLs = _urls;
		oracle = _oracle;
		delay = _delay;
	}

	function getStorageContext() external view returns(string[] memory urls, bytes memory context) {
		urls = gatewayURLs;
		context = abi.encode(oracle.latestOutputIndex() - delay);
	}

	function getStorageValues(bytes memory context, GatewayRequest memory req, bytes memory proof) external view returns(bytes[] memory values) {
		uint256 outputIndex = abi.decode(context, (uint256));
		(Types.OutputRootProof memory outputRootProof, StateProof[] memory stateProofs) = abi.decode(proof, (Types.OutputRootProof, StateProof[]));
		Types.OutputProposal memory output = oracle.getL2Output(outputIndex);
		bytes32 expectedRoot = Hashing.hashOutputRootProof(outputRootProof);
		if (output.outputRoot != expectedRoot) revert OutputRootMismatch(outputIndex, expectedRoot, output.outputRoot);
		values = EVMProofHelper.getStorageValues(req, outputRootProof.stateRoot, stateProofs);
		if (values.length != req.outputs) revert OutputsMismatch(req.outputs, values.length);
	}

}
