// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../interfaces/IPOSBridge.sol";
import "./TestPredicate.sol";

//TESTING ONLY
contract TestPOSBridge is IPOSBridge {
  TestPredicate public PREDICATE_ADDRESS;
  constructor(TestPredicate predicate) {
    PREDICATE_ADDRESS = predicate;
  }

  function depositEtherFor(address user) external payable override {}

  function depositFor(address user, address rootToken, bytes calldata balance) external override {
    PREDICATE_ADDRESS.deposit(user, rootToken, abi.decode(balance, (uint256)));
  }
}
